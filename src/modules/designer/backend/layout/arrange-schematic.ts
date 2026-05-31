/**
 * Apply deterministic auto-arrange to a whole schematic.
 *
 * Drives the pure layout engine from the live projection, repositions every
 * part whose computed slot moved, re-anchors its pins, then re-routes ALL wires
 * with the obstacle-aware router (sequentially, so each wire avoids the others'
 * freshly-routed geometry). Mutations happen on the passed transaction; the
 * store captures the before/after projection diff as a single undo step.
 *
 * Power-net classification is duplicated here (small regexes) rather than
 * imported from the assistant module — the designer backend must not depend on
 * assistant internals.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerPin,
  DesignerSchematicProjection,
} from "../../../../sdks/designer/types";
import {
  normalizeRotationDeg,
  recomputePinWorldPositions,
} from "../commands/place-part";
import { loadSchematicProjection } from "../projection-read";
import { autoRouteWirePoints } from "../routing/wire-obstacles";
import {
  schematicParts,
  schematicPins,
  schematicPrimitives,
  schematicWires,
} from "../schema";
import { partBodyExtentNm } from "./body-extent";
import {
  autoplaceSchematic,
  classifyPartForLayout,
  type AutoplaceInput,
  type AutoplaceNet,
  type AutoplacePart,
} from "./schematic-autoplace";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type Point = { x: number; y: number };

const GROUND_RE = /^(gnd|ground)$/i;
const POWER_NAME_RE = /^(vcc|vdd|vbat|vbus|vin|vout|agnd|dgnd|vss|vee)$/i;
const POWER_VOLTAGE_RE = /^[+-]?\d+(?:\.\d+)?v\d*$/i; // +5V, 3V3, 1V8…

function isPowerNetName(name: string): boolean {
  const n = name.trim();
  return GROUND_RE.test(n) || POWER_NAME_RE.test(n) || POWER_VOLTAGE_RE.test(n);
}

/** Owning part id of a real pin (`<partId>:<idx>`); null for primitive/junction pins. */
function pinOwnerPartId(pinId: string): string | null {
  if (pinId.startsWith("primitive:") || pinId.startsWith("junction:"))
    return null;
  const idx = pinId.indexOf(":");
  return idx > 0 ? pinId.slice(0, idx) : null;
}

export function buildAutoplaceInput(
  projection: DesignerSchematicProjection,
  originNm?: Point,
): AutoplaceInput {
  const parts: AutoplacePart[] = projection.parts.map((p) => ({
    partId: p.id,
    reference: p.reference,
    role: classifyPartForLayout(p.reference, p.pins.length),
    extent: partBodyExtentNm(p),
    pinCount: p.pins.length,
  }));
  const nets: AutoplaceNet[] = projection.nets.map((net) => {
    const seen = new Set<string>();
    const partIds: string[] = [];
    for (const pinId of net.pinIds) {
      const owner = pinOwnerPartId(pinId);
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        partIds.push(owner);
      }
    }
    return {
      netId: net.id,
      name: net.name,
      isPower: isPowerNetName(net.name),
      partIds,
    };
  });
  return { parts, nets, originNm };
}

/** Build a pin lookup (real pins + primitive connection points) from a projection. */
function buildPinIndex(
  projection: DesignerSchematicProjection,
): Map<string, DesignerPin> {
  const index = new Map<string, DesignerPin>();
  for (const part of projection.parts) {
    for (const pin of part.pins) index.set(pin.id, pin);
  }
  for (const prim of projection.primitives) {
    const id = `primitive:${prim.id}`;
    index.set(id, {
      id,
      originPinKey: id,
      number: null,
      name: prim.kind,
      electricalType: "passive",
      unit: 1,
      localPositionNm: { x: 0, y: 0 },
      worldPositionNm: prim.positionNm,
    });
  }
  return index;
}

