import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  signManifest,
  ZIP_LIMITS,
  type OpclibManifest,
} from "@openpcb/opclib-pack";
import { fixture, repin, rewritePack, signedPack } from "./test-fixture";
import { verifyRelease } from "./verify";

const roots: string[] = [];
function setup() {
  const result = fixture();
  roots.push(result.repoRoot);
  return result;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("CoreLibrary release verification", () => {
  test("valid signature and LF/CRLF SPKI representations", () => {
    const f = setup();
    expect(verifyRelease(f.files, f.policy, f.pin, f.repoRoot).components).toBe(
      10,
    );
    const crlf = Buffer.from(f.pem.toString().replace(/\n/g, "\r\n"));
    expect(
      verifyRelease(
        { ...f.files, publicKey: crlf },
        f.policy,
        f.pin,
        f.repoRoot,
      ).keyId,
    ).toBe("test-core");
    writeFileSync(
      path.join(f.repoRoot, "resources", "keys", "test-core.pub"),
      crlf,
    );
    expect(verifyRelease(f.files, f.policy, f.pin, f.repoRoot).keyId).toBe(
      "test-core",
    );
  });

  test("unknown key and revoked key (removed from committed trust store)", () => {
    const f = setup();
    const altered = repin(
      f.files,
      f.pin,
      signedPack(f.privateKey, { keyId: "unknown" }),
    );
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("unknown-key");
    rmSync(path.join(f.repoRoot, "resources", "keys", "test-core.pub"));
    expect(() => verifyRelease(f.files, f.policy, f.pin, f.repoRoot)).toThrow(
      "unknown-key",
    );
  });

  test("wrong signing key, substituted release key and substituted committed key", () => {
    const f = setup();
    const other = generateKeyPairSync("ed25519");
    const altered = repin(f.files, f.pin, signedPack(other.privateKey));
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("bad-signature");
    const pem = Buffer.from(
      other.publicKey.export({ type: "spki", format: "pem" }),
    );
    expect(() =>
      verifyRelease(
        { ...f.files, publicKey: pem },
        f.policy,
        f.pin,
        f.repoRoot,
      ),
    ).toThrow("does not match the committed signing key");
    writeFileSync(
      path.join(f.repoRoot, "resources", "keys", "test-core.pub"),
      pem,
    );
    expect(() =>
      verifyRelease(
        { ...altered.files, publicKey: pem },
        f.policy,
        altered.pin,
        f.repoRoot,
      ),
    ).toThrow("fingerprint does not match");
  });

  test("manifest tampering and absent signature fail even with matching archive checksums", () => {
    const f = setup();
    for (const unsigned of [false, true]) {
      const artifact = rewritePack(f.files.artifact, (entries) => {
        const manifest = JSON.parse(
          new TextDecoder().decode(entries["library.json"]),
        );
        if (unsigned) delete manifest.signature;
        else manifest.library.name = "Tampered";
        entries["library.json"] = new TextEncoder().encode(
          JSON.stringify(manifest),
        );
      });
      const altered = repin(f.files, f.pin, artifact);
      expect(() =>
        verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
      ).toThrow(unsigned ? "no-signature" : "bad-signature");
    }
  });

  test("another valid committed key cannot substitute for the reviewed signer", () => {
    const f = setup();
    const other = generateKeyPairSync("ed25519");
    writeFileSync(
      path.join(f.repoRoot, "resources", "keys", "other-core.pub"),
      other.publicKey.export({ type: "spki", format: "pem" }),
    );
    const altered = repin(
      f.files,
      f.pin,
      signedPack(other.privateKey, { keyId: "other-core" }),
    );
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("signing key does not match reviewed release pin");
  });

  test("payload tampering rejected by archive pin and shared asset verifier", () => {
    const f = setup();
    const artifact = rewritePack(f.files.artifact, (entries) => {
      entries["symbols/test.json"] = new TextEncoder().encode(
        '{"tampered":true}',
      );
    });
    const altered = repin(f.files, f.pin, artifact);
    expect(() =>
      verifyRelease(altered.files, f.policy, f.pin, f.repoRoot),
    ).toThrow("pinned archive sha256 mismatch");
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("sha256 mismatch");
    const component = rewritePack(f.files.artifact, (entries) => {
      entries["components/0.json"] = new TextEncoder().encode("poison");
    });
    const changedComponent = repin(f.files, f.pin, component);
    expect(() =>
      verifyRelease(changedComponent.files, f.policy, f.pin, f.repoRoot),
    ).toThrow("pinned archive sha256 mismatch");
  });

  test("valid signature cannot bypass package digest verification", () => {
    const f = setup();
    const artifact = rewritePack(f.files.artifact, (entries) => {
      const manifest = JSON.parse(
        new TextDecoder().decode(entries["library.json"]),
      ) as OpclibManifest;
      manifest.integrity.packageSha256 = "0".repeat(64);
      manifest.signature = signManifest(manifest, f.privateKey, f.pin.keyId);
      entries["library.json"] = new TextEncoder().encode(
        JSON.stringify(manifest),
      );
    });
    const altered = repin(f.files, f.pin, artifact);
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("manifest digest mismatch");
  });

  test("strict checksum filename, duplicate records, malformed and mismatched checksum", () => {
    const f = setup();
    for (const sums of [
      `${f.pin.sha256}  prefix-${f.pin.artifact}\n`,
      f.files.sums + f.files.sums,
      `wrong  ${f.pin.artifact}\n`,
      `${"0".repeat(64)}  ${f.pin.artifact}\n`,
    ])
      expect(() =>
        verifyRelease({ ...f.files, sums }, f.policy, f.pin, f.repoRoot),
      ).toThrow();
    expect(
      verifyRelease(
        { ...f.files, sums: f.files.sums.replace(/\n/g, "\r\n") },
        f.policy,
        f.pin,
        f.repoRoot,
      ).version,
    ).toBe("1.2.3");
  });

  test("signed downgrade, wrong library identity and stub are refused", () => {
    const f = setup();
    for (const [options, error] of [
      [{ version: "1.2.2" }, "downgrade refused"],
      [{ libraryId: "other.core" }, "library.id mismatch"],
      [{ count: 9 }, "components below 10"],
    ] as const) {
      const altered = repin(f.files, f.pin, signedPack(f.privateKey, options));
      expect(() =>
        verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
      ).toThrow(error);
    }
  });

  test("shared ZIP archive and entry-count limits remain enforced", () => {
    const f = setup();
    const tooLarge = repin(
      f.files,
      f.pin,
      new Uint8Array(ZIP_LIMITS.maxArchiveBytes + 1),
    );
    expect(() =>
      verifyRelease(tooLarge.files, f.policy, tooLarge.pin, f.repoRoot),
    ).toThrow("50 MiB");
    const tooMany = rewritePack(f.files.artifact, (entries) => {
      for (let index = 0; index < ZIP_LIMITS.maxEntries; index++)
        entries[`extra/${index}`] = new Uint8Array();
    });
    const altered = repin(f.files, f.pin, tooMany);
    expect(() =>
      verifyRelease(altered.files, f.policy, altered.pin, f.repoRoot),
    ).toThrow("too many files");
  });
});
