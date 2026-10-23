import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import type { DesignerSDK, PcbZone } from "../../../sdks/designer";
import { MODULE_SDK_TOKENS } from "../../../sdks";
import { assertNetIdentityExportable } from "../../../modules/designer/backend/net-identity/export-gate";
import { loadPcbProjection } from "../../../modules/designer/backend/pcb/pcb-projection";
import { resetCaptureRuntimeForTesting } from "../../../modules/designer/backend/capture";
import { designHeads, netIdentityRetired, netIdentityState, pcbEntities } from "../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite, resetSharedSqliteForTesting } from "../db/sqlite-client";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { createHttpServer } from "../http/create-http-server";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";
import { freePad, projection, trace, via } from "./helpers/drc-fixtures";
import { designNetSalt, formatDurableNetId } from "../../../modules/designer/backend/net-identity/types";

const TS = "2026-10-22T12:00:00.000Z", ROOT = "pt:stale";
const envNames = ["OPENPCB_DB_PATH", "APP_DATA_DIR", "OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE", "OPENPCB_FEATURE_DATASET_CAPTURE", "NODE_ENV"];
const previous = envNames.map((name) => process.env[name]);
const folder = mkdtempSync(join(tmpdir(), "net-identity-export-"));
let sdk: DesignerSDK, runtime: ModuleRuntime, server: ReturnType<typeof createHttpServer>;

beforeAll(async () => {
  resetSharedSqliteForTesting(); resetCaptureRuntimeForTesting();
  process.env.OPENPCB_DB_PATH = join(folder, "domain.sqlite"); process.env.APP_DATA_DIR = folder;
  process.env.OPENPCB_FEATURE_DATASET_CAPTURE = "0"; process.env.NODE_ENV = "test";
  const moduleRegistry = new ModuleRouterRegistry();
  runtime = new ModuleRuntime({ moduleRegistry, workspaceRoot: resolve(import.meta.dir, "../../..") });
  await runtime.bootstrap();
  sdk = runtime.getSdkRegistry().resolve<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  server = createHttpServer({ diagnosticsStore: new DiagnosticsStore(), moduleRegistry, moduleRuntime: runtime });
}, 30_000);
beforeEach(() => { process.env.OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE = "0"; });
afterAll(async () => {
  await runtime?.shutdown(); resetCaptureRuntimeForTesting(); resetSharedSqliteForTesting();
  envNames.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  rmSync(folder, { recursive: true, force: true });
});

function seed(designId: string, kind: string, payload: unknown): void {
  getSharedDb().insert(pcbEntities).values({ id: crypto.randomUUID(), designId, kind, payloadJson: JSON.stringify(payload), createdAt: TS, updatedAt: TS }).run();
}
function zone(netId = ROOT, enabled = true): PcbZone {
  return { id: "zone", enabled, name: "Authored", lockedAt: null, layer: "F.Cu", netId, netName: null,
    region: { kind: "polygon", pointsMm: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] }, priority: 0 };
}
function raw(designId: string): string {
  return JSON.stringify(["design_heads", "pcb_entities", "net_identity_state", "net_identity_retired", "net_identity_quarantine"].map((table) =>
    getSharedSqlite().query(`SELECT * FROM designer_${table} WHERE ${table === "design_heads" ? "id" : "design_id"} = ? ORDER BY 1`).all(designId)));
}
function boardRow(designId: string) {
  return getSharedDb().select().from(pcbEntities).where(and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, "board_settings"))).get()!;
}
function updateRawRules(designId: string): void {
  const row = boardRow(designId), board = JSON.parse(row.payloadJson) as Record<string, unknown>;
  board.perNetClassAssignments = { [ROOT]: "default" };
  board.lengthMatchGroups = [{ id: "length", name: "Length", netIds: [ROOT], target: { kind: "longest" }, toleranceMm: 0 }];
  board.diffPairs = [{ id: "pair", name: "Pair", pNetId: ROOT, nNetId: "pt:other" }];
  board.drcRules = [{ id: "rule", name: "Rule", enabled: true, priority: 0, scopes: [{ kind: "net", netIds: [ROOT] }], constraint: { kind: "clearance", mm: 0.5 } }];
  board.future = { raw: "retained" };
  getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify(board) }).where(eq(pcbEntities.id, row.id)).run();
}
async function request(designId: string, format: "pnp.csv" | "gerber?format=summary"): Promise<Response> {
  return server.fetch(new Request(`http://localhost/api/modules/designer/designs/${designId}/exports/${format}`,
    format === "pnp.csv" ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ allowDrcViolations: true }) }));
}
async function blocked(designId: string, expected: Record<string, unknown>): Promise<void> {
  for (const format of ["pnp.csv", "gerber?format=summary"] as const) {
    const response = await request(designId, format);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ status: 422, code: "NET_IDENTITY_UNQUALIFIED", ...expected });
  }
  await expect(sdk.getManufacturingExportSummary(designId)).rejects.toMatchObject({ status: 422,
    extras: { code: "NET_IDENTITY_UNQUALIFIED", ...expected } });
}

