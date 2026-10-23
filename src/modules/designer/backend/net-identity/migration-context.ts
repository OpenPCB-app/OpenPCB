import type { DesignerSchematicProjection } from "../../../../sdks/designer";
import { correlateNetPads } from "../pcb/net-pad-correlation";
import { loadSchematicSource } from "../projection-read";
import { deriveNetComponents } from "../projection-world";
import { bindNetIdentity } from "./bind";
import type { NetIdentityBackupSnapshot } from "./backup";
import { legacyContactEvidence, type LegacyContactEvidence } from "./evidence";
import { classifyLegacyReference, type LegacyReferenceContext } from "./migration-classify";
import type { NetIdentityMigrationSource } from "./migration-source";
import { validateMigrationSchematic } from "./migration-schematic";
import type { NetIdentityDb } from "./state-store";
import { designNetSalt } from "./types";
import { requireValid } from "./validation";

function add(map: Map<string, string[]>, name: string, value: string): void {
  const key = name.trim().toUpperCase(), values = map.get(key) ?? [];
  if (!values.includes(value)) values.push(value);
  map.set(key, values);
}

export function deriveMigrationIdentity(tx: NetIdentityDb, designId: string, watermark: number, snapshot: NetIdentityBackupSnapshot) {
  const schematic = loadSchematicSource(tx, designId);
  requireValid(schematic, "migration.schematic", "design does not exist");
  validateMigrationSchematic(snapshot, schematic);
  const components = deriveNetComponents(schematic.parts, schematic.wires, schematic.labels, schematic.primitives);
  const bound = bindNetIdentity({
    components: components.components, previousActive: [], salt: designNetSalt(designId),
    seqWatermark: watermark, mode: "commit", pinLabel: () => undefined,
  });
  const legacyRootIds = new Map(bound.nets.map((net) => [net.legacyRoot, net.id]));
  const namedIdsByUpperName = new Map<string, string[]>(), legacyAutoRootsByUpperName = new Map<string, string[]>();
  const netNames = new Map<string, string>();
  for (const component of components.components) {
    const id = legacyRootIds.get(component.key)!;
    netNames.set(id, component.legacyName);
    if (component.derivedName !== null) add(namedIdsByUpperName, component.derivedName, id);
    else add(legacyAutoRootsByUpperName, component.legacyName, component.key);
  }
  const projection: DesignerSchematicProjection = {
    ...schematic, nets: bound.nets, junctions: components.junctions, netDiagnostics: components.warnings,
  };
  return { bound, projection, legacyRootIds, namedIdsByUpperName, legacyAutoRootsByUpperName, netNames };
}

export type MigrationIdentity = ReturnType<typeof deriveMigrationIdentity>;

function emptyEvidence(): LegacyContactEvidence {
  return { islands: [], islandOf: new Map(), evidenceByRef: new Map(), pooledByLegacyRoot: new Map(), pourDisabledReasons: [] };
}

/** A physical pad with competing schematic labels cannot supply positive proof. */
function uniquePadNetIds(identity: MigrationIdentity, source: NetIdentityMigrationSource): Map<string, string> {
  const correlation = correlateNetPads(identity.projection, source.evidence.placements);
  const claims = new Map<string, Set<string>>();
  for (const [id, pads] of correlation.netPads) for (const pad of pads) {
    const address = `${pad.placementId}|${pad.padNumber}`, ids = claims.get(address) ?? new Set<string>();
    ids.add(id); claims.set(address, ids);
  }
  return new Map([...claims].flatMap(([address, ids]) => ids.size === 1 ? [[address, [...ids][0]!] as const] : []));
}

export function migrationReferenceContext(identity: MigrationIdentity, source: NetIdentityMigrationSource): LegacyReferenceContext {
  const context: LegacyReferenceContext = { ...identity, evidence: emptyEvidence() };
  const nameBoundZones = source.evidence.zones.flatMap((zone) => {
    if (!zone.enabled || zone.netId !== null) return [];
    const decision = classifyLegacyReference({
      site: { kind: "zone", zoneId: zone.id }, netId: null, netName: zone.netName ?? null, refClass: "copper",
    }, context);
    return decision.kind === "bound" && decision.method === "nameHint" ? [{ zone, netId: decision.netId }] : [];
  });
  context.evidence = legacyContactEvidence({
    ...source.evidence, board: source.board.settings,
    padNetIds: uniquePadNetIds(identity, source), legacyRootIds: identity.legacyRootIds,
    netNames: identity.netNames, nameBoundZones, allowPourEvidence: source.allowPourEvidence,
  });
  return context;
}

export function validateMigrationSource(source: NetIdentityMigrationSource): void {
  requireValid(source.parseLosses.length === 0, "migration.source", "persisted physical geometry has parse losses");
  requireValid(source.geometryAmbiguities.length === 0, "migration.source", "persisted physical identities are ambiguous");
  requireValid(source.rawRows.filter((row) => row.kind === "board_settings").length <= 1,
    "migration.board", "multiple persisted board settings rows");
  const unsafe = source.diagnostics.find((entry) => entry.path === "kind" || /^(trace|via|free_pad|zone)\.(netId|netName)$/.test(entry.path));
  requireValid(!unsafe, "migration.source", unsafe ? `${unsafe.rowId}:${unsafe.path}: ${unsafe.message}` : "invalid reference");
}
