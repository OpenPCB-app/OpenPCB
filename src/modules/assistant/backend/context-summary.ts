import type {
  DesignerSDK,
  DesignerDerivedNet,
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../sdks";
import type { DesignContextSummary } from "./verification/types";

/**
 * A net is "open" when it has only a single real endpoint — no second pin, no
 * wire, no label, no power/ground/portal primitive. (Track C's projection
 * connected-semantics fix makes single-endpoint nets distinguishable; until then
 * this is a best-effort heuristic on the derived-net endpoint counts.)
 */
function isOpenNet(net: DesignerDerivedNet): boolean {
  const endpoints =
    net.pinIds.length +
    net.wireIds.length +
    net.labelIds.length +
    net.primitiveIds.length;
  return net.pinIds.length <= 1 && net.wireIds.length === 0 && endpoints <= 1;
}

function summarizeSchematic(
  schematic: DesignerSchematicProjection,
  pcb: DesignerPcbProjection | null,
): DesignContextSummary["schematic"] {
  const placedPartIds = new Set<string>(
    (pcb?.placements ?? [])
      .map((placement) => placement.partId)
      .filter((id): id is string => Boolean(id)),
  );
  const unplaced = pcb
    ? schematic.parts
        .filter((part) => !placedPartIds.has(part.id))
        .map((part) => part.reference)
    : [];
  const openNets = schematic.nets.filter(isOpenNet).map((net) => net.name);
  return {
    componentCount: schematic.parts.length,
    netCount: schematic.nets.length,
    unplaced,
    openNets,
  };
}

function summarizePcb(
  pcb: DesignerPcbProjection | null,
): DesignContextSummary["pcb"] {
  if (!pcb) return { placed: 0, unrouted: 0 };
  const unroutedNets = new Set<string>(
    pcb.ratsnest.map((segment) => segment.netId),
  );
  return { placed: pcb.placements.length, unrouted: unroutedNets.size };
}

/**
 * Build a compact design snapshot for re-priming the model during DoD
 * correction. Reads the schematic + PCB projections via the designer SDK; never
 * mutates. Returns null when the design has no schematic projection (brand-new
 * or missing design).
 */
export async function buildDesignContextSummary(
  designer: DesignerSDK,
  designId: string,
): Promise<DesignContextSummary | null> {
  const [design, schematic, pcb] = await Promise.all([
    designer.getDesign(designId),
    designer.getSchematicProjection(designId),
    designer.getPcbProjection(designId).catch(() => null),
  ]);
  if (!design || !schematic) return null;
  return {
    designId,
    name: design.head.name,
    schematic: summarizeSchematic(schematic, pcb),
    pcb: summarizePcb(pcb),
  };
}
