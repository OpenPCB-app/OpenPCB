// Correlate schematic nets with PCB pads.
// Convention: symbol pin.number === footprint pad.number on the same placement.
// Mismatches push a "WARN: ..." string into the returned warnings array — never throw.

import type {
  DesignerSchematicProjection,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks/designer";
import { padWorldPositionMm, placementPads } from "./pad-geometry";

export interface PadRef {
  placementId: string;
  padNumber: string;
  worldMm: PcbPointMm;
}

export interface NetPadCorrelation {
  netPads: Map<string, PadRef[]>;
  warnings: string[];
}

export function correlateNetPads(
  schematic: DesignerSchematicProjection,
  pcbPlacements: PcbPlacedPart[],
): NetPadCorrelation {
  const warnings: string[] = [];

  const placementByPartId = new Map<string, PcbPlacedPart>();
  for (const placement of pcbPlacements) {
    placementByPartId.set(placement.partId, placement);
  }

  // pinId → { partId, pinNumber }
  const pinIndex = new Map<
    string,
    { partId: string; pinNumber: string | null }
  >();
  for (const part of schematic.parts) {
    for (const pin of part.pins) {
      pinIndex.set(pin.id, { partId: part.id, pinNumber: pin.number });
    }
  }

  // Track placements with empty pad sets so we emit one warning per placement
  // (not one per pin attempt) when a footprint preview has no pads at all.
  const reportedEmptyPlacement = new Set<string>();

  const netPads = new Map<string, PadRef[]>();

  for (const net of schematic.nets) {
    const pads: PadRef[] = [];

    for (const pinId of net.pinIds) {
      const pinInfo = pinIndex.get(pinId);
      if (!pinInfo) {
        warnings.push(`WARN: net ${net.id} references unknown pin ${pinId}`);
        continue;
      }
      if (pinInfo.pinNumber === null || pinInfo.pinNumber.trim() === "") {
        warnings.push(
          `WARN: net ${net.id} pin ${pinId} has no pin number — cannot match to pad`,
        );
        continue;
      }
      const placement = placementByPartId.get(pinInfo.partId);
      if (!placement) {
        warnings.push(
          `WARN: net ${net.id} pin ${pinId} part ${pinInfo.partId} has no PCB placement`,
        );
        continue;
      }
      const candidates = placementPads(placement);
      if (candidates.length === 0) {
        if (!reportedEmptyPlacement.has(placement.id)) {
          reportedEmptyPlacement.add(placement.id);
          warnings.push(
            `WARN: placement ${placement.id} (component ${placement.componentId}) has no pads in footprint.preview.pads — every net referencing this part will fail to correlate`,
          );
        }
        continue;
      }
      const want = pinInfo.pinNumber.trim();
      const pad = candidates.find(
        (candidate) => (candidate.number ?? "").trim() === want,
      );
      if (!pad) {
        const available = candidates
          .map((c) => `"${(c.number ?? "").trim()}"`)
          .join(", ");
        warnings.push(
          `WARN: net ${net.id} pin ${pinId} requested pad "${want}" on placement ${placement.id} — available pads: [${available}]`,
        );
        continue;
      }
      pads.push({
        placementId: placement.id,
        padNumber: pad.number,
        worldMm: padWorldPositionMm(placement, pad),
      });
    }

    if (pads.length > 0) {
      netPads.set(net.id, pads);
    }
  }

  return { netPads, warnings };
}
