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
import { AppError } from "../../../../core/contracts/errors";

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

  // Only a THROUGH via can be manufactured from this bundle: Excellon writes
  // ONE plated drill file (`TF.FileFunction,Plated,1,<last>,PTH`), so every
  // plated hit is a through drill and a blind / buried / micro via would ship
  // as one — a board the fab builds differently from the one that was designed
  // (manufacturability contract 10 §5.1; the precedent is the failed-fill
  // refusal of the copper-pour contract §9). REFUSE before writing any file.
  const unsupportedVias = pcb.vias.filter((via) => via.viaType !== "through");
  if (unsupportedVias.length > 0) {
    throw new AppError(
      "OpenPCB's drill export writes through drills only; blind/buried/micro vias cannot be manufactured from this export",
      422,
      "Unsupported via type",
      "https://openpcb.dev/problems/export-unsupported-via-type",
      { viaIds: unsupportedVias.map((via) => via.id) },
    );
  }

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

  // Collected alongside the artifacts to populate the .gbrjob FilesAttributes.
  const jobFiles: GerberJobFileAttr[] = [];

  for (const emission of layerEmissions) {
    const fileName = `${bundleName}-${emission.fileSuffix}`;
    artifacts.push({
      kind: emission.kind,
      fileName,
      text: buildGerberLayer(pcb, emission.layer, warnings, createdAt),
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
