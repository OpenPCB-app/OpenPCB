/**
 * Friendly pin/part/net addressing for the AI schematic tools.
 *
 * Lets the model reference pins as "U1.VCC" / "U1.1" / { ref, pin } / raw pin
 * IDs / "primitive:<id>", reference parts as a UUID or a reference designator,
 * and connect a pin to a named net (auto-placing a power/ground/net-portal
 * primitive + short wire). Pure: depends only on the SDK projection type.
 */

import type {
  DesignerCommandEnvelope,
  DesignerSchematicProjection,
} from "../../../../sdks";

type PrimitiveCommand = Extract<
  DesignerCommandEnvelope["command"],
  { type: "place_gnd_port" | "place_pwr_port" | "place_net_portal" }
>;

export type PinTarget =
  | string
  | { pinId: string }
  | { ref: string; pin: string };
export type WireEndpoint = PinTarget | { net: string };

export type PinResolution =
  | { ok: true; pinId: string }
  | { ok: false; error: string; candidates?: string[] };

export type EndpointResolution =
  | { ok: true; kind: "pin"; pinId: string }
  | { ok: true; kind: "net"; net: string }
  | { ok: false; error: string; candidates?: string[] };

interface ProjectionIndex {
  pinIds: Set<string>;
  partsByRef: Map<string, DesignerSchematicProjection["parts"][number]>;
  partById: Map<string, DesignerSchematicProjection["parts"][number]>;
}

export function buildProjectionIndex(
  projection: DesignerSchematicProjection,
): ProjectionIndex {
  const pinIds = new Set<string>();
  const partsByRef = new Map<
    string,
    DesignerSchematicProjection["parts"][number]
  >();
  const partById = new Map<
    string,
    DesignerSchematicProjection["parts"][number]
  >();
  for (const part of projection.parts) {
    partById.set(part.id, part);
    partsByRef.set(part.reference.toLowerCase(), part);
    for (const pin of part.pins) pinIds.add(pin.id);
  }
  for (const primitive of projection.primitives)
    pinIds.add(`primitive:${primitive.id}`);
  return { pinIds, partsByRef, partById };
}

/** Strip KiCad overline markup so "~{RST}" / "~RST" ≡ "RST". Deliberately does
 *  NOT touch "/", "#", "\\" — those are meaningful in real pin names. */
function stripOverline(name: string): string {
  return name.replace(/[~{}]/g, "").trim();
}

function resolveRefPin(
  index: ProjectionIndex,
  ref: string,
  pin: string,
): PinResolution {
  const part = index.partsByRef.get(ref.trim().toLowerCase());
  if (!part) {
    return {
      ok: false,
      error: `No part with reference "${ref}".`,
      candidates: [...index.partsByRef.values()].map((p) => p.reference).sort(),
    };
  }
  const raw = pin.trim();
  if (raw.length === 0) {
    return { ok: false, error: `Empty pin selector on ${part.reference}.` };
  }
  const needle = raw.toLowerCase();
  const candidates = () =>
    part.pins.map((p) => `${p.number ?? "?"} (${p.name})`);

  // 1. Exact pin number (canonical). An exact number is unique by construction;
  //    if it somehow matches >1 pin, fail rather than guess.
  const byNumber = part.pins.filter(
    (p) => (p.number ?? "").toLowerCase() === needle,
  );
  if (byNumber.length === 1) return { ok: true, pinId: byNumber[0]!.id };
  if (byNumber.length > 1) {
    return {
      ok: false,
      error: `Ambiguous pin number "${pin}" on ${part.reference}.`,
      candidates: candidates(),
    };
  }

  // 2. Exact raw name (case-insensitive).
  const byName = part.pins.filter((p) => p.name.toLowerCase() === needle);
  if (byName.length === 1) return { ok: true, pinId: byName[0]!.id };
  if (byName.length > 1) {
    return {
      ok: false,
      error: `Ambiguous pin "${pin}" on ${part.reference} (multiple pins share that name).`,
      candidates: candidates(),
    };
  }

  // 3. KiCad overline alias only: "~{RST}" / "~RST" ≡ "RST". Strip ONLY overline
  //    markup (~ { }); never "/", "#", "\" — those distinguish real pin names
  //    (e.g. "CS#", "D/0") and must not be collapsed.
  const aliasNeedle = stripOverline(needle);
  if (aliasNeedle.length > 0) {
    const byAlias = part.pins.filter(
      (p) => stripOverline(p.name.toLowerCase()) === aliasNeedle,
    );
    if (byAlias.length === 1) return { ok: true, pinId: byAlias[0]!.id };
    if (byAlias.length > 1) {
      return {
        ok: false,
        error: `Ambiguous pin "${pin}" on ${part.reference} (matches multiple pins by overline alias).`,
        candidates: candidates(),
      };
    }
  }

  return {
    ok: false,
    error: `No pin "${pin}" on ${part.reference}.`,
    candidates: candidates(),
  };
}

