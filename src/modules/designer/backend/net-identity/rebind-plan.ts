import type { DesignerDispatchResult } from "../../../../sdks";
import type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";
import type { pcbEntities } from "../schema";
import type { NetReferenceJudge } from "./command-reference-id";
import { planRebindBoard } from "./rebind-board-plan";
import type { RawNetRebindDelta, RawNetRebindRowDelta } from "./rebind-history-types";
import { fieldDelta, NetRebindPlanRefused, nonblank, own, rawPayload, referenceTarget, requireRebind, validateRebindBindings, type RebindIndex } from "./rebind-validation";

export type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";
type Row = typeof pcbEntities.$inferSelect;
type Result = { ok: true; delta: RawNetRebindDelta; receipt: NetRebindReceipt } |
  { ok: false; result: Extract<DesignerDispatchResult, { ok: false }> };
interface Input {
  designId: string;
  bindings: unknown;
  activeIds: ReadonlySet<string>;
  judge: NetReferenceJudge;
  rows: readonly Row[];
}
const KINDS = new Set(["trace", "via", "free_pad", "zone", "board_settings"]);

function emptyReceipt(): NetRebindReceipt {
  return { traces: 0, vias: 0, zones: 0, freePads: 0, assignments: 0, lengthGroups: 0, diffPairs: 0, drcRules: 0,
    removedRules: [], removedDiffPairs: [], removedLengthGroups: [], disabledZones: [] };
}

function copperDelta(row: Row, raw: Record<string, unknown>, index: RebindIndex, receipt: NetRebindReceipt): RawNetRebindRowDelta | null {
  const path = `${row.kind}[${JSON.stringify(row.id)}]`, target = referenceTarget(raw, index, path);
  if (target === undefined) return null;
  if (target === null && row.kind === "zone") {
    requireRebind(!own(raw, "enabled") || typeof raw.enabled === "boolean", `${path}.enabled: clearing a zone requires an absent or boolean enabled value.`);
  }
  const fields = [fieldDelta(raw, "netId", target)];
  if (target === null) {
    fields.push(fieldDelta(raw, "netName", null));
    if (row.kind === "zone") { fields.push(fieldDelta(raw, "enabled", false)); receipt.disabledZones.push(raw.id as string); }
  }
  const changed = fields.filter((field) => field !== null);
  if (!changed.length) return null;
  receipt[row.kind === "trace" ? "traces" : row.kind === "via" ? "vias" : row.kind === "zone" ? "zones" : "freePads"]++;
  return { rowId: row.id, kind: row.kind as RawNetRebindRowDelta["kind"], payloadId: raw.id as string, fields: changed };
}

function planRows(input: Input, index: RebindIndex, receipt: NetRebindReceipt): RawNetRebindRowDelta[] {
  const result: RawNetRebindRowDelta[] = [], rowIds = new Set<string>(), payloadIds = new Set<string>();
  let boards = 0;
  for (const row of input.rows) {
    requireRebind(row.designId === input.designId, `rows[${JSON.stringify(row.id)}]: row belongs to another design.`);
    requireRebind(nonblank(row.id) && !rowIds.has(row.id), `rows[${JSON.stringify(row.id)}]: duplicate or blank row ID.`);
    rowIds.add(row.id);
    if (!KINDS.has(row.kind)) continue;
    const raw = rawPayload(row.payloadJson, `${row.kind}[${JSON.stringify(row.id)}]`);
    if (row.kind === "board_settings") {
      requireRebind(++boards === 1, "board_settings: more than one raw board row is ambiguous.");
      const fields = planRebindBoard(raw, index, receipt);
      if (fields.length) result.push({ rowId: row.id, kind: "board_settings", payloadId: null, fields });
    } else {
      requireRebind(nonblank(raw.id) && !payloadIds.has(raw.id), `${row.kind}[${JSON.stringify(row.id)}].id: expected a globally unique nonblank copper payload ID.`);
      payloadIds.add(raw.id);
      const delta = copperDelta(row, raw, index, receipt);
      if (delta) result.push(delta);
    }
  }
  return result.sort((first, second) => first.rowId < second.rowId ? -1 : first.rowId > second.rowId ? 1 : 0);
}

/** Computes exact raw field changes from one immutable snapshot; never writes. */
export function planNetReferenceRebind(input: Input): Result {
  try {
    requireRebind(nonblank(input.designId), "designId: expected a nonblank string.");
    const index = validateRebindBindings(input.bindings, input.activeIds, input.judge), receipt = emptyReceipt();
    const rows = planRows(input, index, receipt);
    for (const key of ["removedRules", "removedDiffPairs", "removedLengthGroups", "disabledZones"] as const) receipt[key].sort();
    return { ok: true, delta: { version: 1, designId: input.designId, rows }, receipt };
  } catch (error) {
    if (!(error instanceof NetRebindPlanRefused)) throw error;
    return { ok: false, result: error.result };
  }
}
