import { eq } from "drizzle-orm";
import type { DesignerCommand, DesignerPcbRebindNetReferencesCommand } from "../../../../sdks/designer";
import { ensurePcbBoardSettings } from "../../../../modules/designer/backend/pcb/pcb-store";
import { pcbEntities, sessionHistories } from "../../../../modules/designer/backend/schema";
import { getSharedDb, getSharedSqlite } from "../../db/sqlite-client";
import { body, openIdentityRuntime, send } from "./net-identity-runtime";

export const REPAIR_SESSION = "repair";
export const OLD = "legacy-root", DROP = "discard-root", HINT = " Exact Hint ";

export async function rebindRuntime() {
  const runtime = await openIdentityRuntime();
  const design = await runtime.store.createDesign({ name: "Rebind" });
  const targetLabel = await send(runtime, design.id, { type: "upsert_label", text: "TARGET", positionNm: { x: 50_000_000, y: 50_000_000 } }, "setup");
  const otherLabel = await send(runtime, design.id, { type: "upsert_label", text: "OTHER", positionNm: { x: 70_000_000, y: 50_000_000 } }, "setup");
  const nets = (await runtime.store.getSchematicProjection(design.id))!.nets;
  const target = nets.find((net) => net.labelIds.includes(targetLabel.createdEntityId!))!.id;
  const other = nets.find((net) => net.labelIds.includes(otherLabel.createdEntityId!))!.id;
  return { ...runtime, designId: design.id, target, other, targetLabelId: targetLabel.createdEntityId! };
}

export type RebindRuntime = Awaited<ReturnType<typeof rebindRuntime>>;

export function insertCopper(runtime: RebindRuntime, kind: string, payload: Record<string, unknown>, rowId: string = crypto.randomUUID()): string {
  getSharedDb().insert(pcbEntities).values({ id: rowId, designId: runtime.designId, kind,
    payloadJson: JSON.stringify(payload), createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z" }).run();
  return rowId;
}

export function readPayload(rowId: string): Record<string, unknown> {
  return JSON.parse(getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.id, rowId)).get()!.payloadJson) as Record<string, unknown>;
}

export function updatePayload(rowId: string, update: Record<string, unknown>): void {
  getSharedDb().update(pcbEntities).set({ payloadJson: JSON.stringify({ ...readPayload(rowId), ...update }) }).where(eq(pcbEntities.id, rowId)).run();
}

export function copper(runtime: RebindRuntime, id: string, netId: string | null = OLD, netName: string | null = "Provenance") {
  return insertCopper(runtime, "trace", { id, netId, netName, netClassId: "default", layer: "F.Cu", widthMm: 0.25,
    pointsNm: [{ x: 1_000_000, y: 2_000_000 }, { x: 3_000_000, y: 2_000_000 }], segmentMode: "manhattan-90", future: { keep: [1, 2] } }, id);
}

export function fullReferences(runtime: RebindRuntime) {
  const db = getSharedDb();
  ensurePcbBoardSettings(db, runtime.designId, "2026-10-22T00:00:00.000Z");
  const board = db.select().from(pcbEntities).where(eq(pcbEntities.kind, "board_settings")).get()!;
  updatePayload(board.id, { future: { keep: true }, designRules: { unknownLimit: "retain" },
    perNetClassAssignments: { [OLD]: "default", [DROP]: "default", [runtime.target]: "destination-class" },
    lengthMatchGroups: [{ id: "keep-length", netIds: [OLD, runtime.other, OLD], future: "retain" }, { id: "drop-length", netIds: [DROP], future: [3] }, null],
    diffPairs: [{ id: "keep-pair", pNetId: OLD, nNetId: runtime.other, future: 1 }, { id: "drop-pair", pNetId: DROP, nNetId: runtime.other, future: 2 }],
    drcRules: [{ id: "keep-rule", scopes: [{ kind: "net", netIds: [OLD], vendor: { keep: 7 } }], future: "rule" },
      { id: "drop-rule", scopes: [{ kind: "net", netIds: [DROP] }], future: "remove" }, 13] });
  const trace = copper(runtime, "trace");
  const via = insertCopper(runtime, "via", { id: "via", netId: OLD, netName: "Provenance", kind: "future", future: [1] });
  const pad = insertCopper(runtime, "free_pad", { id: "pad", netId: OLD, netName: "Pad hint", future: "pad" });
  const zone = insertCopper(runtime, "zone", { id: "zone", netId: OLD, netName: "Zone hint", enabled: true, future: "zone" });
  const disabled = insertCopper(runtime, "zone", { id: "disabled", netId: OLD, netName: "Disabled hint", enabled: false });
  const cleared = insertCopper(runtime, "zone", { id: "clear-zone", netId: DROP, netName: "Clear hint", enabled: true, future: "clear" });
  const hinted = copper(runtime, "hinted", null, HINT);
  const unmatched = copper(runtime, "unmatched", null, HINT.trim());
  return { board: board.id, trace, via, pad, zone, disabled, cleared, hinted, unmatched };
}

export function command(runtime: RebindRuntime): DesignerPcbRebindNetReferencesCommand {
  return { type: "pcb_rebind_net_references", bindings: [{ fromNetId: OLD, toNetId: runtime.target },
    { fromNetId: DROP, toNetId: null }, { fromNetId: null, fromNetName: HINT, toNetId: runtime.target }] };
}

export function repair(runtime: RebindRuntime, value: DesignerCommand = command(runtime)) {
  return runtime.store.dispatchCommand(runtime.designId, body(runtime.designId, value, REPAIR_SESSION));
}

export function rawState(designId: string, tables = ["design_heads", "pcb_entities", "session_histories", "net_identity_state", "net_identity_retired", "net_identity_quarantine", "net_identity_backups"]): string {
  return JSON.stringify(tables.map((table) => getSharedSqlite().query(`SELECT * FROM designer_${table} WHERE ${table === "design_heads" ? "id" : "design_id"} = ? ORDER BY rowid`).all(designId)));
}

export function identityRows(designId: string): string {
  return rawState(designId, ["net_identity_state", "net_identity_retired", "net_identity_quarantine", "net_identity_backups"]);
}

export function allDesignerRows(): string {
  const sqlite = getSharedSqlite();
  const tables = sqlite.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'designer_%' ORDER BY name").all();
  return JSON.stringify(tables.map(({ name }) => ({ name, rows: sqlite.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() })));
}

export function payloadSnapshot(designId: string): unknown[] {
  return getSharedDb().select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all().sort((a, b) => a.id.localeCompare(b.id)).map((row) => {
    const raw = JSON.parse(row.payloadJson) as Record<string, unknown>;
    if (row.kind === "board_settings") delete raw.updatedAt;
    return { id: row.id, kind: row.kind, payload: raw };
  });
}

export function tamperHistory(designId: string, mutate: (entry: Record<string, unknown>) => void): void {
  const id = `${designId}:${REPAIR_SESSION}`, db = getSharedDb();
  const row = db.select().from(sessionHistories).where(eq(sessionHistories.id, id)).get()!;
  const entries = JSON.parse(row.undoStackJson) as Record<string, unknown>[];
  mutate(entries[entries.length - 1]!);
  db.update(sessionHistories).set({ undoStackJson: JSON.stringify(entries) }).where(eq(sessionHistories.id, id)).run();
}
