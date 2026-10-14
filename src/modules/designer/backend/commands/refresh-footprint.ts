/**
 * `refresh_part_footprint`: re-snapshot the library's CURRENT default footprint
 * onto schematic parts. Position/rotation/pins stay; the PCB placement follows
 * on the next PCB sync (which keeps its position and refreshes its footprint).
 * Undo is the dispatcher's whole-projection patch diff — nothing to do here.
 *
 * Refuses (nothing written) when a net-connected pin has no pad in the new
 * footprint; unconnected pins may lack pads.
 */

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerDispatchResult,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  LibraryComponentPlacementDetail,
} from "../../../../sdks";
import { schematicParts } from "../schema";
import {
  componentNotFound,
  entityNotFound,
  footprintPinMismatch,
} from "../results";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

function connectedPinIds(projection: DesignerSchematicProjection): Set<string> {
  const connected = new Set<string>();
  for (const net of projection.nets) {
    const isConnected =
      net.pinIds.length >= 2 ||
      net.wireIds.length > 0 ||
      net.labelIds.length > 0 ||
      net.primitiveIds.length > 0;
    if (!isConnected) continue;
    for (const pinId of net.pinIds) connected.add(pinId);
  }
  return connected;
}

function missingPinNumbers(
  part: DesignerPlacedPart,
  detail: LibraryComponentPlacementDetail,
  connected: Set<string>,
): string[] {
  const padNumbers = new Set(
    (detail.footprint.preview?.pads ?? []).map((pad) => pad.number.trim()),
  );
  const padFor = new Map<string, string>();
  for (const entry of detail.footprint.pinMap ?? []) {
    padFor.set(entry.pinNumber.trim(), entry.padNumber.trim());
  }
  const missing: string[] = [];
  for (const pin of part.pins) {
    const number = pin.number?.trim();
    if (!number || !connected.has(pin.id)) continue;
    if (!padNumbers.has(padFor.get(number) ?? number)) missing.push(number);
  }
  return missing;
}

/** Returns a failure result, or null when every part was refreshed. */
export function applyRefreshPartFootprint(params: {
  tx: DbClient;
  designId: string;
  timestamp: string;
  projection: DesignerSchematicProjection;
  partIds: string[];
  details: ReadonlyMap<string, LibraryComponentPlacementDetail>;
}): DesignerDispatchResult | null {
  const { tx, designId, timestamp, projection, partIds, details } = params;
  if (partIds.length === 0) return entityNotFound("", "part");
  const connected = connectedPinIds(projection);
  const updates: Array<{ partId: string; footprintJson: string }> = [];
  for (const partId of partIds) {
    const part = projection.parts.find((p) => p.id === partId);
    if (!part) return entityNotFound(partId, "part");
    const detail = details.get(part.componentId);
    if (!detail) return componentNotFound(part.componentId);
    const missing = missingPinNumbers(part, detail, connected);
    if (missing.length > 0) return footprintPinMismatch(partId, missing);
    updates.push({
      partId,
      footprintJson: JSON.stringify(detail.footprint),
    });
  }
  for (const update of updates) {
    tx.update(schematicParts)
      .set({ footprintSnapshotJson: update.footprintJson, updatedAt: timestamp })
      .where(
        and(
          eq(schematicParts.designId, designId),
          eq(schematicParts.id, update.partId),
        ),
      )
      .run();
  }
  return null;
}
