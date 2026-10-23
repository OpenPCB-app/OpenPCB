import { and, asc, eq, inArray } from "drizzle-orm";
import type { KicadProjectImportWarning, PcbBoardSettings } from "../../../../../sdks/designer";
import type { NetReference } from "../../../../../shared/electrical-identity/references";
import type { BoundNet } from "../../net-identity/bind";
import { netReferenceProvenance } from "../../net-identity/reference-key";
import { writeNetIdentityQuarantine, type NetIdentityDb } from "../../net-identity/state-store";
import { isDurableNetIdOf, isLoneNetId } from "../../net-identity/types";
import { parseStoredJson, requireValid } from "../../net-identity/validation";
import { readPcbEntityForMigration } from "../../pcb/pcb-store";
import { pcbEntities } from "../../schema";
import { asRecord } from "../../value-guards";

function namedIds(nets: readonly BoundNet[]): Map<string, string[]> {
  const ids = new Map<string, Set<string>>();
  for (const net of nets) {
    // Both markers must agree that this is explicit. Generated display names
    // provide no correspondence to KiCad's independently generated net names.
    if (net.autoNamed || net.nameSource === "auto") continue;
    const matches = ids.get(net.name) ?? new Set<string>();
    matches.add(net.id);
    ids.set(net.name, matches);
  }
  return new Map([...ids].map(([name, matches]) => [name, [...matches].sort()]));
}

/** Import names are exact source names; neither aliases nor case repair are inferred. */
export function resolvePerNetClassAssignments(
  nets: readonly BoundNet[], settings: PcbBoardSettings, byNetName: Record<string, string>,
  warnings: KicadProjectImportWarning[],
): Record<string, string> {
  const ids = namedIds(nets);
  const classes = new Map(settings.netClasses.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const assignments = new Map<string, string>();
  for (const [netName, className] of Object.entries(byNetName)) {
    const matches = ids.get(netName) ?? [];
    if (matches.length === 0) {
      warnings.push({ code: "kicad_netclass_assignment_unknown_net", severity: "warning",
        message: `Net class '${className}' is assigned to net '${netName}', which this design has no net for; the assignment was skipped.` });
    } else if (matches.length > 1) {
      warnings.push({ code: "kicad_netclass_assignment_ambiguous_net", severity: "warning",
        message: `Net class '${className}' is assigned to net '${netName}', which matches more than one named net; the assignment was skipped.` });
    } else {
      const classId = classes.get(className.toLowerCase());
      if (classId) assignments.set(matches[0]!, classId);
      else warnings.push({ code: "kicad_netclass_unknown", severity: "warning",
        message: `Net '${netName}' is assigned to net class '${className}', which was not imported; the assignment was skipped.` });
    }
  }
  return Object.fromEntries(assignments);
}

type CopperKind = "trace" | "via" | "zone";
interface ImportedCopper {
  payloadId: string;
  row: typeof pcbEntities.$inferSelect;
  raw: Record<string, unknown>;
  reference: NetReference;
}

function importedCopper(row: typeof pcbEntities.$inferSelect): ImportedCopper {
  const path = `kicad.${row.kind}.${row.id}`;
  const raw = asRecord(parseStoredJson(row.payloadJson, path));
  requireValid(raw, path, "imported copper payload must be a JSON object");
  requireValid(typeof raw.id === "string" && raw.id.trim().length > 0, `${path}.id`, "must be non-blank");
  requireValid(raw.netId === null || typeof raw.netId === "string" && raw.netId.trim().length > 0,
    `${path}.netId`, "must be null or a non-blank string");
  requireValid(raw.netName === undefined || raw.netName === null || typeof raw.netName === "string",
    `${path}.netName`, "must be a string or null when present");
  const parsed = readPcbEntityForMigration(row.kind, row.payloadJson);
  requireValid(parsed?.entity, path, "imported copper was rejected by its canonical reader");
  const kind = row.kind as CopperKind;
  const site = kind === "trace" ? { kind, traceId: raw.id } : kind === "via" ? { kind, viaId: raw.id } : { kind, zoneId: raw.id };
  return { payloadId: raw.id, row, raw, reference: {
    netId: raw.netId, netName: raw.netName ?? null,
    refClass: kind === "zone" && parsed.kind === "zone" && parsed.entity.enabled === false ? "inert-copper" : "copper", site,
  } };
}

function readImportedCopper(tx: NetIdentityDb, designId: string): ImportedCopper[] {
  const rows = tx.select().from(pcbEntities).where(and(
    eq(pcbEntities.designId, designId), inArray(pcbEntities.kind, ["trace", "via", "zone"]),
  )).orderBy(asc(pcbEntities.kind), asc(pcbEntities.id)).all().map(importedCopper);
  const ids = new Set<string>();
  for (const { payloadId } of rows) {
    requireValid(!ids.has(payloadId), `kicad.copper.${payloadId}`, "duplicate imported payload identity");
    ids.add(payloadId);
  }
  return rows;
}

function quarantineHint(
  tx: NetIdentityDb, designId: string, imported: ImportedCopper, candidates: string[],
  warnings: KicadProjectImportWarning[], timestamp: string,
): void {
  const provenance = netReferenceProvenance(imported.reference);
  requireValid(provenance, "kicad.quarantine", "unresolved hint must have provenance");
  const ambiguous = candidates.length > 1;
  writeNetIdentityQuarantine(tx, { ...provenance, designId,
    reason: ambiguous ? "ambiguous_name" : "unknown_name", candidates, suggestedNetId: null, createdAt: timestamp });
  warnings.push({ code: ambiguous ? "kicad_net_ambiguous" : "kicad_net_unresolved", severity: "warning",
    message: `Imported ${imported.row.kind} '${provenance.refId}' net '${provenance.legacyValue}' ${
      ambiguous ? "matches more than one named net" : "has no exact named net match"
    }; its original hint was retained for review.` });
}

/** Caller owns the import transaction, including immutable quarantine failures. */
export function resolveImportedNetHints(
  tx: NetIdentityDb, designId: string, nets: readonly BoundNet[],
  warnings: KicadProjectImportWarning[], timestamp: string,
): void {
  const ids = namedIds(nets);
  for (const matches of ids.values()) for (const id of matches) {
    requireValid(isDurableNetIdOf(id, designId) || isLoneNetId(id), "kicad.nets", "named candidate must belong to this design");
  }
  // Validate every fresh row before changing one; malformed source must not be
  // silently omitted by an array reader or interpreted through identity defaults.
  for (const imported of readImportedCopper(tx, designId)) {
    const { row, raw, reference } = imported;
    if (reference.netId !== null || !reference.netName?.trim()) continue;
    const matches = ids.get(reference.netName) ?? [];
    if (matches.length !== 1) {
      quarantineHint(tx, designId, imported, matches, warnings, timestamp);
      continue;
    }
    tx.update(pcbEntities).set({ payloadJson: JSON.stringify({ ...raw, netId: matches[0]! }), updatedAt: timestamp })
      .where(and(eq(pcbEntities.designId, designId), eq(pcbEntities.id, row.id))).run();
  }
}
