import type { PcbBoardSettings, PcbZone } from "../../../../sdks/designer";
import { rewriteNetReferences } from "../../../../shared/electrical-identity/references";
import { collectCopperZones, collectKeepouts, pourParamsForZone, zonePourNets } from "../../../../shared/pcb-areas";
import { boardCopperRecords, buildBoardPourFills, type BoardPourSpec } from "../../../../shared/pcb-connectivity/board-connectivity";
import { computeConnectivity, pourCopperItem, type CopperItem } from "../../../../shared/pcb-connectivity";
import { compareEvidenceText, copperReferenceKey, evidenceSet, type CopperIsland, type DirectEvidenceGraph, type LegacyContactEvidenceInput } from "./evidence-types";

function islandTarget(island: CopperIsland, input: LegacyContactEvidenceInput): string | null {
  if (island.legacyIds.size === 0) return null;
  const targets = [...island.legacyIds].map((id) => input.legacyRootIds.get(id));
  const target = targets[0];
  if (!target || targets.some((other) => other !== target)) return null;
  return island.directPadNets.size === 0 ||
    (island.directPadNets.size === 1 && island.directPadNets.has(target)) ? target : null;
}

function hypotheses(graph: DirectEvidenceGraph, input: LegacyContactEvidenceInput): Map<string, string> {
  const candidates = new Map<string, Array<string | null>>();
  for (const island of graph.islands) {
    const target = islandTarget(island, input);
    for (const key of island.refKeys) candidates.set(key, [...(candidates.get(key) ?? []), target]);
  }
  return new Map([...candidates].flatMap(([key, targets]) => {
    const target = targets[0];
    return target && targets.every((other) => other === target) ? [[key, target]] : [];
  }));
}

function admittedZones(input: LegacyContactEvidenceInput): Map<string, string> {
  const admitted = new Map<string, string>();
  for (const { zone, netId } of input.nameBoundZones) {
    if (!zone.enabled || zone.netId !== null || !zone.netName?.trim()) continue;
    const name = zone.netName.trim().toUpperCase();
    const matches = [...input.netNames].filter(([, value]) => value.trim().toUpperCase() === name);
    if (matches.length === 1 && matches[0]![0] === netId) admitted.set(zone.id, netId);
  }
  return admitted;
}

function mappedZones(input: LegacyContactEvidenceInput, admitted: ReadonlyMap<string, string>): PcbZone[] {
  return input.zones.map((zone) => ({ ...zone,
    netId: zone.netId === null ? admitted.get(zone.id) ?? null : input.legacyRootIds.get(zone.netId) ?? zone.netId,
  }));
}

function mappedBoard(input: LegacyContactEvidenceInput): PcbBoardSettings {
  return rewriteNetReferences({ board: input.board, traces: [], vias: [], freePads: [], zones: [] },
    (ref) => ref.refClass === "rule" && ref.netId !== null ? input.legacyRootIds.get(ref.netId) : undefined).board;
}

function hypotheticalNet(kind: "trace" | "via" | "freePad", id: string, original: string | null,
  proposed: ReadonlyMap<string, string>, input: LegacyContactEvidenceInput): string | null {
  const key = copperReferenceKey(kind, id);
  const target = proposed.get(key);
  if (target !== undefined) return target;
  // An unproven persisted string must not accidentally equal a target label.
  return original !== null && input.netNames.has(original) ? `unproven:${key}` : original;
}

function pourItems(input: LegacyContactEvidenceInput, graph: DirectEvidenceGraph, proposed: ReadonlyMap<string, string>): {
  items: CopperItem[]; reasons: string[];
} {
  const board = mappedBoard(input);
  const admitted = admittedZones(input);
  const zones = collectCopperZones({ zones: mappedZones(input, admitted), layerCount: board.layerCount, knownNetIds: new Set(input.netNames.keys()) });
  const keepouts = collectKeepouts({ keepouts: input.keepouts, layerCount: board.layerCount });
  const reasons = [...zones.warnings, ...keepouts.warnings].map((warning) => `${warning.code}:${warning.id ?? ""}`).sort(compareEvidenceText);
  if (reasons.length > 0) return { items: [], reasons };
  const nets = zonePourNets(board, Object.fromEntries(input.netNames));
  const pours: BoardPourSpec[] = zones.zones.filter((zone) => admitted.has(zone.id)).map((zone) => {
    const { pourNetId, ...params } = pourParamsForZone(zone, board.designRules, keepouts.keepouts, zones.zones, nets);
    return { ...params, netId: pourNetId! };
  });
  const copper = {
    layerCount: board.layerCount, placements: input.placements, padNetIds: input.padNetIds,
    traces: input.traces.map((row) => ({ ...row, netId: hypotheticalNet("trace", row.id, row.netId, proposed, input) })),
    vias: input.vias.map((row) => ({ ...row, netId: hypotheticalNet("via", row.id, row.netId, proposed, input) })),
    freePads: input.freePads.map((row) => ({ ...row, netId: hypotheticalNet("freePad", row.id, row.netId, proposed, input) })),
  };
  const records = boardCopperRecords(copper);
  records.pads = records.pads.map((pad) => pad.exactShape && !pad.declaredLayerInvalid ? pad : { ...pad, netId: null });
  const fills = buildBoardPourFills(copper, { outline: board.outline, designRules: board.designRules,
    cutouts: board.cutouts ?? [], freeHoles: input.freeHoles, pours }, records);
  const retained = new Set(graph.items.map((item) => item.key));
  return { items: fills.flatMap((pour, pourIndex) => pour.result.status === "failed" ? [] :
    pour.result.islands.map((island, index) => pourCopperItem({ ...pour, pourIndex, index, rings: island.rings,
      memberKeys: island.memberKeys.filter((key) => retained.has(key)) }))), reasons: [] };
}

export function addPourEvidence(input: LegacyContactEvidenceInput, graph: DirectEvidenceGraph): string[] {
  if (!input.allowPourEvidence) return ["caller_disabled"];
  const proposed = hypotheses(graph, input);
  const built = pourItems(input, graph, proposed);
  if (built.items.length === 0) return built.reasons;
  const hypothesisItems = graph.items.map((item) => {
    const island = graph.islandOf.get(item.key)!;
    const target = islandTarget(island, input);
    const agreed = target && island.refKeys.every((key) => proposed.get(key) === target) ? target : undefined;
    return { ...item, netId: graph.sourceByItem.get(item.key) ?? agreed ?? `unproven:${JSON.stringify(item.key)}` };
  });
  const connected = computeConnectivity([...hypothesisItems, ...built.items]);
  const components = new Map(connected.components.map((component) => [component.id, component]));
  const pourKeys = new Set(built.items.map((item) => item.key));
  for (const island of graph.islands) {
    const target = islandTarget(island, input);
    if (!target || island.refKeys.some((key) => proposed.get(key) !== target)) continue;
    const componentIds = evidenceSet(island.itemKeys.flatMap((key) => {
      const id = connected.componentOf.get(key);
      return id === undefined ? [] : [String(id)];
    }));
    for (const id of componentIds) {
      const keys = components.get(Number(id))!.itemKeys;
      if (!keys.some((key) => pourKeys.has(key))) continue;
      if (!keys.some((key) => graph.sourceByItem.get(key) === target)) continue;
      island.padNets.add(target);
      island.pourNetIds.add(target);
      island.pour = true;
    }
  }
  return built.reasons;
}
