import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getSharedSqlite } from "../db/sqlite-client";
import { captureNetIdentityBackup, type NetIdentityBackupSnapshot } from "../../../modules/designer/backend/net-identity/backup";
import { readNetIdentityState, writeNetIdentityState } from "../../../modules/designer/backend/net-identity/state-store";
import { seqOf } from "../../../modules/designer/backend/net-identity/types";
import { designHeads, netIdentityBackups, netIdentityState, pcbEntities } from "../../../modules/designer/backend/schema";
import { dispatchOk } from "./helpers/designer-runtime";
import { rawDesignerRows, request, routesRuntime, status } from "./helpers/net-identity-routes-runtime";

describe("net identity recovery HTTP routes", () => {
  test("unmigrated GET returns flat status without changing any designer row", async () => {
    const runtime = await routesRuntime(), before = rawDesignerRows();
    expect(await status(runtime)).toMatchObject({ revision: runtime.original.revision,
      status: "unmigrated", mode: "legacy", exportBlocked: true, groups: [] });
    expect(rawDesignerRows()).toBe(before);
  });

  test("active status reports actual orphan references; retry is byte-exact no-op", async () => {
    const runtime = await routesRuntime();
    const migrated = await status(runtime, "/migrate");
    expect(migrated).toMatchObject({ status: "active", mode: "durable", revision: runtime.original.revision + 1 });
    const trace = runtime.db.select().from(pcbEntities).where(eq(pcbEntities.kind, "trace")).get()!;
    const payload: Record<string, unknown> = { ...JSON.parse(trace.payloadJson) as Record<string, unknown>, netId: "foreign-net", netName: null };
    runtime.db.update(pcbEntities).set({ payloadJson: JSON.stringify(payload) }).where(eq(pcbEntities.id, trace.id)).run();
    const before = rawDesignerRows(), summary = await status(runtime);
    expect(summary.orphanedCopperCount).toBeGreaterThan(0);
    expect(summary.groups.find((group) => group.netId === "foreign-net")?.copper.traceIds).toContain(payload.id as string);
    expect(summary.exportBlocked).toBe(true);
    expect(await status(runtime, "/migrate")).toEqual(summary);
    expect(rawDesignerRows()).toBe(before);
  });

  test.each(["", "/migrate", "/restore-legacy"])("missing design returns 404 for %s", async (action) => {
    const runtime = await routesRuntime(), before = rawDesignerRows();
    expect((await request(runtime, action, {}, "missing")).status).toBe(404);
    expect(rawDesignerRows()).toBe(before);
  });

  test("explicit failed retry preserves watermark and returns fresh active status", async () => {
    const runtime = await routesRuntime();
    writeNetIdentityState(runtime.db, { designId: runtime.designId, schemaVersion: 1, status: "migration_failed",
      nextSeq: 70, active: [], provenance: { origin: "legacy-migration", createdAt: "2026-10-22T00:00:00.000Z", migratorVersion: 1 },
      lastError: "prior failure", updatedAt: "2026-10-22T00:00:00.000Z" });
    expect(await status(runtime)).toMatchObject({ status: "migration_failed", lastError: "prior failure" });
    expect(await status(runtime, "/migrate")).toMatchObject({ status: "active", lastError: null });
    expect(Math.min(...readNetIdentityState(runtime.db, runtime.designId)!.active.map((net) => seqOf(net.id)!))).toBe(70);
  });

  test("unsuccessful retry returns persisted failure without changing source rows", async () => {
    const runtime = await routesRuntime();
    const legacy = runtime.db.select().from(pcbEntities).where(eq(pcbEntities.kind, "board_settings")).get()!;
    const raw = JSON.parse(legacy.payloadJson) as Record<string, unknown>;
    raw.perNetClassAssignments = { ...(raw.perNetClassAssignments as Record<string, string>), broken: "future-class" };
    runtime.db.update(pcbEntities).set({ payloadJson: JSON.stringify(raw) }).where(eq(pcbEntities.id, legacy.id)).run();
    // A duplicate raw geometry ID makes exact reference migration unsafe.
    const trace = runtime.db.select().from(pcbEntities).where(eq(pcbEntities.kind, "trace")).get()!;
    runtime.db.insert(pcbEntities).values({ ...trace, id: crypto.randomUUID() }).run();
    const original = captureNetIdentityBackup(runtime.db, runtime.designId, "2026-10-22T00:00:00.000Z").payloadJson;
    const result = await status(runtime, "/migrate");
    expect(result).toMatchObject({ status: "migration_failed", mode: "legacy", revision: runtime.original.revision });
    expect(result.lastError).toBeTruthy();
    expect(captureNetIdentityBackup(runtime.db, runtime.designId, "2026-10-22T00:00:00.000Z").payloadJson).toBe(original);
  });

  test("restore refuses later schematic edits until strict true, then restores raw backup", async () => {
    const runtime = await routesRuntime();
    const source = captureNetIdentityBackup(runtime.db, runtime.designId, "2026-10-22T00:00:00.000Z");
    await status(runtime, "/migrate");
    const first = readNetIdentityState(runtime.db, runtime.designId)!;
    await dispatchOk(runtime.sdk, runtime.designId, { type: "upsert_label", text: "AFTER_MIGRATION", positionNm: { x: 90_000_000, y: 90_000_000 } });
    const editedHead = runtime.db.select().from(designHeads).where(eq(designHeads.id, runtime.designId)).get()!;
    const watermark = readNetIdentityState(runtime.db, runtime.designId)!.nextSeq, before = rawDesignerRows();
    const conflict = await request(runtime, "/restore-legacy");
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ type: "https://openpcb.dev/problems/net-identity-restore-discards-edits" });
    expect(rawDesignerRows()).toBe(before);
    const restored = await status(runtime, "/restore-legacy", { confirmDiscardRevisions: true });
    expect(restored).toMatchObject({ status: "legacy_restored", mode: "legacy", revision: editedHead.revision + 1 });
    const restoredSource = JSON.parse(captureNetIdentityBackup(runtime.db, runtime.designId, "2026-10-22T00:00:00.000Z").payloadJson) as NetIdentityBackupSnapshot;
    const originalSource = JSON.parse(source.payloadJson) as NetIdentityBackupSnapshot;
    expect({ ...restoredSource, revision: originalSource.revision }).toEqual(originalSource);
    expect(readNetIdentityState(runtime.db, runtime.designId)!.nextSeq).toBe(watermark);
    const afterRestore = rawDesignerRows();
    expect(await status(runtime)).toEqual(restored);
    expect(rawDesignerRows()).toBe(afterRestore);
    expect(await status(runtime, "/migrate")).toMatchObject({ status: "active", mode: "durable", revision: restored.revision + 1 });
    expect(Math.min(...readNetIdentityState(runtime.db, runtime.designId)!.active.map((net) => seqOf(net.id)!)))
      .toBeGreaterThan(Math.max(...first.active.map((net) => seqOf(net.id)!)));
  });

  test.each([null, [], "yes", 1, { confirmDiscardRevisions: "true" }, { confirmDiscardRevisions: null }, { confirmDiscardRevisions: 1 }].map((body) => ({ body })))(
    "malformed restore body %j returns 400 without writes", async ({ body }) => {
      const runtime = await routesRuntime(), before = rawDesignerRows();
      const response = await runtime.server.fetch(new Request(`http://localhost/api/modules/designer/designs/${runtime.designId}/net-identity/restore-legacy`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }));
      expect(response.status).toBe(400);
      expect(rawDesignerRows()).toBe(before);
    });

  test("invalid JSON returns 400", async () => {
    const runtime = await routesRuntime(), before = rawDesignerRows();
    const response = await runtime.server.fetch(new Request(`http://localhost/api/modules/designer/designs/${runtime.designId}/net-identity/restore-legacy`, { method: "POST", body: "{" }));
    expect(response.status).toBe(400);
    expect(rawDesignerRows()).toBe(before);
  });

  test("native state cannot restore and has no backup", async () => {
    const runtime = await routesRuntime(), native = await runtime.sdk.createDesign({ name: "Native" });
    const before = rawDesignerRows();
    const response = await request(runtime, "/restore-legacy", {}, native.id);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NET_IDENTITY_RESTORE_INVALID" });
    expect(rawDesignerRows()).toBe(before);
  });

  test.each(["backup", "state", "missing-backup"])("invalid %s refuses restore with 422 and no changes", async (kind) => {
    const runtime = await routesRuntime();
    await status(runtime, "/migrate");
    if (kind === "backup") runtime.db.update(netIdentityBackups).set({ payloadJson: "{bad" }).where(eq(netIdentityBackups.designId, runtime.designId)).run();
    if (kind === "state") runtime.db.update(netIdentityState).set({ provenanceJson: "{bad" }).where(eq(netIdentityState.designId, runtime.designId)).run();
    if (kind === "missing-backup") runtime.db.delete(netIdentityBackups).where(eq(netIdentityBackups.designId, runtime.designId)).run();
    const before = rawDesignerRows(), response = await request(runtime, "/restore-legacy", { confirmDiscardRevisions: true });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NET_IDENTITY_RESTORE_INVALID" });
    expect(rawDesignerRows()).toBe(before);
  });

  test("real storage errors remain 500 rather than invalid-restore errors", async () => {
    const runtime = await routesRuntime();
    await status(runtime, "/migrate");
    getSharedSqlite().exec("CREATE TRIGGER fail_restore BEFORE DELETE ON designer_pcb_entities BEGIN SELECT RAISE(ABORT, 'storage fault'); END");
    const before = rawDesignerRows(), response = await request(runtime, "/restore-legacy");
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ type: "https://openpcb.dev/problems/internal-error" });
    expect(rawDesignerRows()).toBe(before);
  });
});
