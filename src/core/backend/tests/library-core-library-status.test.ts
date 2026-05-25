import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { packOpclib } from "@openpcb/opclib-pack";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import {
  checkCoreLibraryUpdates,
  getCoreLibraryStatus,
  updateCoreLibrary,
} from "../../../modules/library/backend/sync/core-library-updates";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const tempRoots: string[] = [];
let prevBundleEnv: string | undefined;

afterEach(async () => {
  if (prevBundleEnv === undefined) delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
  else process.env.OPENPCB_BUNDLED_LIBRARY_PATH = prevBundleEnv;
  prevBundleEnv = undefined;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function isolate(label: string): void {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomUUID()}.sqlite`,
  );
}

async function bootRuntime(): Promise<ModuleRuntime> {
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({ moduleRegistry, workspaceRoot: REPO_ROOT });
  await runtime.bootstrap();
  return runtime;
}

async function bootServer() {
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: REPO_ROOT,
  });
  await moduleRuntime.bootstrap();
  return createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime,
  });
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function buildCorePackage(version: string): Uint8Array {
  const suffix = version.replace(/[^a-zA-Z0-9]+/g, "-");
  const symbolId = `openpcb.core.symbol.test-${suffix}`;
  const footprintId = `openpcb.core.footprint.test-${suffix}`;
  const componentId = `openpcb.core.test.${suffix}`;
  const symBytes = new TextEncoder().encode(JSON.stringify({ id: symbolId }));
  const fpBytes = new TextEncoder().encode(JSON.stringify({ id: footprintId }));
  const compBytes = new TextEncoder().encode(JSON.stringify({ id: componentId }));
  return packOpclib({
    library: {
      id: "openpcb.core",
      name: "OpenPCB Core Library",
      kind: "core",
      channel: "stable",
      version,
      license: "MIT",
      generatedAt: "2026-05-24T00:00:00.000Z",
    },
    symbols: [
      {
        entry: {
          id: symbolId,
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
          id: footprintId,
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
          id: componentId,
          uuid: crypto.randomUUID(),
          version: "1.0.0",
          name: "X",
          category: "test",
          symbol: symbolId,
          defaultFootprint: footprintId,
          footprints: [{ footprint: footprintId, label: "default" }],
          provenance: { source: "openpcb-original", license: "MIT" },
        },
        path: "components/x.component.json",
        bytes: compBytes,
      },
    ],
  }).bytes;
}

async function writePackage(root: string, version: string): Promise<string> {
  const dir = path.join(root, "resources", "core-library");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `openpcb-core-library-${version}.opclib`);
  await writeFile(file, buildCorePackage(version));
  return file;
}

describe("CoreLibrary status", () => {
  test("route reports installed and bundled core library", async () => {
    isolate("corelib-status-route");
    const server = await bootServer();
    const response = await server.fetch(
      new Request("http://localhost/api/modules/library/core-library/status"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { status: { state: string; installed: unknown; bundled: unknown } };
    };
    expect(body.data.status.state).toBe("up_to_date");
    expect(body.data.status.installed).not.toBeNull();
    expect(body.data.status.bundled).not.toBeNull();
  });

  test("service reports bundled update available after newer package appears", async () => {
    isolate("corelib-status-newer-bundled");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const oldRoot = await mkdtemp(path.join(os.tmpdir(), "corelib-old-"));
    const newRoot = await mkdtemp(path.join(os.tmpdir(), "corelib-new-"));
    tempRoots.push(oldRoot, newRoot);
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = await writePackage(oldRoot, "1.0.0");

    const runtime = await bootRuntime();
    delete process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    await writePackage(newRoot, "1.1.0");

    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof getCoreLibraryStatus>[0];
    const status = await getCoreLibraryStatus(ctx, {
      repoRoot: newRoot,
      nodeEnv: "production",
    });

    expect(status.installed?.version).toBe("1.0.0");
    expect(status.bundled?.version).toBe("1.1.0");
    expect(status.state).toBe("bundled_update_available");
  });

  test("check reports newer stable GitHub release and ignores prereleases", async () => {
    isolate("corelib-check-remote-newer");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "corelib-check-"));
    tempRoots.push(root);
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = await writePackage(root, "1.0.0");
    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof checkCoreLibraryUpdates>[0];

    const result = await checkCoreLibraryUpdates(ctx, {
      fetchImpl: async () =>
        Response.json([
          releaseFixture("v2.0.0-beta.1", true, "openpcb-core-library-2.0.0-beta.1.opclib"),
          releaseFixture("v1.1.0", false, "openpcb-core-library-1.1.0.opclib"),
        ]),
    });

    expect(result.state).toBe("remote_update_available");
    expect(result.remote?.version).toBe("1.1.0");
    expect(result.remote?.sha256SumsAssetUrl).toContain("SHA256SUMS");
  });

  test("check remains up to date when latest stable is not newer", async () => {
    isolate("corelib-check-up-to-date");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "corelib-check-same-"));
    tempRoots.push(root);
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = await writePackage(root, "1.1.0");
    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof checkCoreLibraryUpdates>[0];

    const result = await checkCoreLibraryUpdates(ctx, {
      fetchImpl: async () =>
        Response.json([
          releaseFixture("v1.1.0", false, "openpcb-core-library-1.1.0.opclib"),
          releaseFixture("v1.2.0-beta.1", false, "openpcb-core-library-1.2.0-beta.1.opclib"),
        ]),
    });

    expect(result.state).toBe("up_to_date");
    expect(result.remote?.version).toBe("1.1.0");
  });

  test("update downloads verified stable release and imports it in dev", async () => {
    isolate("corelib-update-dev");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "corelib-update-"));
    tempRoots.push(root);
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = await writePackage(root, "1.0.0");
    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof updateCoreLibrary>[0];
    const updateBytes = buildCorePackage("1.1.0");

    const result = await updateCoreLibrary(ctx, {
      minComponentCount: 1,
      nodeEnv: "development",
      fetchImpl: makeUpdateFetch("v1.1.0", "openpcb-core-library-1.1.0.opclib", updateBytes),
    });

    expect(result.imported?.sourceId).toBe("openpcb.core");
    expect(result.imported?.version).toBe("1.1.0");
    const status = await getCoreLibraryStatus(ctx, {
      repoRoot: root,
      nodeEnv: "production",
    });
    expect(status.installed?.version).toBe("1.1.0");
  });

  test("update rejects unsigned CoreLibrary in production", async () => {
    isolate("corelib-update-prod-unsigned");
    prevBundleEnv = process.env.OPENPCB_BUNDLED_LIBRARY_PATH;
    const root = await mkdtemp(path.join(os.tmpdir(), "corelib-update-prod-"));
    tempRoots.push(root);
    process.env.OPENPCB_BUNDLED_LIBRARY_PATH = await writePackage(root, "1.0.0");
    const runtime = await bootRuntime();
    const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
      .loaded.get("library")!.context as Parameters<typeof updateCoreLibrary>[0];
    const updateBytes = buildCorePackage("1.1.0");

    await expect(
      updateCoreLibrary(ctx, {
        minComponentCount: 1,
        nodeEnv: "production",
        fetchImpl: makeUpdateFetch("v1.1.0", "openpcb-core-library-1.1.0.opclib", updateBytes),
      }),
    ).rejects.toThrow(/unsigned/);
  });
});

function releaseFixture(tag: string, prerelease: boolean, opclibName: string): {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  assets: Array<{ name: string; browser_download_url: string }>;
} {
  return {
    tag_name: tag,
    html_url: `https://github.com/OpenPCB-app/CoreLibrary/releases/tag/${tag}`,
    draft: false,
    prerelease,
    published_at: "2026-05-24T00:00:00.000Z",
    assets: [
      {
        name: opclibName,
        browser_download_url: `https://github.com/OpenPCB-app/CoreLibrary/releases/download/${tag}/${opclibName}`,
      },
      {
        name: "SHA256SUMS",
        browser_download_url: `https://github.com/OpenPCB-app/CoreLibrary/releases/download/${tag}/SHA256SUMS`,
      },
    ],
  };
}

function makeUpdateFetch(
  tag: string,
  opclibName: string,
  opclibBytes: Uint8Array,
): (input: string, init?: RequestInit) => Promise<Response> {
  const sums = `${sha256(opclibBytes)}  ${opclibName}\n`;
  return async (input: string, _init?: RequestInit) => {
    if (input.endsWith("/releases")) {
      return Response.json([releaseFixture(tag, false, opclibName)]);
    }
    if (input.endsWith(opclibName)) {
      return new Response(opclibBytes);
    }
    if (input.endsWith("SHA256SUMS")) {
      return new Response(sums);
    }
    return new Response("not found", { status: 404 });
  };
}
