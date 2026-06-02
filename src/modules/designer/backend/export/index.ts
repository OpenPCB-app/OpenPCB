import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
  GerberArtifact,
  GerberArtifactKind,
  GerberExportOptions,
  GerberExportResult,
  BomOverride,
} from "../../../../sdks/designer/types";
import { buildBomCsv } from "./bom/writer";
import { buildExcellonDrill } from "./excellon/writer";
import {
  buildGerberLayer,
  gerberFileFunctionAttr,
  gerberPolarityAttr,
  type GerberLayerKind,
} from "./gerber/writer";
import { buildGerberJobFile, type GerberJobFileAttr } from "./gerber/job-file";
import { buildPnpCsv } from "./pnp/writer";
import { runExportPreflight } from "./preflight";
import { exportBundleName } from "../../../../sdks/designer/pcb-helpers";
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
  bomOverrides: readonly BomOverride[] = [],
  createdAt: string = new Date().toISOString(),
): GerberExportResult {
  const warnings: string[] = [];
  const artifacts: GerberArtifact[] = [];

  const bundleName = exportBundleName(pcb.designId);
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

  // Collected alongside the artifacts to populate the .gbrjob FilesAttributes.
  const jobFiles: GerberJobFileAttr[] = [];

  for (const emission of layerEmissions) {
    const fileName = `${bundleName}-${emission.fileSuffix}`;
    artifacts.push({
      kind: emission.kind,
      fileName,
      text: buildGerberLayer(
        pcb,
        emission.layer,
        warnings,
        padNetIds,
        createdAt,
      ),
    });
    jobFiles.push({
      Path: fileName,
      FileFunction: gerberFileFunctionAttr(
        emission.layer,
        pcb.board.layerCount,
      ),
      FilePolarity: gerberPolarityAttr(emission.layer),
    });
  }

  const lastLayer = Math.max(2, pcb.board.layerCount);
  const pthName = `${bundleName}-PTH.drl`;
  artifacts.push({
    kind: "excellon.drills_pth",
    fileName: pthName,
    text: buildExcellonDrill(pcb, warnings, "PTH"),
  });
  jobFiles.push({
    Path: pthName,
    FileFunction: `Plated,1,${lastLayer},PTH,Drill`,
    FilePolarity: "Positive",
  });
  // NPTH (mounting holes, etc.) — emitted unconditionally even when empty
  // so fabs that auto-detect file roles don't silently assume "no NPTH" =
  // "treat as PTH". File contains only header/trailer when there are no
  // unplated holes; fab parsers handle that fine.
  const npthName = `${bundleName}-NPTH.drl`;
  artifacts.push({
    kind: "excellon.drills_npth",
    fileName: npthName,
    text: buildExcellonDrill(pcb, warnings, "NPTH"),
  });
  jobFiles.push({
    Path: npthName,
    FileFunction: `NonPlated,1,${lastLayer},NPTH,Drill`,
    FilePolarity: "Positive",
  });

  // Gerber Job File — lists the layer set + stackup so fabs can validate the
  // bundle is complete. Built from the collected per-file attributes above.
  artifacts.push({
    kind: "gerber.job",
    fileName: `${bundleName}.gbrjob`,
    text: buildGerberJobFile({ pcb, files: jobFiles, createdAt }),
  });

  if (includeBom) {
    artifacts.push({
      kind: "csv.bom",
      fileName: `${bundleName}-BOM.csv`,
      text: buildBomCsv(pcb, schematic, bomOverrides),
    });
  }
  if (includePnp) {
    artifacts.push({
      kind: "csv.pnp",
      fileName: `${bundleName}-PnP.csv`,
      text: buildPnpCsv(pcb, schematic, bomOverrides),
    });
  }

  // Export-time preflight (fab minimums, missing outline, unsourced assembly
  // parts) — appended after the writers' own warnings.
  warnings.push(...runExportPreflight(pcb, schematic, bomOverrides));

  return {
    designId: pcb.designId,
    bundleName,
    artifacts,
    warnings,
  };
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
