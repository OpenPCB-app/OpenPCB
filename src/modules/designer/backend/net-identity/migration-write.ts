import { eq } from "drizzle-orm";
import { enumerateNetReferences, type NetReferenceSource } from "../../../../shared/electrical-identity/references";
import { pcbEntities } from "../schema";
import { asRecord } from "../value-guards";
import { serializeMigratedBoardReferences } from "./migration-board-rewrite";
import type { LegacyNetReferencePlan } from "./migration-plan";
import type { NetIdentityMigrationSource } from "./migration-source";
import { netReferenceDecisionKey, netReferenceProvenance } from "./reference-key";
import type { NetIdentityDb } from "./state-store";
import { requireValid, validateQuarantine } from "./validation";

export function migrationReferenceSource(source: NetIdentityMigrationSource): NetReferenceSource {
  return {
    board: source.board.status === "parsed" ? source.board.settings : {},
    traces: source.traces, vias: source.vias, freePads: source.freePads, zones: source.zones,
  };
}

/** Recovered settings remain readable after migration even when their raw row is skipped. */
export function validateSkippedBoardReferences(source: NetIdentityMigrationSource, activeIds: ReadonlySet<string>): void {
  if (source.board.status !== "unparseable") return;
  const refs = enumerateNetReferences({ board: source.board.settings, traces: [], vias: [], freePads: [], zones: [] });
  requireValid(!refs.some((ref) => ref.netId !== null && activeIds.has(ref.netId)),
    "migration.board", "skipped board reference collides with an active result id");
}

export function validateMigrationPlan(
  source: NetReferenceSource, plan: LegacyNetReferencePlan, activeIds: ReadonlySet<string>, designId: string, timestamp: string,
): void {
  for (const ref of enumerateNetReferences(source)) {
    const decision = plan.decisions.get(netReferenceDecisionKey(ref));
    if (decision?.kind !== "quarantine") continue;
    requireValid(ref.netId === null || !activeIds.has(ref.netId), "migration.quarantine", "unproven reference collides with an active result id");
    const provenance = netReferenceProvenance(ref);
    requireValid(provenance, "migration.quarantine", "quarantined reference has no valid provenance");
    validateQuarantine({ ...provenance, ...decision, designId, createdAt: timestamp });
  }
}

function writeCopper(
  tx: NetIdentityDb, source: NetIdentityMigrationSource, kind: string,
  before: readonly { id: string; netId: string | null; netName?: string | null }[],
  after: readonly { id: string; netId: string | null; netName?: string | null }[], timestamp: string,
): void {
  requireValid(before.length === after.length, `migration.${kind}`, "rewritten copper count changed");
  for (let index = 0; index < before.length; index++) {
    const previous = before[index]!, next = after[index]!;
    requireValid(previous.id === next.id, `migration.${kind}`, "rewritten copper identity changed");
    const idChanged = previous.netId !== next.netId;
    const nameChanged = kind !== "free_pad" && (previous.netName ?? null) !== (next.netName ?? null);
    if (!idChanged && !nameChanged) continue;
    const matches = source.rawRows.filter((row) => row.kind === kind).flatMap((row) => {
      const raw = asRecord(JSON.parse(row.payloadJson) as unknown);
      return raw?.id === previous.id ? [{ row, raw }] : [];
    });
    requireValid(matches.length === 1, `migration.${kind}.${previous.id}`, "changed reference must match exactly one raw payload identity");
    const { row, raw } = matches[0]!;
    requireValid((raw.netId ?? null) === previous.netId && (!nameChanged || (raw.netName ?? null) === (previous.netName ?? null)),
      `migration.${kind}.${previous.id}`, "raw reference does not match previous fields");
    const payload = { ...raw, ...(idChanged ? { netId: next.netId } : {}), ...(nameChanged ? { netName: next.netName } : {}) };
    tx.update(pcbEntities).set({ payloadJson: JSON.stringify(payload), updatedAt: timestamp }).where(eq(pcbEntities.id, row.id)).run();
  }
}

export function writeMigratedReferences(
  tx: NetIdentityDb, source: NetIdentityMigrationSource, before: NetReferenceSource, plan: LegacyNetReferencePlan, timestamp: string,
): void {
  const after = plan.rewritten;
  writeCopper(tx, source, "trace", before.traces, after.traces, timestamp);
  writeCopper(tx, source, "via", before.vias, after.vias, timestamp);
  writeCopper(tx, source, "free_pad", before.freePads, after.freePads, timestamp);
  writeCopper(tx, source, "zone", before.zones, after.zones, timestamp);
  if (source.board.status !== "parsed") return;
  const raw = asRecord(source.board.storedRaw);
  requireValid(raw && source.board.rowId, "migration.board", "parsed settings require an exact raw row");
  const payloadJson = serializeMigratedBoardReferences(raw, source.board.settings, {
    ...source.board.settings, ...after.board,
  }, timestamp);
  if (payloadJson !== null) tx.update(pcbEntities).set({ payloadJson, updatedAt: timestamp })
    .where(eq(pcbEntities.id, source.board.rowId)).run();
}
