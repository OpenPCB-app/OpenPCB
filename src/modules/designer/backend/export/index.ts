import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
  GerberArtifact,
  GerberArtifactKind,
  GerberExportOptions,
  GerberExportResult,
} from "../../../../sdks/designer/types";
import { buildBomCsv } from "./bom/writer";
import { buildExcellonDrill } from "./excellon/writer";
import { buildGerberLayer, type GerberLayerKind } from "./gerber/writer";
import { buildPnpCsv } from "./pnp/writer";
import { correlateNetPads } from "../pcb/net-pad-correlation";

/**
 * Manufacturing export orchestrator.
 *
 * Consumes a fully-loaded PCB projection (and optionally the matching
 * schematic projection for BOM/PnP value lookup) and produces every file
 * needed to fabricate the board at JLCPCB/PCBWay style services.
 *
 * Returned `GerberExportResult.artifacts` is the canonical bundle. Callers
 * choose how to materialize it (write each artifact to a directory, zip
 * the lot, stream to download, …).
 */

interface LayerEmission {
  kind: GerberArtifactKind;
  layer: GerberLayerKind;
  fileSuffix: string;
}

export function buildExportBundle(
  pcb: DesignerPcbProjection,
  schematic: DesignerSchematicProjection | null,
  options: GerberExportOptions = {},
): GerberExportResult {
  const warnings: string[] = [];
  const artifacts: GerberArtifact[] = [];

  const bundleName = makeBundleName(pcb.designId);
  const includeInner =
    options.includeInnerLayers !== false && pcb.board.layerCount === 4;
  const includeBom = options.includeBom !== false;
  const includePnp = options.includePickAndPlace !== false;

  const layerEmissions: LayerEmission[] = [
    { kind: "gerber.top_copper", layer: "copper.top", fileSuffix: "F_Cu.gbr" },
    {
      kind: "gerber.bottom_copper",
      layer: "copper.bottom",
      fileSuffix: "B_Cu.gbr",
    },
    ...(includeInner
      ? ([
          {
            kind: "gerber.inner1_copper" as const,
            layer: "copper.inner1" as const,
            fileSuffix: "In1_Cu.gbr",
          },
          {
            kind: "gerber.inner2_copper" as const,
            layer: "copper.inner2" as const,
            fileSuffix: "In2_Cu.gbr",
          },
        ] satisfies LayerEmission[])
      : []),
    { kind: "gerber.top_mask", layer: "mask.top", fileSuffix: "F_Mask.gbr" },
    {
      kind: "gerber.bottom_mask",
      layer: "mask.bottom",
      fileSuffix: "B_Mask.gbr",
    },
    { kind: "gerber.top_paste", layer: "paste.top", fileSuffix: "F_Paste.gbr" },
    {
      kind: "gerber.bottom_paste",
      layer: "paste.bottom",
      fileSuffix: "B_Paste.gbr",
    },
    {
      kind: "gerber.top_silk",
      layer: "silk.top",
      fileSuffix: "F_Silkscreen.gbr",
    },
    {
      kind: "gerber.bottom_silk",
      layer: "silk.bottom",
      fileSuffix: "B_Silkscreen.gbr",
    },
    {
      kind: "gerber.edge_cuts",
      layer: "edge_cuts",
      fileSuffix: "Edge_Cuts.gbr",
    },
  ];

  // Build the per-pad netId lookup so copper-layer Gerbers can emit the
  // `%TO.N,<netName>*%` attribute on each pad flash (used by fab AOI).
  // Skipped when no schematic projection is provided — exports remain
  // spec-valid without it.
  const padNetIds = schematic ? buildPadNetIdMap(schematic, pcb) : undefined;

  for (const emission of layerEmissions) {
    const text = buildGerberLayer(pcb, emission.layer, warnings, padNetIds);
    artifacts.push({
      kind: emission.kind,
      fileName: `${bundleName}-${emission.fileSuffix}`,
      text,
    });
  }

  artifacts.push({
    kind: "excellon.drills_pth",
    fileName: `${bundleName}-PTH.drl`,
    text: buildExcellonDrill(pcb, warnings, "PTH"),
  });
  // NPTH (mounting holes, etc.) — emitted unconditionally even when empty
  // so fabs that auto-detect file roles don't silently assume "no NPTH" =
  // "treat as PTH". File contains only header/trailer when there are no
  // unplated holes; fab parsers handle that fine.
  artifacts.push({
    kind: "excellon.drills_npth",
    fileName: `${bundleName}-NPTH.drl`,
    text: buildExcellonDrill(pcb, warnings, "NPTH"),
  });

  if (includeBom) {
    artifacts.push({
      kind: "csv.bom",
      fileName: `${bundleName}-BOM.csv`,
      text: buildBomCsv(pcb, schematic),
    });
  }
  if (includePnp) {
    artifacts.push({
      kind: "csv.pnp",
      fileName: `${bundleName}-PnP.csv`,
      text: buildPnpCsv(pcb, schematic),
    });
  }

  return {
    designId: pcb.designId,
    bundleName,
    artifacts,
    warnings,
  };
}

function makeBundleName(designId: string): string {
  // Keep IDs filesystem-safe: alphanum + dash. Long IDs are truncated
  // for usability without losing uniqueness for a single export.
  const safe = designId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
  return `openpcb-${safe}`;
}

/**
 * Invert the schematic→PCB net-pad correlation into a per-pad netId
 * lookup keyed by `${placementId}|${padNumber}`. Used by the copper
 * Gerber writer to emit `%TO.N,<name>*%` on each pad flash.
 *
 * Correlation warnings are intentionally dropped here — they belong on
 * the schematic side (ERC) and would be noise in an export bundle. The
 * map only contains successfully-correlated pads.
 */
function buildPadNetIdMap(
  schematic: DesignerSchematicProjection,
  pcb: DesignerPcbProjection,
): Map<string, string> {
  const { netPads } = correlateNetPads(schematic, pcb.placements);
  const map = new Map<string, string>();
  for (const [netId, refs] of netPads.entries()) {
    for (const ref of refs) {
      map.set(`${ref.placementId}|${ref.padNumber}`, netId);
    }
  }
  return map;
}
