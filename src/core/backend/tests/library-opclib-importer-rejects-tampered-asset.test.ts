import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import {
  OpclibFormatError,
  readOpclibFromBytes,
} from "../../../modules/library/backend/sync/opclib-reader";

const BUNDLED = path.resolve(
  import.meta.dir,
  "../../../../resources/core-library/openpcb-core-library-1.0.0.opclib",
);

describe("opclib reader rejects tampered assets", () => {
  test("flipping a byte in a symbol JSON triggers sha256 mismatch", async () => {
    const orig = new Uint8Array(await readFile(BUNDLED));
    const unzipped = unzipSync(orig);

    // Pick the first symbol asset.
    const symbolPath = Object.keys(unzipped).find(
      (p) => p.startsWith("symbols/") && p.endsWith(".symbol.json"),
    );
    expect(symbolPath).toBeDefined();
    const original = unzipped[symbolPath!]!;
    const tampered = new Uint8Array(original);
    const idx = Math.floor(tampered.length / 2);
    tampered[idx] = (tampered[idx] ?? 0) ^ 0x01;
    unzipped[symbolPath!] = tampered;

    const rebuilt = zipSync(unzipped, { level: 0 });

    let err: unknown;
    try {
      readOpclibFromBytes(rebuilt);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OpclibFormatError);
    expect((err as Error).message).toContain("sha256 mismatch");
  });

  test("removing a manifest-declared asset triggers asset-missing error", async () => {
    const orig = new Uint8Array(await readFile(BUNDLED));
    const unzipped = unzipSync(orig);
    const fpPath = Object.keys(unzipped).find(
      (p) => p.startsWith("footprints/") && p.endsWith(".fp.json"),
    );
    expect(fpPath).toBeDefined();
    delete unzipped[fpPath!];

    const rebuilt = zipSync(unzipped, { level: 0 });

    let err: unknown;
    try {
      readOpclibFromBytes(rebuilt);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OpclibFormatError);
    expect((err as Error).message).toContain("missing");
  });
});