/** Resolve a pin target to an exact pin ID. */
export function resolvePinTarget(
  projection: DesignerSchematicProjection,
  target: PinTarget,
  index: ProjectionIndex = buildProjectionIndex(projection),
): PinResolution {
  if (target && typeof target === "object") {
    const obj = target as Record<string, unknown>;
    if (typeof obj.pinId === "string") {
      return index.pinIds.has(obj.pinId)
        ? { ok: true, pinId: obj.pinId }
        : { ok: false, error: `Unknown pin ID "${obj.pinId}".` };
    }
    if (typeof obj.ref === "string" && typeof obj.pin === "string") {
      return resolveRefPin(index, obj.ref, obj.pin);
    }
    return {
      ok: false,
      error: "Pin target object must be { ref, pin } or { pinId }.",
    };
  }
  if (typeof target !== "string") {
    return {
      ok: false,
      error: "Pin target must be a string, { ref, pin }, or { pinId }.",
    };
  }
  const raw = target.trim();
  if (raw.length === 0) return { ok: false, error: "Empty pin target." };
  if (index.pinIds.has(raw)) return { ok: true, pinId: raw };
  // Try every dot split so dotted pin names ("U1.GPIO.0") resolve too.
  const matches = new Set<string>();
  let firstError: PinResolution | null = null;
  for (
    let i = raw.indexOf(".");
    i > 0 && i < raw.length - 1;
    i = raw.indexOf(".", i + 1)
  ) {
    const resolved = resolveRefPin(index, raw.slice(0, i), raw.slice(i + 1));
    if (resolved.ok) matches.add(resolved.pinId);
    else if (!firstError) firstError = resolved;
  }
  if (matches.size === 1) return { ok: true, pinId: [...matches][0]! };
  if (matches.size > 1) {
    return {
      ok: false,
      error: `Ambiguous pin target "${raw}" (matches multiple ref.pin splits).`,
    };
  }
  return (
    firstError ?? {
      ok: false,
      error: `Unrecognized pin target "${raw}". Use "REF.PIN" (e.g. "U1.VCC"), { ref, pin }, or a pin ID from designer_get_schematic_connectivity.`,
    }
  );
}

/** Resolve a wire endpoint, which may also be a named net. */
export function resolveWireEndpoint(
  projection: DesignerSchematicProjection,
  endpoint: WireEndpoint,
  index: ProjectionIndex = buildProjectionIndex(projection),
): EndpointResolution {
  if (endpoint && typeof endpoint === "object" && "net" in endpoint) {
    const net = (endpoint as { net: unknown }).net;
    if (typeof net !== "string" || net.trim().length === 0) {
      return { ok: false, error: "Net name must be a non-empty string." };
    }
    return { ok: true, kind: "net", net: net.trim() };
  }
  const pin = resolvePinTarget(projection, endpoint, index);
  return pin.ok
    ? { ok: true, kind: "pin", pinId: pin.pinId }
    : { ok: false, error: pin.error, candidates: pin.candidates };
}

/** Resolve a part target (UUID or reference designator) to a part ID. */
export function resolvePartTarget(
  projection: DesignerSchematicProjection,
  target: string | { partId: string } | { ref: string },
  index: ProjectionIndex = buildProjectionIndex(projection),
):
  | { ok: true; partId: string }
  | { ok: false; error: string; candidates?: string[] } {
  const raw =
    typeof target === "object"
      ? "partId" in target
        ? target.partId
        : target.ref
      : target;
  if (index.partById.has(raw)) return { ok: true, partId: raw };
  const byRef = index.partsByRef.get(raw.trim().toLowerCase());
  if (byRef) return { ok: true, partId: byRef.id };
  return {
    ok: false,
    error: `No part "${raw}".`,
    candidates: [...index.partsByRef.values()].map((p) => p.reference).sort(),
  };
}

// Choose the primitive used to tie a pin to a named net. Values mirror
// designer/backend/pcb/net-class-resolver.ts (kept local — assistant must not
// import designer-backend internals).
//   - canonical GND → gnd port (the only one that collapses to the "GND" net),
//   - power rail     → pwr port (recognizable supply glyph; railText preserves
//     its distinct identity via the global named-net union),
//   - everything else → net portal (distinct identity by portalText).
// Variants like AGND/DGND/VSS/VEE use a pwr port so they stay distinct from GND
// yet still read as supplies; VREF/EARTH/GND1/… fall through to net portals.
const GROUND_RE = /^(gnd|ground)$/i;
const POWER_NAME_RE = /^(vcc|vdd|vbat|vbus|vin|vout|agnd|dgnd|vss|vee)$/i;
const POWER_VOLTAGE_RE = /^[+-]?\d+(?:\.\d+)?v\d*$/i; // +5V, +3.3V, 3V3, 5V, 1V8, 0.9V

