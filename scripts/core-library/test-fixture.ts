import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { packOpclib, type OpclibComponentEntry } from "@openpcb/opclib-pack";
import { unzipSync, zipSync } from "fflate";
import type { DownloadRequest } from "./fetch";
import type { ReleasePin, ReleasePolicy } from "./policy";
import { publicKeyDer, sha256, type ReleaseFiles } from "./verify";

export function signedPack(
  privateKey: KeyObject,
  options: {
    keyId?: string;
    version?: string;
    count?: number;
    libraryId?: string;
  } = {},
): Uint8Array {
  const bytes = new TextEncoder().encode("{}");
  const entry = {
    id: "test.symbol",
    uuid: "11111111-1111-4111-8111-111111111111",
    version: "1.0.0",
    name: "Test",
    path: "symbols/test.json",
    sha256: sha256(bytes),
  };
  const footprint = {
    ...entry,
    id: "test.footprint",
    path: "footprints/test.json",
  };
  const component: OpclibComponentEntry = {
    id: "test.component",
    uuid: entry.uuid,
    version: entry.version,
    name: "Test",
    category: "Test",
    symbol: entry.id,
    defaultFootprint: footprint.id,
    footprints: [{ footprint: footprint.id, label: "Test" }],
    provenance: { source: "openpcb-original", license: "CC0-1.0" },
  };
  return packOpclib({
    library: {
      id: options.libraryId ?? "openpcb.core",
      name: "Test core",
      version: options.version ?? "1.2.3",
      channel: "stable",
      license: "CC0-1.0",
      generatedAt: "2026-01-01T00:00:00Z",
    },
    symbols: [{ entry, bytes }],
    footprints: [{ entry: footprint, bytes }],
    models3d: [],
    components: Array.from({ length: options.count ?? 10 }, (_, index) => ({
      entry: { ...component, id: `test.component-${index}` },
      path: `components/${index}.json`,
      bytes,
    })),
    sign: { privateKey, keyId: options.keyId ?? "test-core" },
  }).bytes;
}

export function rewritePack(
  bytes: Uint8Array,
  change: (entries: Record<string, Uint8Array>) => void,
): Uint8Array {
  const entries = unzipSync(bytes);
  change(entries);
  return zipSync(entries);
}

export function fixture() {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), "openpcb-fetch-test-"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = Buffer.from(publicKey.export({ format: "pem", type: "spki" }));
  const artifact = signedPack(privateKey);
  const pin: ReleasePin = {
    tag: "v1.2.3",
    version: "1.2.3",
    artifact: "openpcb-core-library-1.2.3.opclib",
    sha256: sha256(artifact),
    keyId: "test-core",
    keySpkiSha256: sha256(publicKeyDer(pem)),
  };
  const policy: ReleasePolicy = {
    schemaVersion: 1,
    repository: "OpenPCB-app/CoreLibrary",
    minComponents: 10,
    productionRelease: pin,
  };
  const files: ReleaseFiles = {
    artifact,
    sums: `${pin.sha256}  ${pin.artifact}\n`,
    publicKey: pem,
  };
  mkdirSync(path.join(repoRoot, "resources", "keys"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "resources", "keys", `${pin.keyId}.pub`),
    pem,
  );
  writePolicy(repoRoot, policy);
  return { repoRoot, privateKey, pem, pin, policy, files };
}

export function writePolicy(repoRoot: string, policy: ReleasePolicy): void {
  writeFileSync(
    path.join(repoRoot, "resources", "core-library-release.json"),
    JSON.stringify(policy),
  );
}

export function repin(
  files: ReleaseFiles,
  pin: ReleasePin,
  artifact: Uint8Array,
): { files: ReleaseFiles; pin: ReleasePin } {
  const digest = sha256(artifact);
  return {
    pin: { ...pin, sha256: digest },
    files: { ...files, artifact, sums: `${digest}  ${pin.artifact}\n` },
  };
}

export function downloader(
  files: ReleaseFiles,
): (request: DownloadRequest) => void {
  return ({ directory, pin }) => {
    writeFileSync(path.join(directory, pin.artifact), files.artifact);
    writeFileSync(path.join(directory, "SHA256SUMS"), files.sums);
    writeFileSync(path.join(directory, "openpcb-core.pub"), files.publicKey);
  };
}
