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

  const netPads = new Map<string, PadRef[]>();

  for (const net of schematic.nets) {
    const pads: PadRef[] = [];

    for (const pinId of net.pinIds) {
      const pinInfo = pinIndex.get(pinId);
      if (!pinInfo) {
        warnings.push(`WARN: net ${net.id} references unknown pin ${pinId}`);
        continue;
      }
      if (pinInfo.pinNumber === null) {
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
      const pad = placementPads(placement).find(
        (candidate) => candidate.number === pinInfo.pinNumber,
      );
      if (!pad) {
        warnings.push(
          `WARN: net ${net.id} has unmatched pin ${pinId} (pad number "${pinInfo.pinNumber}" not on placement ${placement.id})`,
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
