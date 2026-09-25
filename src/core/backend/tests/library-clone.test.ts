import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import type { LibraryComponentDetail } from "../../../sdks/library";
import {
  assertFootprintNotBuiltinComponent,
  getDb,
} from "../../../modules/library/backend/queries";
import {
  componentFootprints,
  components,
  footprintModels,
  footprints,
  symbols,
} from "../../../modules/library/backend/schema";
import { resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import {
  createHttpServer,
  type RuntimeServer,
} from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

type LibraryCtx = Parameters<typeof getDb>[0];

const tempRoots: string[] = [];
const URL_BASE = "http://localhost/api/modules/library";
const GLB_SHA = "a".repeat(64);
const SOURCE_ID = "qa.core.resistor";
const LEGACY_ID = "qa.core.legacy";

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function boot(
  label: string,
): Promise<{ server: RuntimeServer; ctx: LibraryCtx }> {
  resetSharedSqliteForTesting();
  const root = mkdtempSync(path.join(os.tmpdir(), `openpcb-${label}-`));
  tempRoots.push(root);
  process.env.OPENPCB_DB_PATH = path.join(root, "openpcb.sqlite");
  const moduleRegistry = new ModuleRouterRegistry();
  const runtime = new ModuleRuntime({
    moduleRegistry,
    workspaceRoot: path.resolve(import.meta.dir, "../../.."),
  });
  await runtime.bootstrap();
  const ctx = (runtime as unknown as { loaded: Map<string, { context: unknown }> })
    .loaded.get("library")!.context as LibraryCtx;
  seedBuiltin(getDb(ctx));
  const server = createHttpServer({
    diagnosticsStore: new DiagnosticsStore(),
    moduleRegistry,
    moduleRuntime: runtime,
  });
  return { server, ctx };
}

/** A built-in part with three footprint options (pin maps, labels) + one 3D model, and a legacy one with none. */
function seedBuiltin(db: ReturnType<typeof getDb>): void {
  const now = new Date().toISOString();
  db.insert(symbols)
    .values({ id: "qa.sym.r", name: "R", dataJson: "{}", createdAt: now, sourceId: "openpcb.core" })
    .run();
  for (const size of ["0402", "0603", "0805"]) {
    db.insert(footprints)
      .values({
        id: `qa.fp.r${size}`,
        name: `R_${size}`,
        dataJson: JSON.stringify({ normalized: { mountType: "smd", padCount: 2 } }),
        createdAt: now,
        sourceId: "openpcb.core",
      })
      .run();
  }
  db.insert(footprintModels)
    .values({
      footprintId: "qa.fp.r0603",
      status: "ready",
      glbPath: `models/glb/${GLB_SHA}.glb`,
      glbSha256: GLB_SHA,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const base = {
    description: "Thick film resistor",
    symbolId: "qa.sym.r",
    tagsJson: JSON.stringify(["builtin", "resistor", "passive"]),
    createdAt: now,
    isBuiltin: 1,
    sourceId: "openpcb.core",
    version: "1.2.0",
  };
  db.insert(components)
    .values({
      ...base,
      id: SOURCE_ID,
      name: "Resistor",
      footprintId: "qa.fp.r0603",
      manufacturer: "Yageo",
      manufacturerPartNumber: "RC0603FR-0710KL",
      lcscPartNumber: "C98220",
      supplier: "LCSC",
      subcategory: "chip-resistor",
      datasheetUrl: "https://example.com/rc.pdf",
      keywordsJson: JSON.stringify(["resistor", "10k"]),
    })
    .run();
  ["0402", "0603", "0805"].forEach((size, index) => {
    db.insert(componentFootprints)
      .values({
        componentId: SOURCE_ID,
        footprintId: `qa.fp.r${size}`,
        isDefault: size === "0603" ? 1 : 0,
        variantLabel: `${size} (Imperial)`,
        sortOrder: index,
        pinMapJson: JSON.stringify([
          { pinNumber: "1", padNumber: "2", pinName: "A" },
          { pinNumber: "2", padNumber: "1", pinName: "B" },
        ]),
      })
      .run();
  });
  db.insert(components)
    .values({ ...base, id: LEGACY_ID, name: "Legacy", footprintId: "qa.fp.r0805" })
    .run();
}

async function clone(server: RuntimeServer, id: string): Promise<string> {
  const res = await server.fetch(
    new Request(`${URL_BASE}/components/${id}/clone`, { method: "POST" }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { data: { componentId: string } }).data.componentId;
}

async function detail(
  server: RuntimeServer,
  id: string,
): Promise<LibraryComponentDetail> {
  const res = await server.fetch(new Request(`${URL_BASE}/components/${id}/detail`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: { detail: LibraryComponentDetail } }).data.detail;
}

describe("Duplicate to edit (POST /components/:id/clone)", () => {
  test("copies every footprint option, pin map and the metadata columns", async () => {
    const { server } = await boot("library-clone-faithful");
    const copyId = await clone(server, SOURCE_ID);
    const [source, copy] = await Promise.all([
      detail(server, SOURCE_ID),
      detail(server, copyId),
    ]);

    const optionShape = (d: LibraryComponentDetail) =>
      d.footprintVariants.map(({ variantLabel, isDefault, sortOrder, name, pinMap }) => ({
        variantLabel,
        isDefault,
        sortOrder,
        name,
        pinMap,
      }));
    expect(copy.footprintVariants).toHaveLength(3);
    expect(optionShape(copy)).toEqual(optionShape(source));

    const { id: _sid, name: _sname, isBuiltin: _sb, tags: _st, origin: _so, ...sourceMeta } =
      source.component;
    const { id: _cid, name: copyName, isBuiltin, tags: _ct, origin, ...copyMeta } =
      copy.component;
    expect(copyMeta).toMatchObject({
      ...sourceMeta,
      symbolId: source.component.symbolId,
      footprintId: expect.any(String),
    });
    expect(copyMeta.manufacturerPartNumber).toBe("RC0603FR-0710KL");
    expect(copyMeta.keywords).toEqual(["resistor", "10k"]);
    expect(copyName).toBe("Resistor (Copy)");
    expect(isBuiltin).toBe(false);
    expect(origin).toEqual({
      libraryId: "openpcb.core",
      componentId: SOURCE_ID,
      componentVersion: "1.2.0",
    });
  });

  test("the copy owns its footprints, so its 3D model can be replaced", async () => {
    const { server, ctx } = await boot("library-clone-owned-footprints");
    const copyId = await clone(server, SOURCE_ID);
    const copy = await detail(server, copyId);

    const sourceFootprintIds = ["qa.fp.r0402", "qa.fp.r0603", "qa.fp.r0805"];
    for (const variant of copy.footprintVariants) {
      expect(sourceFootprintIds).not.toContain(variant.footprintId);
      expect(() =>
        assertFootprintNotBuiltinComponent(ctx, variant.footprintId, "update"),
      ).not.toThrow();
    }
    expect(() =>
      assertFootprintNotBuiltinComponent(ctx, "qa.fp.r0603", "update"),
    ).toThrow(/Duplicate to edit/);

    const defaultCopy = copy.footprintVariants.find((v) => v.isDefault)!;
    expect(copy.component.footprintId).toBe(defaultCopy.footprintId);
    const meta = await server.fetch(
      new Request(`${URL_BASE}/footprints/${defaultCopy.footprintId}/model/meta`),
    );
    const body = (await meta.json()) as { data: { status: string; glbSha256: string } };
    expect(body.data).toMatchObject({ status: "ready", glbSha256: GLB_SHA });
  });

  test("a component without option rows copies its default footprint as one option", async () => {
    const { server } = await boot("library-clone-legacy");
    const copy = await detail(server, await clone(server, LEGACY_ID));
    expect(copy.footprintVariants).toHaveLength(1);
    expect(copy.footprintVariants[0]).toMatchObject({
      variantLabel: "R_0805",
      isDefault: true,
    });
  });

  test("deleting the copy removes its private footprints and leaves the source intact", async () => {
    const { server, ctx } = await boot("library-clone-delete");
    const copyId = await clone(server, SOURCE_ID);
    const res = await server.fetch(
      new Request(`${URL_BASE}/components/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [copyId] }),
      }),
    );
    expect(res.status).toBe(200);
    const result = (await res.json()) as { data: { deletedFootprints: number } };
    expect(result.data.deletedFootprints).toBe(3);

    const db = getDb(ctx);
    expect(
      db
        .select()
        .from(footprints)
        .where(inArray(footprints.id, ["qa.fp.r0402", "qa.fp.r0603", "qa.fp.r0805"]))
        .all(),
    ).toHaveLength(3);
    expect(
      db.select().from(footprintModels).where(eq(footprintModels.glbSha256, GLB_SHA)).all(),
    ).toHaveLength(1);
    expect((await detail(server, SOURCE_ID)).footprintVariants).toHaveLength(3);
  });
});