describe("manufacturing net identity qualification", () => {
  test("native active empty design qualifies when global quarantine is off", async () => {
    const design = await sdk.createDesign({ name: "Qualified empty native" });
    expect((await sdk.getPcbProjection(design.id))!.netIdentity).toMatchObject({ mode: "durable", status: "active", exportBlocked: false, groups: [] });
    for (const format of ["pnp.csv", "gerber?format=summary"] as const) expect((await request(design.id, format)).status).toBe(200);
    expect(await sdk.getManufacturingExportSummary(design.id)).not.toBeNull();
  });
  test.each(["trace", "via", "free_pad", "zone"])("raw orphaned %s blocks both HTTP exports and SDK summary", async (kind) => {
    const design = await sdk.createDesign();
    const payload = kind === "trace" ? { ...trace("trace", ROOT, [[0, 0], [1, 0]]), future: "retained" } :
      kind === "via" ? via("via", { netId: ROOT }) : kind === "free_pad" ? freePad("pad", { netId: ROOT }) : zone();
    seed(design.id, kind, payload); const before = raw(design.id);
    await blocked(design.id, { mode: "durable", identityStatus: "active", orphanedCopperCount: 1, inertRuleReferenceCount: 0 });
    expect(raw(design.id)).toBe(before);
  });
  test.each([false, true])("canonical inactive rules block with malformed outline=%s and no copper", async (malformedOutline) => {
    const design = await sdk.createDesign(); updateRawRules(design.id); const before = raw(design.id);
    if (malformedOutline) {
      const row = boardRow(design.id), board = JSON.parse(row.payloadJson) as Record<string, unknown>;
      getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify({ ...board, outline: false }) }).where(eq(pcbEntities.id, row.id)).run();
    }
    const authored = malformedOutline ? raw(design.id) : before;
    await blocked(design.id, { orphanedCopperCount: 0, inertRuleReferenceCount: 5 });
    expect(raw(design.id)).toBe(authored);
  });
  test("disabled-zone-only stale reference is visible and never blocks", async () => {
    const design = await sdk.createDesign(); seed(design.id, "zone", zone(ROOT, false));
    const before = raw(design.id), pcb = (await sdk.getPcbProjection(design.id))!;
    expect(pcb.netIdentity).toMatchObject({ orphanedCopperCount: 0, exportBlocked: false, groups: [{ disabledZoneIds: ["zone"], copper: { zoneIds: [] } }] });
    for (const format of ["pnp.csv", "gerber?format=summary"] as const) expect((await request(design.id, format)).status).toBe(200);
    expect(await sdk.getManufacturingExportSummary(design.id)).not.toBeNull(); expect(raw(design.id)).toBe(before);
  });
  test("unresolved authored name blocks before effective-zone filtering", async () => {
    const design = await sdk.createDesign(); seed(design.id, "zone", { ...zone(), netId: null, netName: " Missing " });
    const pcb = (await sdk.getPcbProjection(design.id))!;
    expect(pcb.netIdentity).toMatchObject({ orphanedCopperCount: 1, groups: [{ netId: null, netName: " Missing ", reason: "unresolved-name" }] });
    await blocked(design.id, { orphanedCopperCount: 1 });
  });
  test("matching display hints never repair raw durable references during projection", async () => {
    const design = await sdk.createDesign();
    const placed = await sdk.dispatchCommand(design.id, { commandId: crypto.randomUUID(), sessionId: "projection", aggregateId: design.id,
      baseRevision: 0, issuedAt: Date.now(), command: { type: "place_pwr_port", railText: "LIVE_HINT", positionNm: { x: 0, y: 0 } } });
    expect(placed.ok).toBe(true);
    const stale = formatDurableNetId(designNetSalt(design.id), 999);
    seed(design.id, "trace", { ...trace("stale", stale, [[0, 0], [1, 0]]), netName: "LIVE_HINT" });
    seed(design.id, "trace", { ...trace("hint", null, [[0, 1], [1, 1]]), netName: " LIVE_HINT " });
    const before = raw(design.id), pcb = (await sdk.getPcbProjection(design.id))!;
    expect(pcb.netIdentity).toMatchObject({ orphanedCopperCount: 2, groups: [
      { netId: stale, netName: "LIVE_HINT", reason: "unknown", suggestedNetId: null },
      { netId: null, netName: " LIVE_HINT ", reason: "unresolved-name", suggestedNetId: null },
    ] });
    expect(pcb.traces.find((item) => item.id === "stale")).toMatchObject({ netId: stale, netName: "LIVE_HINT" });
    expect(pcb.traces.find((item) => item.id === "hint")).toMatchObject({ netId: null, netName: " LIVE_HINT " });
    expect(raw(design.id)).toBe(before); await blocked(design.id, { orphanedCopperCount: 2 });
  });
  test.each(["migration_failed", "legacy_restored", "corrupt"])("%s mode fails closed and preserves raw state/references", async (status) => {
    const design = await sdk.createDesign(); seed(design.id, "trace", { ...trace("trace", ROOT, [[0, 0], [1, 0]]), netName: "GND" });
    getSharedDb().update(netIdentityState).set(status === "corrupt" ? { activeJson: "{broken" } : { status, lastError: status === "migration_failed" ? "migration failed" : null }).where(eq(netIdentityState.designId, design.id)).run();
    const before = raw(design.id);
    await blocked(design.id, { mode: "legacy", identityStatus: status === "corrupt" ? "unmigrated" : status, groups: [] });
    expect(raw(design.id)).toBe(before);
  });
  test("corrupt retirement metadata makes durable state unavailable without repair", async () => {
    const design = await sdk.createDesign(), netId = formatDurableNetId(designNetSalt(design.id), 1);
    getSharedDb().insert(netIdentityRetired).values({ designId: design.id, netId, seq: 1, reason: "history", successorIdsJson: "{broken", displayName: null, retiredAtRevision: 0, createdAt: TS, updatedAt: TS }).run();
    const before = raw(design.id);
    await blocked(design.id, { mode: "legacy", identityStatus: "unmigrated" }); expect(raw(design.id)).toBe(before);
  });
  test("missing optional summary fails closed; error groups are capped at 50", async () => {
    let error: unknown;
    try { assertNetIdentityExportable(projection()); } catch (failure) { error = failure; }
    expect(error).toMatchObject({ status: 422, extras: { code: "NET_IDENTITY_UNQUALIFIED", identityStatus: "unmigrated", mode: "legacy" } });
    const design = await sdk.createDesign();
    for (let index = 0; index < 60; index++) seed(design.id, "trace", trace(`trace-${index}`, `root-${index}`, [[0, 0], [1, 0]]));
    const response = await request(design.id, "pnp.csv"), problem = await response.json() as { status: number; groups: unknown[]; orphanedCopperCount: number };
    expect(response.status).toBe(422); expect(problem.status).toBe(422);
    expect(problem.orphanedCopperCount).toBe(60); expect(problem.groups).toHaveLength(50);
  });
  test("global manufacturing quarantine remains first, including missing designs", async () => {
    process.env.OPENPCB_FEATURE_DESIGNER_OUTPUTQUARANTINE = "1";
    for (const format of ["pnp.csv", "gerber?format=summary"] as const) {
      const response = await request("missing-design", format);
      expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ code: "UNQUALIFIED_MANUFACTURING", status: 422 });
    }
    await expect(sdk.getManufacturingExportSummary("missing-design")).rejects.toMatchObject({ status: 422, extras: { code: "UNQUALIFIED_MANUFACTURING" } });
  });
  test("missing designs retain normal not-found behavior when global quarantine is off", async () => {
    for (const format of ["pnp.csv", "gerber?format=summary"] as const) expect((await request("missing-design", format)).status).toBe(404);
    expect(await sdk.getManufacturingExportSummary("missing-design")).toBeNull();
  });
  test("missing schematic cannot fabricate qualified live identity", async () => {
    const design = await sdk.createDesign(); getSharedDb().delete(designHeads).where(eq(designHeads.id, design.id)).run();
    const before = raw(design.id), pcb = loadPcbProjection({ db: getSharedDb(), designId: design.id, revision: 0, timestamp: TS, identityMode: "durable" });
    expect(pcb.netIdentity).toMatchObject({ status: "unmigrated", mode: "legacy", exportBlocked: true, groups: [], lastError: "Schematic projection unavailable." });
    expect(raw(design.id)).toBe(before); expect(() => assertNetIdentityExportable(pcb)).toThrow("Net identity is not qualified");
  });
});