/** Reposition parts then re-route every wire. Returns the number of parts moved. */
export function applyAutoArrange(params: {
  tx: DbClient;
  designId: string;
  projection: DesignerSchematicProjection;
  timestamp: string;
  originNm?: Point;
}): number {
  const { tx, designId, projection, timestamp, originNm } = params;
  const { positions } = autoplaceSchematic(
    buildAutoplaceInput(projection, originNm),
  );

  // Pin world positions before the move — used to slide attached flags by the
  // same delta as their pin (so per-pin GND/power flags follow their part).
  const oldPinWorld = new Map<string, Point>();
  for (const part of projection.parts)
    for (const pin of part.pins)
      oldPinWorld.set(pin.id, { ...pin.worldPositionNm });
  const newPinWorld = new Map<string, Point>();

  let moved = 0;
  for (const part of projection.parts) {
    const next = positions.get(part.id);
    if (!next) continue;
    if (next.x === part.positionNm.x && next.y === part.positionNm.y) continue;
    moved += 1;
    tx.update(schematicParts)
      .set({ positionXNm: next.x, positionYNm: next.y, updatedAt: timestamp })
      .where(eq(schematicParts.id, part.id))
      .run();
    const pinRows = tx
      .select()
      .from(schematicPins)
      .where(eq(schematicPins.partId, part.id))
      .all();
    const worlds = recomputePinWorldPositions(
      pinRows.map((pin) => ({
        localPositionNm: { x: pin.localXNm, y: pin.localYNm },
      })),
      next,
      normalizeRotationDeg(part.rotationDeg),
      part.mirrored,
    );
    pinRows.forEach((pin, i) => {
      const world = worlds[i];
      if (!world) return;
      newPinWorld.set(pin.id, { x: world.x, y: world.y });
      tx.update(schematicPins)
        .set({ worldXNm: world.x, worldYNm: world.y, updatedAt: timestamp })
        .where(eq(schematicPins.id, pin.id))
        .run();
    });
  }

  // Slide each flag primitive by its connected pin's delta so per-pin GND/power
  // flags stay glued to the part they annotate (arrange moves parts, not flags).
  const primToPin = new Map<string, string>();
  for (const wire of projection.wires) {
    const ends = [wire.sourcePinId, wire.targetPinId];
    const primEnd = ends.find((e) => e.startsWith("primitive:"));
    const pinEnd = ends.find(
      (e) => !e.startsWith("primitive:") && !e.startsWith("junction:"),
    );
    if (primEnd && pinEnd && !primToPin.has(primEnd))
      primToPin.set(primEnd, pinEnd);
  }
  for (const prim of projection.primitives) {
    const pinId = primToPin.get(`primitive:${prim.id}`);
    if (!pinId) continue;
    const oldP = oldPinWorld.get(pinId);
    const newP = newPinWorld.get(pinId);
    if (!oldP || !newP) continue; // pin did not move
    const dx = newP.x - oldP.x;
    const dy = newP.y - oldP.y;
    if (dx === 0 && dy === 0) continue;
    tx.update(schematicPrimitives)
      .set({
        positionXNm: prim.positionNm.x + dx,
        positionYNm: prim.positionNm.y + dy,
        updatedAt: timestamp,
      })
      .where(eq(schematicPrimitives.id, prim.id))
      .run();
  }

  // Re-route every wire against the post-move projection. Sequential so each
  // wire avoids the others' freshly-routed geometry (deterministic by wire id).
  const post = loadSchematicProjection(tx, designId);
  if (!post) return moved;
  const pinIndex = buildPinIndex(post);
  const wires = [...post.wires].sort((a, b) => a.id.localeCompare(b.id));
  const routed = new Map<string, Point[]>();
  for (const wire of wires) {
    const src = pinIndex.get(wire.sourcePinId);
    const tgt = pinIndex.get(wire.targetPinId);
    if (!src || !tgt) continue;
    const others = wires
      .filter((w) => w.id !== wire.id)
      .map((w) => ({ ...w, pointsNm: routed.get(w.id) ?? w.pointsNm }));
    const points = autoRouteWirePoints(post, src, tgt, others);
    routed.set(wire.id, points);
    tx.update(schematicWires)
      .set({ pointsJson: JSON.stringify(points), updatedAt: timestamp })
      .where(eq(schematicWires.id, wire.id))
      .run();
  }
  return moved;
}
