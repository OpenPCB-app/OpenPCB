import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { zipSync } from "fflate";
import {
  packOpclib,
  signManifest,
  withSignature,
  type OpclibManifest,
  type OpclibLibraryHeader,
} from "@openpcb/opclib-pack";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { getDb } from "../../../modules/library/backend/queries";
import { releases } from "../../../modules/library/backend/schema";
import { importOpclib } from "../../../modules/library/backend/sync/opclib-importer";
import { readOpclibFromBytes } from "../../../modules/library/backend/sync/opclib-reader";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const TMP_KEYS = mkdtempSync(path.join(os.tmpdir(), "opclib-keys-"));

function isolate(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function bootRuntime(): Promise<ModuleRuntime> {
  const runtime = new ModuleRuntime({
    moduleRegistry: new ModuleRouterRegistry(),
    workspaceRoot: REPO_ROOT,
  });
  await runtime.bootstrap();
  return runtime;
}

const LIB: OpclibLibraryHeader = {
  id: "test.signed",
  name: "Test Signed Library",
  kind: "user",
  channel: "stable",
  version: "1.0.0",
  license: "MIT",
  generatedAt: "2026-05-22T00:00:00.000Z",
};

function sha256(bytes: Uint8Array): string {
  return require("node:crypto")
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
}

function buildPackage(opts: {
  sign?: {
    privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
    keyId: string;
  };
}) {
  const symBytes = new TextEncoder().encode('{"id":"test.sym.x"}');
  const fpBytes = new TextEncoder().encode('{"id":"test.fp.x"}');
  const compBytes = new TextEncoder().encode('{"id":"test.comp.x"}');
  return packOpclib({
    library: LIB,
    symbols: [
      {
        entry: {
          id: "test.sym.x",
          uuid: "00000000-0000-0000-0000-000000000001",
          version: "1.0.0",
          name: "X",
          path: "symbols/x.symbol.json",
          sha256: sha256(symBytes),
        },
        bytes: symBytes,
      },
    ],
    footprints: [
      {
        entry: {
          id: "test.fp.x",
          uuid: "00000000-0000-0000-0000-000000000002",
          version: "1.0.0",
          name: "X",
          path: "footprints/x.fp.json",
          sha256: sha256(fpBytes),
        },
        bytes: fpBytes,
      },
    ],
    models3d: [],
    components: [
      {
        entry: {
          id: "test.comp.x",
          uuid: "00000000-0000-0000-0000-000000000010",
          version: "1.0.0",
          name: "X",
          category: "passive",
          symbol: "test.sym.x",
          defaultFootprint: "test.fp.x",
          footprints: [{ footprint: "test.fp.x", label: "default" }],
          provenance: { source: "openpcb-original", license: "MIT" },
        },
        path: "components/x.component.json",
        bytes: compBytes,
      },
    ],
    sign: opts.sign,
  });
}

beforeAll(() => {
  process.env.OPENPCB_TRUSTED_KEYS_DIR = TMP_KEYS;
});

afterAll(() => {
  delete process.env.OPENPCB_TRUSTED_KEYS_DIR;
  delete process.env.OPENPCB_REQUIRE_SIGNED_OPCLIB;
  rmSync(TMP_KEYS, { recursive: true, force: true });
});

describe("opclib signature verification at import time", () => {
  test("sets signature_valid=1 when trusted key verifies", async () => {
    isolate("opclib-sig-valid");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    mkdirSync(TMP_KEYS, { recursive: true });
    writeFileSync(
      path.join(TMP_KEYS, "test-key.pub"),
      publicKey.export({ type: "spki", format: "pem" }),
    );

    const { bytes } = buildPackage({ sign: { privateKey, keyId: "test-key" } });
    const pkg = readOpclibFromBytes(bytes);

    const runtime = await bootRuntime();
    const internals = runtime as unknown as { loaded: Map<string, { context: Parameters<typeof importOpclib>[0] }> };
    const ctx = internals.loaded.get("library")!.context;
    await importOpclib(ctx, pkg, { installOrigin: "manual-import" });

    const db = getDb(ctx);
    const row = db
      .select({ signatureValid: releases.signatureValid })
      .from(releases)
      .where(eq(releases.sourceId, "test.signed"))
      .get();
    expect(row?.signatureValid).toBe(1);
  });

  test("warns and sets signature_valid=0 for unsigned package in dev", async () => {
    isolate("opclib-sig-unsigned");
    const { bytes } = buildPackage({});
    const pkg = readOpclibFromBytes(bytes);

    const runtime = await bootRuntime();
    const internals = runtime as unknown as { loaded: Map<string, { context: Parameters<typeof importOpclib>[0] }> };
    const ctx = internals.loaded.get("library")!.context;
    await importOpclib(ctx, pkg, { installOrigin: "manual-import" });

    const db = getDb(ctx);
    const row = db
      .select({ signatureValid: releases.signatureValid })
      .from(releases)
      .where(eq(releases.sourceId, "test.signed"))
      .get();
    expect(row?.signatureValid).toBe(0);
  });

  test("rejects unsigned package when requireSignature=true", async () => {
    isolate("opclib-sig-required");
    const { bytes } = buildPackage({});
    const pkg = readOpclibFromBytes(bytes);

    const runtime = await bootRuntime();
    const internals = runtime as unknown as { loaded: Map<string, { context: Parameters<typeof importOpclib>[0] }> };
    const ctx = internals.loaded.get("library")!.context;
    let err: unknown;
    try {
      await importOpclib(ctx, pkg, {
        installOrigin: "manual-import",
        requireSignature: true,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/signature verification failed/);
  });

  test("rejects package signed by untrusted key when requireSignature=true", async () => {
    isolate("opclib-sig-untrusted");
    const { privateKey } = generateKeyPairSync("ed25519");
    // no .pub written for this keyId
    const { bytes } = buildPackage({
      sign: { privateKey, keyId: "untrusted-key" },
    });
    const pkg = readOpclibFromBytes(bytes);

    const runtime = await bootRuntime();
    const internals = runtime as unknown as { loaded: Map<string, { context: Parameters<typeof importOpclib>[0] }> };
    const ctx = internals.loaded.get("library")!.context;
    let err: unknown;
    try {
      await importOpclib(ctx, pkg, {
        installOrigin: "manual-import",
        requireSignature: true,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/unknown-key/);
  });
});
