import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  dedupeCheck,
  deleteModel,
  readGlb,
  readSourceStep,
  writeGlb,
  writeSourceStep,
} from "../../../modules/library/backend/services/footprint-model-store";

const tempDirs: string[] = [];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function isolateModelStore(): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), "openpcb-model-store-")),
  );
  tempDirs.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");
  return root;
}

afterEach(async () => {
  delete process.env.OPENPCB_DB_PATH;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("library 3D model storage", () => {
  test("deduplicates identical writes into one content-addressed file", async () => {
    const root = await isolateModelStore();
    const bytes = new TextEncoder().encode("solid source-step\nendsolid\n");
    const hash = sha256(bytes);

    const first = await writeSourceStep(bytes, hash);
    const second = await writeSourceStep(bytes, hash);
    const files = await readdir(path.join(root, "models", "source"));

    expect(first.relativePath).toBe(`models/source/${hash}.step`);
    expect(first.deduped).toBe(false);
    expect(second.relativePath).toBe(first.relativePath);
    expect(second.deduped).toBe(true);
    expect(files).toEqual([`${hash}.step`]);
    expect(await dedupeCheck(hash)).toBe(true);
  });

  test("rejects path traversal and non-hex hash input", async () => {
    await isolateModelStore();
    const bytes = new TextEncoder().encode("glb bytes");

    await expect(writeGlb(bytes, "../evil.glb")).rejects.toThrow(
      /64-character hex SHA-256/,
    );
    await expect(readGlb("../evil.glb")).rejects.toThrow(
      /64-character hex SHA-256/,
    );
  });

  test("rejects hash mismatches", async () => {
    await isolateModelStore();
    const bytes = new TextEncoder().encode("actual glb bytes");
    const wrongHash = sha256(new TextEncoder().encode("different bytes"));

    await expect(writeGlb(bytes, wrongHash)).rejects.toThrow(
      /SHA-256 mismatch/,
    );
  });

  test("round-trips source and GLB bytes then deletes by hash", async () => {
    await isolateModelStore();
    const sourceBytes = new TextEncoder().encode("source-step-bytes");
    const glbBytes = new Uint8Array([0x67, 0x6c, 0x62, 0x00, 0x01]);
    const sourceHash = sha256(sourceBytes);
    const glbHash = sha256(glbBytes);

    const source = await writeSourceStep(sourceBytes, sourceHash);
    const glb = await writeGlb(glbBytes, glbHash);

    expect(source.relativePath).toBe(`models/source/${sourceHash}.step`);
    expect(glb.relativePath).toBe(`models/glb/${glbHash}.glb`);
    expect(await readSourceStep(sourceHash)).toEqual(sourceBytes);
    expect(await readGlb(glbHash)).toEqual(glbBytes);

    await deleteModel(sourceHash);
    await deleteModel(glbHash);

    expect(await dedupeCheck(sourceHash)).toBe(false);
    expect(await dedupeCheck(glbHash)).toBe(false);
    await expect(readSourceStep(sourceHash)).rejects.toThrow();
    await expect(readGlb(glbHash)).rejects.toThrow();
  });
});