function classifyNetConnectPrimitive(name: string): "gnd" | "pwr" | "portal" {
  if (GROUND_RE.test(name)) return "gnd";
  if (POWER_NAME_RE.test(name) || POWER_VOLTAGE_RE.test(name)) return "pwr";
  return "portal";
}

export type NetConnectPlan = {
  /** Command to place the net-defining primitive (run first). */
  primitiveCommand: PrimitiveCommand;
  /** After the primitive is created, wire this pin to `primitive:<createdEntityId>`. */
  sourcePinId: string;
};

/**
 * Plan a "connect this pin to net <name>" operation: place a gnd / pwr / portal
 * primitive offset from the pin along one axis (so the connecting stub is a
 * straight Manhattan segment that ends exactly on the pin) and wire pin →
 * primitive. The primitive's connection pin coincides with its position, so the
 * derived net picks up the pin once the wire is applied.
 */
const GRID_NM = 2_000_000;
/** 4 grid steps (8 mm) — far enough that the flag clears the pin-name label. */
const FLAG_OFFSET_NM = 4 * GRID_NM;

type FlagKind = "gnd" | "pwr" | "portal";
type UnitDir = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

/** Each primitive's rot-0 outward direction (connection point → body), in store
 *  space, matching the legacy default placement that ships today. Used as the
 *  fallback when a pin sits exactly on its part origin (no clear direction). */
const BASE_OUTWARD: Record<FlagKind, UnitDir> = {
  gnd: { x: 0, y: 1 },
  pwr: { x: 0, y: -1 },
  portal: { x: -1, y: 0 },
};

/** Pin's outward direction from its part origin along the dominant axis, so the
 *  flag is placed on the side the pin points (away from the pin-name label).
 *  Returns null when the pin coincides with the origin (degenerate). */
function pinOutwardDir(
  part: DesignerSchematicProjection["parts"][number] | null,
  pinPos: { x: number; y: number },
): UnitDir | null {
  if (!part) return null;
  const dx = pinPos.x - part.positionNm.x;
  const dy = pinPos.y - part.positionNm.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: dx >= 0 ? 1 : -1, y: 0 };
  return { x: 0, y: dy >= 0 ? 1 : -1 };
}

export function planNetConnect(
  projection: DesignerSchematicProjection,
  sourcePinId: string,
  netName: string,
  index: ProjectionIndex = buildProjectionIndex(projection),
): { ok: true; plan: NetConnectPlan } | { ok: false; error: string } {
  let pinPos: { x: number; y: number } | null = null;
  let ownerPart: DesignerSchematicProjection["parts"][number] | null = null;
  for (const part of projection.parts) {
    const pin = part.pins.find((p) => p.id === sourcePinId);
    if (pin) {
      pinPos = pin.worldPositionNm;
      ownerPart = part;
      break;
    }
  }
  if (!pinPos) {
    const primitive = projection.primitives.find(
      (p) => `primitive:${p.id}` === sourcePinId,
    );
    if (primitive) pinPos = primitive.positionNm;
  }
  if (!pinPos)
    return {
      ok: false,
      error: `Unknown source pin "${sourcePinId}" for net connect.`,
    };

  const name = netName.trim();
  const kind = classifyNetConnectPrimitive(name);
  // Place the flag on the side the pin points (so the connecting stub is a
  // straight Manhattan segment that clears the pin-name label). The glyph stays
  // UPRIGHT (rotationDeg 0) — power-symbol convention (VCC up, GND down) and,
  // crucially, the label text stays readable; the wire bends, not the symbol.
  const base = BASE_OUTWARD[kind];
  const outward = pinOutwardDir(ownerPart, pinPos) ?? base;
  const rotationDeg: 0 | 90 | 180 | 270 = 0;
  const positionNm = {
    x: pinPos.x + outward.x * FLAG_OFFSET_NM,
    y: pinPos.y + outward.y * FLAG_OFFSET_NM,
  };

  let primitiveCommand: PrimitiveCommand;
  if (kind === "gnd") {
    primitiveCommand = { type: "place_gnd_port", positionNm, rotationDeg };
  } else if (kind === "pwr") {
    primitiveCommand = {
      type: "place_pwr_port",
      positionNm,
      rotationDeg,
      railText: name,
    };
  } else {
    primitiveCommand = {
      type: "place_net_portal",
      positionNm,
      rotationDeg,
      portalText: name,
    };
  }
  return { ok: true, plan: { sourcePinId, primitiveCommand } };
}
