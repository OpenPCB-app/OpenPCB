import { createHash, createPublicKey } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  assertValidManifest,
  extractZipEntries,
  unpackOpclib,
  verifyManifest,
  ZIP_LIMITS,
  type OpclibManifest,
} from "@openpcb/opclib-pack";
import type { ReleasePin, ReleasePolicy } from "./policy";

export interface ReleaseFiles {
  artifact: Uint8Array;
  sums: string;
  publicKey: Buffer;
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function publicKeyDer(bytes: Buffer): Buffer {
  const key = createPublicKey(bytes);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("trusted key must be Ed25519");
  return key.export({ type: "spki", format: "der" });
}

export function verifyChecksum(files: ReleaseFiles, pin: ReleasePin): void {
  const entries = files.sums.split(/\r?\n/).filter((line) => line !== "");
  const matches = entries
    .map((line) => {
      const match = /^([a-f0-9]{64}) [ *]([^\r\n]+)$/.exec(line);
      if (!match)
        throw new Error("SHA256SUMS contains a malformed checksum record");
      return { hash: match[1], filename: match[2] };
    })
    .filter((entry) => entry.filename === pin.artifact);
  if (matches.length !== 1)
    throw new Error(`SHA256SUMS must list exactly one ${pin.artifact}`);
  const actual = sha256(files.artifact);
  if (matches[0]?.hash !== actual)
    throw new Error(`sha256 mismatch for ${pin.artifact}`);
  if (pin.sha256 !== actual)
    throw new Error(`pinned archive sha256 mismatch for ${pin.artifact}`);
}

function readManifest(bytes: Uint8Array): OpclibManifest {
  const entries = extractZipEntries(bytes);
  const names = new Set<string>();
  for (const entry of entries) {
    const name = entry.path.toLowerCase();
    if (names.has(name))
      throw new Error(`duplicate archive entry: ${entry.path}`);
    names.add(name);
  }
  const manifests = entries.filter((entry) => entry.path === "library.json");
  if (manifests.length !== 1)
    throw new Error("library.json missing or ambiguous in .opclib");
  const manifest = manifests[0]!;
  if (manifest.bytes.length > ZIP_LIMITS.maxTextFileBytes) {
    throw new Error("library.json exceeds the 5 MiB text-file limit");
  }
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes),
  );
  assertValidManifest(value);
  return value as OpclibManifest;
}

function verifySignature(
  manifest: OpclibManifest,
  files: ReleaseFiles,
  pin: ReleasePin,
  repoRoot: string,
): string {
  if (!manifest.signature)
    throw new Error("signature verification failed: no-signature");
  const keysDir = path.join(repoRoot, "resources", "keys");
  const trustedKeys = new Map<string, Buffer>();
  for (const filename of readdirSync(keysDir)) {
    if (filename.endsWith(".pub")) {
      trustedKeys.set(
        filename.slice(0, -4),
        readFileSync(path.join(keysDir, filename)),
      );
    }
  }
  const result = verifyManifest(manifest, {
    resolveKey: (id) => trustedKeys.get(id),
  });
  if (!result.valid)
    throw new Error(
      `signature verification failed: keyId=${result.keyId ?? "(none)"} reason=${result.reason}`,
    );
  if (result.keyId !== pin.keyId)
    throw new Error("signing key does not match reviewed release pin");
  const trustedDer = publicKeyDer(trustedKeys.get(pin.keyId)!);
  if (sha256(trustedDer) !== pin.keySpkiSha256)
    throw new Error(
      "trusted key fingerprint does not match reviewed release pin",
    );
  if (!trustedDer.equals(publicKeyDer(files.publicKey))) {
    throw new Error(
      "released openpcb-core.pub does not match the committed signing key",
    );
  }
  return pin.keyId;
}

export function verifyRelease(
  files: ReleaseFiles,
  policy: ReleasePolicy,
  pin: ReleasePin,
  repoRoot: string,
) {
  verifyChecksum(files, pin);
  const manifest = readManifest(files.artifact);
  const keyId = verifySignature(manifest, files, pin, repoRoot);
  // The reader checks manifest digest and referenced asset hashes; the reviewed
  // archive pin also covers component files and every otherwise unreferenced byte.
  unpackOpclib(files.artifact);
  if (manifest.library.id !== "openpcb.core")
    throw new Error("manifest library.id mismatch");
  if (manifest.library.version !== pin.version)
    throw new Error(
      "manifest version does not match reviewed release pin (downgrade refused)",
    );
  if (manifest.components.length < policy.minComponents)
    throw new Error(
      `manifest components below ${policy.minComponents} threshold`,
    );
  return {
    tag: pin.tag,
    version: pin.version,
    artifact: pin.artifact,
    sha256: pin.sha256,
    keyId,
    keySpkiSha256: pin.keySpkiSha256,
    symbols: manifest.symbols.length,
    footprints: manifest.footprints.length,
    components: manifest.components.length,
    models3d: manifest.models3d.length,
  };
}
