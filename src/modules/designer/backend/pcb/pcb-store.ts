import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DrcRuleClass,
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbLengthMatchGroup,
  PcbNetClass,
  PcbViaProtection,
  PcbDrillSlot,
  PcbFreeHole,
  PcbFreePad,
  PcbFreePadShape,
  PcbFreePadType,
  PcbLayerId,
  PcbLayerPreset,
  PcbOverlayLayer,
  PcbOverlayShape,
  PcbOverlayShapeKind,
  PcbOverlayText,
  PcbOutlineSegment,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbTraceSegmentMode,
  PcbVia,
  PcbViewSide,
  PcbViewState,
  PcbDrcRule,
  PcbDiffPair,
  PcbZone,
  PcbKeepout,
  AutoLayoutConfig,
} from "../../../../sdks/designer";
import {
  copperLayersForCount,
  DRC_RULE_CLASSES,
  parsePcbLayerCount,
  isCopperLayerId as isStackupCopperLayer,
} from "../../../../sdks/designer";
import { findGroundNetId } from "../../../../sdks/designer/ground-net";
import { compileRuleSet } from "../../../../shared/drc/rule-compile";
import { boardZoneId } from "../../../../shared/pcb-areas/copper-zones";
import {
  parsePcbKeepoutRecord,
  upgradePcbZoneRecord,
  type ZoneRecordWarning,
} from "../../../../shared/pcb-areas/zone-parse";
import { pcbEntities } from "../schema";
import { asNumber, asRecord, asString } from "../value-guards";
import {
  serializeBoardSettings,
  serializeRawBoardSettings,
  type BoardSettingsRowParsers,
} from "./board-settings-serialize";
import {
  createDefaultPcbBoardSettings,
  createDefaultPcbViewState,
} from "./pcb-defaults";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

const BOARD_SETTINGS_KIND = "board_settings";
const PLACEMENT_KIND = "placement";
const TRACE_KIND = "trace";
const VIA_KIND = "via";
const FREE_HOLE_KIND = "free_hole";
const FREE_PAD_KIND = "free_pad";
const OVERLAY_TEXT_KIND = "overlay_text";
const OVERLAY_SHAPE_KIND = "overlay_shape";
const ZONE_KIND = "zone";
const KEEPOUT_KIND = "keepout";

const OVERLAY_LAYERS: ReadonlySet<PcbOverlayLayer> = new Set<PcbOverlayLayer>([
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
]);
const OVERLAY_SHAPE_KINDS: ReadonlySet<PcbOverlayShapeKind> =
  new Set<PcbOverlayShapeKind>([
    "rect",
    "circle",
    "line",
    "polyline",
    "polygon",
  ]);

const FREE_PAD_TYPES: ReadonlySet<PcbFreePadType> = new Set<PcbFreePadType>([
  "smd",
  "hole",
  "std",
  "conn",
]);
const FREE_PAD_SHAPES: ReadonlySet<PcbFreePadShape> = new Set<PcbFreePadShape>([
  "rect",
  "circle",
  "oval",
  "roundrect",
]);

function isCopperLayer(value: string | null): value is PcbCopperLayerId {
  return value !== null && isStackupCopperLayer(value);
}

function isSegmentMode(value: string | null): value is PcbTraceSegmentMode {
  return value === "manhattan-90" || value === "manhattan-45";
}

const ALL_PCB_LAYER_IDS: ReadonlySet<PcbLayerId> = new Set<PcbLayerId>([
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
  "Drill",
  "Metadata",
]);

function isPcbLayerId(
  value: string | null,
): value is PcbBoardSettings["activeLayer"] {
  return value !== null && ALL_PCB_LAYER_IDS.has(value as PcbLayerId);
}

function parseVisibleLayers(value: unknown): PcbBoardSettings["visibleLayers"] {
  const layers = (Array.isArray(value) ? value : [])
    ?.map((item) => asString(item))
    .filter(
      (item): item is PcbLayerId =>
        item !== null && ALL_PCB_LAYER_IDS.has(item as PcbLayerId),
    );
  return layers && layers.length > 0
    ? layers
    : ["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts", "Drill", "Metadata"];
}

function parseDisplayMode(value: unknown): PcbBoardSettings["displayMode"] {
  const s = asString(value);
  return s === "dim" || s === "solo" || s === "normal" ? s : "normal";
}

function parseLayerCount(value: unknown): PcbBoardSettings["layerCount"] {
  // parsePcbLayerCount coerces any even value in [2,32]; no longer collapses
  // 6+ to 2 (P2 full multilayer).
  return parsePcbLayerCount(value);
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
}

function isCopperLayerId(value: unknown): value is PcbCopperLayerId {
  return isStackupCopperLayer(value);
}

function parseViewSide(value: unknown): PcbViewSide {
  const s = asString(value);
  return s === "bottom" ? "bottom" : "top";
}

function parseLayerPreset(value: unknown): PcbLayerPreset {
  const s = asString(value);
  if (
    s === "top-side" ||
    s === "bottom-side" ||
    s === "all-copper" ||
    s === "assembly"
  ) {
    return s;
  }
  return "custom";
}

function parsePerLayerOpacity(
  value: unknown,
): Partial<Record<PcbLayerId, number>> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Partial<Record<PcbLayerId, number>> = {};
  for (const key of Object.keys(record)) {
    if (!ALL_PCB_LAYER_IDS.has(key as PcbLayerId)) continue;
    const n = asNumber(record[key]);
    if (n === null) continue;
    out[key as PcbLayerId] = Math.max(0, Math.min(1, n));
  }
  return out;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/**
 * The membership set comes from the SDK's `DRC_RULE_CLASSES` (derived from the
 * `DrcRuleClass` union, so it is total by construction). The local copy this
 * replaced listed five of the eight classes, and silently dropped a persisted
 * `dfm` / `electrical` / `signal-integrity` ignore on every read and patch.
 */
const KNOWN_DRC_RULE_CLASSES = new Set<DrcRuleClass>(DRC_RULE_CLASSES);

function parseDrcRuleClasses(value: unknown): DrcRuleClass[] {
  if (!Array.isArray(value)) return [];
  const out: DrcRuleClass[] = [];
  for (const item of value) {
    if (
      typeof item === "string" &&
      KNOWN_DRC_RULE_CLASSES.has(item as DrcRuleClass)
    ) {
      out.push(item as DrcRuleClass);
    }
  }
  return out;
}

const VIA_PROTECTIONS = new Set<PcbViaProtection>([
  "none",
  "tented",
  "plugged",
  "filled",
  "capped",
]);

function parseViaProtection(value: unknown): PcbViaProtection {
  return typeof value === "string" &&
    VIA_PROTECTIONS.has(value as PcbViaProtection)
    ? (value as PcbViaProtection)
    : "tented";
}

/**
 * Validate persisted/edited design rules, falling back per-field.
 *
 * The OPTIONAL keys (`holeToBoardEdgeMm`, `pourToCopperMm`, `copperToHoleMm`,
 * `minimums.clearanceMm`, `electrical`) are the only ones whose treatment
 * depends on `mode` (rule-semantics contract §12 items 5 and 6):
 *
 * - `"read"` — a key absent from the payload stays absent. The read path never
 *   invents a value an older board never stored.
 * - `"update"` — a key absent from the payload keeps the STORED value, and an
 *   explicit `null` clears it. The design-rules dialog sends the subset of the
 *   shape it edits; before S6 every key it omitted was silently reset.
 */
function parseDesignRules(
  value: unknown,
  fallback: PcbDesignRules,
  mode: "read" | "update",
): PcbDesignRules {
  const r = asRecord(value);
  if (!r) return fallback;
  const c = asRecord(r.clearance) ?? {};
  const m = asRecord(r.minimums) ?? {};
  const num = (v: unknown, d: number): number => asNumber(v) ?? d;
  /**
   * `undefined` = the key is absent (mode decides), `null` = an explicit
   * clear, a number = the new value. A non-numeric, non-null value is treated
   * as absent, exactly as `asNumber` has always done.
   */
  const optNum = (
    v: unknown,
    stored: number | undefined,
  ): number | undefined => {
    if (v === null) return undefined;
    const n = asNumber(v);
    if (n !== null) return n;
    return mode === "update" ? stored : undefined;
  };
  const holeToBoardEdgeMm = optNum(
    c.holeToBoardEdgeMm,
    fallback.clearance.holeToBoardEdgeMm,
  );
  const pourToCopperMm = optNum(
    c.pourToCopperMm,
    fallback.clearance.pourToCopperMm,
  );
  const copperToHoleMm = optNum(
    c.copperToHoleMm,
    fallback.clearance.copperToHoleMm,
  );
  const clearanceFloorMm = optNum(m.clearanceMm, fallback.minimums.clearanceMm);
  /**
   * The S12 DFM sub-objects (DFM contract 11 §6). Every key inside them is
   * optional with the `optNum` semantics above, and a sub-object with no keys
   * left is OMITTED — writing `{}` would turn "this board stores no silkscreen
   * rule" into "this board stores an empty one", which reads the same but is a
   * new row shape for every pre-S12 board that never had one.
   */
  const silkscreen = compactRules({
    silkToMaskClearanceMm: optNum(
      asRecord(r.silkscreen)?.silkToMaskClearanceMm,
      fallback.silkscreen?.silkToMaskClearanceMm,
    ),
    silkToBoardEdgeMm: optNum(
      asRecord(r.silkscreen)?.silkToBoardEdgeMm,
      fallback.silkscreen?.silkToBoardEdgeMm,
    ),
  });
  const solderMask = compactRules({
    minBridgeMm: optNum(
      asRecord(r.solderMask)?.minBridgeMm,
      fallback.solderMask?.minBridgeMm,
    ),
  });
  const dfm = compactRules({
    sliverWidthMm: optNum(
      asRecord(r.dfm)?.sliverWidthMm,
      fallback.dfm?.sliverWidthMm,
    ),
    sliverMinLengthMm: optNum(
      asRecord(r.dfm)?.sliverMinLengthMm,
      fallback.dfm?.sliverMinLengthMm,
    ),
    acuteAngleDeg: optNum(
      asRecord(r.dfm)?.acuteAngleDeg,
      fallback.dfm?.acuteAngleDeg,
    ),
    courtyardFallbackMm: optNum(
      asRecord(r.dfm)?.courtyardFallbackMm,
      fallback.dfm?.courtyardFallbackMm,
    ),
  });
  /**
   * The S12b board-material rule (exact-geometry contract 12 §5.2) — the same
   * shape as the three above. Absent means NO `OUTLINE_MIN_WEB` verdict, so a
   * board that never stored one is never retroactively judged by it.
   */
  const outline = compactRules({
    minWebMm: optNum(
      asRecord(r.outline)?.minWebMm,
      fallback.outline?.minWebMm,
    ),
  });
  /**
   * The electrical block (electrical contract 13 §2, §5), read key by key with
   * the `optNum` semantics above so the design-rules dialog — which edits only
   * the two weights — cannot silently clear a stored `outerConductors`. An
   * explicit `null` still clears the WHOLE block.
   *
   * A rise or a copper weight is persisted only when finite and STRICTLY
   * POSITIVE: a zero made `requiredTraceWidthMm` answer 0 mm, which every trace
   * passed (Astra run 1 #9). A value that escapes this gate is reported as
   * `DRC_RULE_INVALID` rather than assessed.
   */
  const e = r.electrical === null ? null : asRecord(r.electrical);
  /**
   * A rise or a weight, accepted only when finite and STRICTLY POSITIVE.
   *
   * A present-but-invalid value on an UPDATE keeps what the board already
   * stored: dropping it would fall back to the reader's default (10 °C, 1 oz),
   * which is LOOSER than the stored 5 °C — so a malformed write would silently
   * relax the width check instead of being rejected. An explicit `null` still
   * clears, and a CREATE has nothing to keep.
   */
  const positive = (
    v: unknown,
    stored: number | undefined,
  ): number | undefined => {
    const n = optNum(v, stored);
    if (n !== undefined && n > 0) return n;
    if (v === null || mode !== "update") return undefined;
    return stored !== undefined && stored > 0 ? stored : undefined;
  };
  const storedOuter = mode === "update" ? fallback.electrical?.outerConductors : undefined;
  const outer = asString(e?.outerConductors);
  const electrical =
    r.electrical === null
      ? null
      : compactElectrical({
          tempRiseC: positive(e?.tempRiseC, fallback.electrical?.tempRiseC),
          copperWeightOz: positive(
            e?.copperWeightOz,
            fallback.electrical?.copperWeightOz,
          ),
          innerCopperWeightOz: positive(
            e?.innerCopperWeightOz,
            fallback.electrical?.innerCopperWeightOz,
          ),
          outerConductors:
            e?.outerConductors === null
              ? undefined
              : outer === "coated" || outer === "uncoated"
                ? outer
                : storedOuter,
        });
  return {
    clearance: {
      traceToTraceMm: num(c.traceToTraceMm, fallback.clearance.traceToTraceMm),
      traceToPadMm: num(c.traceToPadMm, fallback.clearance.traceToPadMm),
      padToPadMm: num(c.padToPadMm, fallback.clearance.padToPadMm),
      traceToViaMm: num(c.traceToViaMm, fallback.clearance.traceToViaMm),
      viaToViaMm: num(c.viaToViaMm, fallback.clearance.viaToViaMm),
      copperToBoardEdgeMm: num(
        c.copperToBoardEdgeMm,
        fallback.clearance.copperToBoardEdgeMm,
      ),
      ...(holeToBoardEdgeMm !== undefined ? { holeToBoardEdgeMm } : {}),
      ...(pourToCopperMm !== undefined ? { pourToCopperMm } : {}),
      ...(copperToHoleMm !== undefined ? { copperToHoleMm } : {}),
    },
    minimums: {
      traceWidthMm: num(m.traceWidthMm, fallback.minimums.traceWidthMm),
      drillSizeMm: num(m.drillSizeMm, fallback.minimums.drillSizeMm),
      annularRingMm: num(m.annularRingMm, fallback.minimums.annularRingMm),
      viaDiameterMm: num(m.viaDiameterMm, fallback.minimums.viaDiameterMm),
      viaDrillMm: num(m.viaDrillMm, fallback.minimums.viaDrillMm),
      holeToHoleMm: num(m.holeToHoleMm, fallback.minimums.holeToHoleMm ?? 0.25),
      ...(clearanceFloorMm !== undefined ? { clearanceMm: clearanceFloorMm } : {}),
    },
    ...(electrical ? { electrical } : {}),
    ...(silkscreen ? { silkscreen } : {}),
    ...(solderMask ? { solderMask } : {}),
    ...(dfm ? { dfm } : {}),
    ...(outline ? { outline } : {}),
  };
}

/** {@link compactRules} for the electrical block, which carries one string key. */
function compactElectrical(
  value: NonNullable<PcbDesignRules["electrical"]>,
): PcbDesignRules["electrical"] | null {
  const out: Record<string, number | string> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length > 0
    ? (out as NonNullable<PcbDesignRules["electrical"]>)
    : null;
}

/** A rules sub-object with its `undefined` keys dropped, or `null` when empty. */
function compactRules<T extends Record<string, number | undefined>>(
  value: T,
): { [K in keyof T]: number } | null {
  const out: Record<string, number> = {};
  for (const [key, v] of Object.entries(value)) {
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length > 0
    ? (out as { [K in keyof T]: number })
    : null;
}

/** The payload carries this key at all; an explicit `null` CLEARS it. */
function declaredKey(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * One net class, validated. `storedById` is the board's CURRENT classes, and is
 * non-empty only on an update — a rejected ELECTRICAL write then keeps what the
 * board already had (electrical contract 13 §2, §5).
 *
 * A malformed declaration must be REPORTED, never silently dropped: dropping it
 * turns "this class is at ±300 V" into "this class is at the reference
 * potential", which removes the requirement AND the row that would have said
 * so. The resolver is where an invalid declaration becomes `DRC_RULE_INVALID`
 * and the constituent is withheld — fail-closed WITH a row (`intervalOfNetClass`
 * for a potential, `currentProblem` for a current) — so the store's job is to
 * hand it the declaration, not to hide it.
 */
function parseNetClass(
  value: unknown,
  storedById: ReadonlyMap<string, PcbNetClass>,
): PcbNetClass | null {
  const r = asRecord(value);
  if (!r) return null;
  const id = asString(r.id);
  const name = asString(r.name);
  if (!id || !name) return null;
  const diffPairGapMm = asNumber(r.diffPairGapMm);
  const keep = storedById.get(id);

  // A present-but-non-numeric constant potential is a REJECTED write, not a
  // licence to read the net as grounded.
  const voltageV = declaredKey(r.voltageV)
    ? (asNumber(r.voltageV) ?? keep?.voltageV)
    : undefined;

  // The class CURRENT, on the same terms (§5). A finite value persists AS
  // GIVEN, non-positive included: the resolver reports those with a
  // `DRC_RULE_INVALID` row and judges no trace of the class, while dropping
  // them here would read as "this class declares no current" — a silent PASS
  // for every trace on it.
  const currentA = declaredKey(r.currentA)
    ? (asNumber(r.currentA) ?? keep?.currentA)
    : undefined;

  // BOTH or NEITHER (§2). Two finite endpoints are persisted AS GIVEN, INVERTED
  // INCLUDED: the resolver reports `voltageMinV > voltageMaxV` and withholds the
  // term, whereas substituting nothing here made a live 1.25 mm requirement and
  // its report vanish together (Astra run 2). Half an interval — or an endpoint
  // that is not a number — is a rejected write: the stored pair stands.
  const minV = asNumber(r.voltageMinV);
  const maxV = asNumber(r.voltageMaxV);
  const someEndpoint =
    declaredKey(r.voltageMinV) || declaredKey(r.voltageMaxV);
  const interval =
    minV !== null && maxV !== null
      ? { voltageMinV: minV, voltageMaxV: maxV }
      : someEndpoint &&
          keep?.voltageMinV !== undefined &&
          keep.voltageMaxV !== undefined
        ? { voltageMinV: keep.voltageMinV, voltageMaxV: keep.voltageMaxV }
        : {};

  return {
    id,
    name,
    traceWidthMm: asNumber(r.traceWidthMm) ?? 0.25,
    clearanceMm: asNumber(r.clearanceMm) ?? 0.25,
    viaDiameterMm: asNumber(r.viaDiameterMm) ?? 0.8,
    viaDrillMm: asNumber(r.viaDrillMm) ?? 0.4,
    color: asString(r.color) ?? "#d4d4d8",
    defaultViaProtection: parseViaProtection(r.defaultViaProtection),
    ...(diffPairGapMm !== null && diffPairGapMm > 0 ? { diffPairGapMm } : {}),
    ...(voltageV !== undefined ? { voltageV } : {}),
    ...interval,
    ...(currentA !== undefined ? { currentA } : {}),
  };
}

function parseNetClasses(
  value: unknown,
  fallback: PcbNetClass[],
  mode: "read" | "update",
): PcbNetClass[] {
  if (!Array.isArray(value)) return fallback;
  // On a READ, `fallback` is the DEFAULT class table — not "what this board
  // stored" — so nothing may fall back to it; an id that happens to collide
  // with a default's would otherwise inherit a voltage the board never had.
  const storedById =
    mode === "update"
      ? new Map(fallback.map((c) => [c.id, c] as const))
      : new Map<string, PcbNetClass>();
  const out = value
    .map((entry) => parseNetClass(entry, storedById))
    .filter((c): c is PcbNetClass => c !== null);
  return out.length > 0 ? out : fallback;
}

/**
 * Validate a per-net → net-class override map (netId → netClassId). Keeps only
 * string net ids that map to a known class id; unknown classes are dropped so a
 * removed class can never leave a dangling assignment.
 */
function parsePerNetClassAssignments(
  value: unknown,
  validClassIds: ReadonlySet<string>,
): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Record<string, string> = {};
  for (const [netId, classId] of Object.entries(record)) {
    if (
      netId.length > 0 &&
      typeof classId === "string" &&
      validClassIds.has(classId)
    ) {
      out[netId] = classId;
    }
  }
  return out;
}

function parseLengthMatchGroup(value: unknown): PcbLengthMatchGroup | null {
  const r = asRecord(value);
  if (!r) return null;
  const id = asString(r.id);
  const name = asString(r.name);
  if (!id || !name) return null;
  const netIds = Array.isArray(r.netIds)
    ? r.netIds.filter((n): n is string => typeof n === "string" && n.length > 0)
    : [];
  const targetRecord = asRecord(r.target);
  let target: PcbLengthMatchGroup["target"] = { kind: "longest" };
  if (targetRecord?.kind === "absolute") {
    const mm = asNumber(targetRecord.mm);
    if (mm === null || mm <= 0) return null;
    target = { kind: "absolute", mm };
  } else if (targetRecord !== null && targetRecord.kind !== "longest") {
    return null;
  }
  const toleranceMm = asNumber(r.toleranceMm);
  return {
    id,
    name,
    netIds,
    target,
    toleranceMm: toleranceMm !== null && toleranceMm >= 0 ? toleranceMm : 0,
  };
}

/** Malformed entries are dropped; an invalid/absent field parses to []. */
function parseLengthMatchGroups(value: unknown): PcbLengthMatchGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(parseLengthMatchGroup)
    .filter((g): g is PcbLengthMatchGroup => g !== null);
}

function parseBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Whitelist-parse a persisted `AutoLayoutConfig` (stored inside the view-state
 * JSON). Malformed / partial rows return `undefined` so the frontend seeds from
 * its global default rather than a half-formed object.
 */
function parseAutoLayoutConfig(value: unknown): AutoLayoutConfig | undefined {
  const r = asRecord(value);
  if (!r) return undefined;
  const place = asRecord(r.place);
  const route = asRecord(r.route);
  if (!place || !route) return undefined;
  const preset =
    r.preset === "fast" ||
    r.preset === "balanced" ||
    r.preset === "quality" ||
    r.preset === "custom"
      ? r.preset
      : undefined;
  const effort =
    r.effort === "fast" || r.effort === "balanced" || r.effort === "quality"
      ? r.effort
      : undefined;
  if (!preset || !effort) return undefined;
  const util =
    typeof place.targetUtilization === "number" &&
    Number.isFinite(place.targetUtilization)
      ? Math.max(0, Math.min(1, place.targetUtilization))
      : 0.7;
  const pours = route.serializePours;
  const serializePours: boolean | "auto" =
    pours === true || pours === false ? pours : "auto";
  const maxVias =
    typeof route.maxViasPerNet === "number"
      ? route.maxViasPerNet
      : route.maxViasPerNet === null
        ? null
        : undefined;
  return {
    runPlace: parseBool(r.runPlace, true),
    runRoute: parseBool(r.runRoute, true),
    preset,
    effort,
    place: {
      allowRotate: parseBool(place.allowRotate, true),
      allowFlip: parseBool(place.allowFlip, true),
      moveConnectors: parseBool(place.moveConnectors, false),
      respectExistingTraces: parseBool(place.respectExistingTraces, true),
      targetUtilization: util,
    },
    route: {
      geometryMode:
        route.geometryMode === "manhattan-90"
          ? "manhattan-90"
          : "manhattan-45",
      allowVias: parseBool(route.allowVias, true),
      maxViasPerNet: maxVias,
      serializePours,
    },
  };
}

function parseViewState(value: unknown): PcbViewState {
  const record = asRecord(value);
  const defaults = createDefaultPcbViewState();
  if (!record) return defaults;
  return {
    displayMode: parseDisplayMode(record.displayMode),
    viewSide: parseViewSide(record.viewSide),
    perLayerOpacity: parsePerLayerOpacity(record.perLayerOpacity),
    layerPreset: parseLayerPreset(record.layerPreset),
    ratsnestVisible:
      record.ratsnestVisible === false
        ? false
        : record.ratsnestVisible === true
          ? true
          : defaults.ratsnestVisible,
    drcIgnoredRuleClasses: parseDrcRuleClasses(record.drcIgnoredRuleClasses),
    drcWaivedViolationIds: pruneWaivedViolationIds(
      parseStringArray(record.drcWaivedViolationIds),
    ),
    autoLayoutConfig: parseAutoLayoutConfig(record.autoLayoutConfig),
  };
}

function mergeViewState(
  current: PcbViewState,
  patch: Partial<PcbViewState>,
): PcbViewState {
  return {
    displayMode: patch.displayMode ?? current.displayMode,
    viewSide: patch.viewSide ?? current.viewSide,
    perLayerOpacity: patch.perLayerOpacity
      ? { ...current.perLayerOpacity, ...patch.perLayerOpacity }
      : current.perLayerOpacity,
    layerPreset: patch.layerPreset ?? current.layerPreset,
    ratsnestVisible:
      patch.ratsnestVisible !== undefined
        ? patch.ratsnestVisible
        : current.ratsnestVisible,
    drcIgnoredRuleClasses: patch.drcIgnoredRuleClasses
      ? parseDrcRuleClasses(patch.drcIgnoredRuleClasses)
      : (current.drcIgnoredRuleClasses ?? []),
    drcWaivedViolationIds: pruneWaivedViolationIds(
      patch.drcWaivedViolationIds
        ? parseStringArray(patch.drcWaivedViolationIds)
        : (current.drcWaivedViolationIds ?? []),
    ),
    autoLayoutConfig:
      patch.autoLayoutConfig !== undefined
        ? parseAutoLayoutConfig(patch.autoLayoutConfig)
        : current.autoLayoutConfig,
  };
}

/** Parse one point `{x,y}`; returns null when malformed. */
function parsePointOrNull(value: unknown): { x: number; y: number } | null {
  const r = asRecord(value);
  const x = asNumber(r?.x);
  const y = asNumber(r?.y);
  if (x === null || y === null) return null;
  return { x, y };
}

/**
 * Parse any persisted outline shape, returning null when malformed. Mirrors the
 * discriminated union in `PcbBoardOutline`.
 */
function parseOutlineShape(value: unknown): PcbBoardSettings["outline"] | null {
  const outline = asRecord(value);
  if (!outline) return null;
  const widthMm = asNumber(outline.widthMm);
  const heightMm = asNumber(outline.heightMm);
  const centerMm = parsePointOrNull(outline.centerMm);
  if (
    widthMm === null ||
    heightMm === null ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    !centerMm
  ) {
    return null;
  }
  switch (outline.kind) {
    case "rect":
      return { kind: "rect", widthMm, heightMm, centerMm };
    case "roundrect": {
      const cornerRadiusMm = asNumber(outline.cornerRadiusMm);
      if (cornerRadiusMm === null || cornerRadiusMm < 0) return null;
      return { kind: "roundrect", widthMm, heightMm, centerMm, cornerRadiusMm };
    }
    case "circle":
      return { kind: "circle", widthMm, heightMm, centerMm };
    case "polygon": {
      if (!Array.isArray(outline.pointsMm)) return null;
      const pointsMm: Array<{ x: number; y: number }> = [];
      for (const raw of outline.pointsMm as unknown[]) {
        const p = parsePointOrNull(raw);
        if (p) pointsMm.push(p);
      }
      if (pointsMm.length < 3) return null;
      return { kind: "polygon", widthMm, heightMm, centerMm, pointsMm };
    }
    case "contour": {
      const start = parsePointOrNull(outline.start);
      if (!start || !Array.isArray(outline.segments)) return null;
      const segments: PcbOutlineSegment[] = [];
      for (const raw of outline.segments as unknown[]) {
        const r = asRecord(raw);
        const to = parsePointOrNull(r?.to);
        if (!to) return null;
        if (r?.type === "arc") {
          const cm = parsePointOrNull(r.centerMm);
          if (!cm) return null;
          segments.push({ type: "arc", to, centerMm: cm, cw: r.cw === true });
        } else if (r?.type === "line") {
          segments.push({ type: "line", to });
        } else {
          return null;
        }
      }
      if (segments.length < 3) return null;
      return { kind: "contour", widthMm, heightMm, centerMm, start, segments };
    }
    default:
      return null;
  }
}

function parseCutouts(value: unknown): PcbBoardSettings["cutouts"] {
  if (!Array.isArray(value)) return undefined;
  const cutouts: NonNullable<PcbBoardSettings["cutouts"]> = [];
  for (const raw of value as unknown[]) {
    const r = asRecord(raw);
    const id = asString(r?.id);
    const shape = parseOutlineShape(r?.shape);
    if (
      id &&
      shape &&
      (shape.kind === "roundrect" ||
        shape.kind === "circle" ||
        shape.kind === "contour")
    ) {
      cutouts.push({ id, shape });
    }
  }
  return cutouts;
}

function parseBoardSettings(value: unknown): PcbBoardSettings | null {
  const record = asRecord(value);
  const updatedAt = asString(record?.updatedAt);
  const activeLayer = asString(record?.activeLayer);
  const outlineParsed = parseOutlineShape(record?.outline);

  if (!record || !outlineParsed || !updatedAt || !isPcbLayerId(activeLayer)) {
    return null;
  }

  const defaults = createDefaultPcbBoardSettings(updatedAt);
  // Trace presets: parse if present, fallback to defaults so older saved
  // boards (pre-tracePresets) keep working without migration.
  const tracePresetsRaw = Array.isArray(record.tracePresets)
    ? record.tracePresets
    : null;
  const tracePresets =
    tracePresetsRaw === null
      ? defaults.tracePresets
      : tracePresetsRaw
          .map((value) => asNumber(value))
          .filter((value): value is number => value !== null && value > 0);
  const cutouts = parseCutouts(record.cutouts);
  // Design rules / net classes / thickness were previously dropped on load
  // (always defaults). Read them so edits + KiCad-imported rules persist.
  const netClasses = parseNetClasses(
    record.netClasses,
    defaults.netClasses,
    "read",
  );
  const perNetClassAssignments = parsePerNetClassAssignments(
    record.perNetClassAssignments,
    new Set(netClasses.map((c) => c.id)),
  );
  const lengthMatchGroups = parseLengthMatchGroups(record.lengthMatchGroups);
  const drcSeverityOverrides = migrateHoleEdgeOverride(
    parseDrcSeverityOverrides(record.drcSeverityOverrides),
  );
  const drcRules = parseDrcRules(record.drcRules).rules;
  const diffPairs = parseDiffPairs(record.diffPairs);
  return {
    ...defaults,
    outline: outlineParsed,
    ...(cutouts !== undefined ? { cutouts } : {}),
    activeLayer,
    visibleLayers: parseVisibleLayers(record.visibleLayers),
    designRules: parseDesignRules(record.designRules, defaults.designRules, "read"),
    netClasses,
    ...(Object.keys(perNetClassAssignments).length > 0
      ? { perNetClassAssignments }
      : {}),
    ...(lengthMatchGroups.length > 0 ? { lengthMatchGroups } : {}),
    ...(drcSeverityOverrides &&
    Object.keys(drcSeverityOverrides).length > 0
      ? { drcSeverityOverrides }
      : {}),
    ...(drcRules.length > 0 ? { drcRules } : {}),
    ...(diffPairs.length > 0 ? { diffPairs } : {}),
    boardThicknessMm:
      asNumber(record.boardThicknessMm) ?? defaults.boardThicknessMm,
    tracePresets:
      tracePresets.length > 0 ? tracePresets : defaults.tracePresets,
    fabricator: parseFabricator(record.fabricator) ?? defaults.fabricator,
    layerCount: parseLayerCount(record.layerCount),
    displayMode: parseDisplayMode(record.displayMode),
    solderMaskExpansionMm:
      asNumber(record.solderMaskExpansionMm) ?? defaults.solderMaskExpansionMm,
    solderPasteExpansionMm:
      asNumber(record.solderPasteExpansionMm) ??
      defaults.solderPasteExpansionMm,
    viewState:
      record.viewState !== undefined
        ? parseViewState(record.viewState)
        : defaults.viewState,
    updatedAt,
  };
}

const VALID_SEVERITIES = new Set(["error", "warning", "info", "ignore"]);
function parseDiffPairs(value: unknown): PcbDiffPair[] {
  if (!Array.isArray(value)) return [];
  const out: PcbDiffPair[] = [];
  for (const raw of value) {
    if (!asRecord(raw)) continue;
    const id = asString(raw.id);
    const name = asString(raw.name);
    const pNetId = asString(raw.pNetId);
    const nNetId = asString(raw.nNetId);
    if (!id || !name || !pNetId || !nNetId) continue;
    // Non-negative thresholds only; a negative tolerance would flag an
    // on-target pair. Drop out-of-range values (fall back to defaults).
    const nonNeg = (v: unknown): number | null => {
      const n = asNumber(v);
      return n !== null && n >= 0 ? n : null;
    };
    const gapMm = nonNeg(raw.gapMm);
    const gapTolMm = nonNeg(raw.gapTolMm);
    const maxUncoupledMm = nonNeg(raw.maxUncoupledMm);
    const maxSkewMm = nonNeg(raw.maxSkewMm);
    // The coupling window (SI contract 14 §4.2) must be POSITIVE, not merely
    // non-negative: a stored 0 would mean "nothing couples", silently turning
    // every pair's whole length into uncoupled run. A bad value drops to the
    // documented `4 · gap + 0.1` default like every other optional number.
    const rawCoupling = asNumber(raw.couplingMaxGapMm);
    const couplingMaxGapMm =
      rawCoupling !== null && rawCoupling > 0 ? rawCoupling : null;
    out.push({
      id, name, pNetId, nNetId,
      ...(gapMm !== null ? { gapMm } : {}),
      ...(gapTolMm !== null ? { gapTolMm } : {}),
      ...(maxUncoupledMm !== null ? { maxUncoupledMm } : {}),
      ...(maxSkewMm !== null ? { maxSkewMm } : {}),
      ...(couplingMaxGapMm !== null ? { couplingMaxGapMm } : {}),
    });
  }
  return out;
}

const CLEARANCE_KIND = "clearance";
const SCALAR_KINDS = new Set([
  "trackWidth",
  "viaDiameter",
  "viaDrill",
  "annularRing",
  "holeToHole",
  "edgeClearance",
]);
function parseDrcRuleConstraint(
  value: unknown,
): PcbDrcRule["constraint"] | null {
  const r = asRecord(value);
  if (!r) return null;
  const kind = asString(r.kind);
  if (kind === CLEARANCE_KIND) {
    const mm = asNumber(r.mm);
    return mm !== null && mm >= 0
      ? ({ kind: "clearance", mm } as PcbDrcRule["constraint"])
      : null;
  }
  if (kind && SCALAR_KINDS.has(kind)) {
    const minMm = asNumber(r.minMm);
    return minMm !== null && minMm >= 0
      ? ({ kind, minMm } as PcbDrcRule["constraint"])
      : null;
  }
  return null;
}

/** Validate a rule's scope array; returns null if ANY scope is malformed. */
function parseDrcRuleScopes(value: unknown): PcbDrcRule["scopes"] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: PcbDrcRule["scopes"] = [];
  for (const raw of value) {
    const r = asRecord(raw);
    if (!r) return null;
    const kind = asString(r.kind);
    if (kind === "net" && Array.isArray(r.netIds)) {
      out.push({ kind: "net", netIds: r.netIds.filter((v) => typeof v === "string") });
    } else if (kind === "netClass" && Array.isArray(r.netClassIds)) {
      out.push({
        kind: "netClass",
        netClassIds: r.netClassIds.filter((v) => typeof v === "string"),
      });
    } else if (kind === "layer" && Array.isArray(r.layers)) {
      out.push({
        kind: "layer",
        layers: r.layers.filter((v) => isCopperLayer(typeof v === "string" ? v : null)) as PcbDrcRule["scopes"][number] extends { layers: infer L } ? L : never,
      });
    } else if (kind === "pairKind" && Array.isArray(r.pairKinds)) {
      out.push({
        kind: "pairKind",
        pairKinds: r.pairKinds.filter((v) => typeof v === "string") as never,
      });
    } else if (kind === "area") {
      const poly = Array.isArray(r.polygonMm) ? r.polygonMm : null;
      if (!poly || poly.length < 3) return null; // malformed area → invalid rule
      const pts = poly
        .map((pt) => {
          const pr = asRecord(pt);
          const x = asNumber(pr?.x);
          const y = asNumber(pr?.y);
          return x !== null && y !== null ? { x, y } : null;
        })
        .filter((pt): pt is { x: number; y: number } => pt !== null);
      if (pts.length < 3) return null;
      out.push({ kind: "area", polygonMm: pts });
    } else {
      return null; // unknown scope kind → invalid rule
    }
  }
  return out;
}

/**
 * One rule row that could not be parsed at all (rule-semantics §2.1
 * `malformed`). The READ path drops these — the one remaining silent drop,
 * because a persisted row that is not even shaped like a rule has no id to
 * report against and no board has ever been observed with one. The UPDATE
 * path is fail-closed: `pcb_set_design_rules` refuses the whole command with
 * `INVALID_DRC_RULE` rather than dropping a tightening rule the author wrote.
 */
export interface DrcRuleParseIssue {
  /** The row's `id` when it had a usable one, else its array index. */
  ruleId: string;
  index: number;
  reason: string;
  detail: string;
}

function parseDrcRules(value: unknown): {
  rules: PcbDrcRule[];
  invalid: DrcRuleParseIssue[];
} {
  if (!Array.isArray(value)) return { rules: [], invalid: [] };
  const out: PcbDrcRule[] = [];
  const invalid: DrcRuleParseIssue[] = [];
  for (const [index, raw] of value.entries()) {
    const record = asRecord(raw);
    const rowId = asString(record?.id) ?? String(index);
    const reject = (detail: string): void => {
      invalid.push({ ruleId: rowId, index, reason: "malformed", detail });
    };
    if (!record) {
      reject("rule must be an object");
      continue;
    }
    const id = asString(record.id);
    const name = asString(record.name);
    const constraint = record.constraint;
    if (!id || !name || !asRecord(constraint)) {
      reject("rule needs a non-empty string id, name and a constraint object");
      continue;
    }
    const constraintParsed = parseDrcRuleConstraint(constraint);
    if (!constraintParsed) {
      reject("constraint kind is unknown or its value is missing / negative");
      continue;
    }
    const priority = asNumber(record.priority) ?? 0;
    const scopes = parseDrcRuleScopes(record.scopes);
    if (scopes === null) {
      reject("a scope has the wrong shape");
      continue; // a malformed scope invalidates the rule
    }
    out.push({
      id,
      name,
      enabled: record.enabled !== false,
      priority,
      scopes,
      constraint: constraintParsed,
      ...(typeof record.severity === "string" &&
      ["error", "warning", "info"].includes(record.severity)
        ? { severity: record.severity as PcbDrcRule["severity"] }
        : {}),
      ...(asString(record.comment)
        ? { comment: asString(record.comment)! }
        : {}),
    });
  }
  return { rules: out, invalid };
}

/**
 * Fail-closed validation of a `drcRules` payload before it is persisted
 * (rule-semantics contract §2.1): the parse-level `malformed` rows, then every
 * STRUCTURAL problem the compiler reports (`duplicate_id`,
 * `area_polygon_invalid`, `area_limit`, `scope_kind_not_allowed`). Ineffective
 * rules — an unknown net, an unknown class, a clamped value — are NOT refused:
 * they still resolve, and batch DRC reports them as `DRC_RULE_INEFFECTIVE`.
 *
 * `settings` is the board as stored and `update` the rest of the same command;
 * the rules are compiled against the settings the command WILL produce (via
 * `resolveDesignRuleFields`, the function `updatePcbDesignRules` writes with),
 * never against the raw payload. The compiler needs the stackup to judge a
 * `layer` scope and the net classes to judge a `netClass` one. Net references
 * are not judged here — the store has no projection.
 */
export function validateDrcRulesForSave(
  value: unknown,
  settings: PcbBoardSettings,
  update: {
    designRules?: PcbDesignRules;
    netClasses?: PcbNetClass[];
    perNetClassAssignments?: Record<string, string>;
  } = {},
): { rules: PcbDrcRule[]; invalid: DrcRuleParseIssue[] } {
  const { rules, invalid } = parseDrcRules(value);
  if (invalid.length > 0) return { rules, invalid };
  const resolved = resolveDesignRuleFields(settings, update);
  const compiled = compileRuleSet(
    { ...settings, ...resolved, drcRules: rules },
    { validCopperLayers: copperLayersForCount(settings.layerCount) },
  );
  const structural = compiled.problems
    .filter((problem) => problem.kind === "invalid")
    .map((problem) => ({
      ruleId: problem.ruleId,
      index: problem.ruleIndex,
      reason: problem.reason,
      detail: problem.detail,
    }));
  return { rules, invalid: structural };
}
function parseDrcSeverityOverrides(
  value: unknown,
): PcbBoardSettings["drcSeverityOverrides"] {
  if (!asRecord(value)) return undefined;
  const out: Record<string, "error" | "warning" | "info" | "ignore"> = {};
  for (const [code, sev] of Object.entries(value as Record<string, unknown>)) {
    if (typeof sev === "string" && VALID_SEVERITIES.has(sev)) {
      out[code] = sev as "error" | "warning" | "info" | "ignore";
    }
  }
  return out as PcbBoardSettings["drcSeverityOverrides"];
}

/**
 * S6 split `HOLE_TO_BOARD_EDGE` (which carried both a breach and a near-miss)
 * into `HOLE_OFF_BOARD` (error) and `HOLE_TO_BOARD_EDGE` (warning). An
 * `"ignore"` a designer had put on the old code must keep suppressing the
 * breach, so the entry is copied forward on READ when the new code has none
 * (rule-semantics contract §12 item 3, Astra run 1 #13). The copy persists on
 * the next settings write; the old entry is kept, since the near-miss code
 * still exists.
 */
function migrateHoleEdgeOverride(
  overrides: PcbBoardSettings["drcSeverityOverrides"],
): PcbBoardSettings["drcSeverityOverrides"] {
  if (!overrides) return overrides;
  const map = overrides as Record<string, "error" | "warning" | "info" | "ignore">;
  const legacy = map.HOLE_TO_BOARD_EDGE;
  if (legacy === undefined || map.HOLE_OFF_BOARD !== undefined) return overrides;
  return { ...map, HOLE_OFF_BOARD: legacy } as PcbBoardSettings["drcSeverityOverrides"];
}

/**
 * Waiver ids are the v2 scheme `${CODE}-v2-${fnv1a64}` (rule-semantics §8). A
 * v1 id cannot be mapped forward — the v1 hash omitted the layer and the
 * location and the code that produced it is gone — so pruning is the only
 * honest migration. Applied when the view state is read AND when it is
 * patched, so a stale id can neither survive a reload nor be re-introduced.
 */
const WAIVER_ID_V2 = /^[A-Z_]+-v2-[0-9a-f]{16}$/;

function pruneWaivedViolationIds(ids: readonly string[]): string[] {
  return ids.filter((id) => WAIVER_ID_V2.test(id));
}

function parseFabricator(
  value: unknown,
): PcbBoardSettings["fabricator"] | null {
  const s = asString(value);
  if (
    s === "custom" ||
    s === "jlcpcb_2l" ||
    s === "jlcpcb_4l" ||
    s === "pcbway_std" ||
    s === "pcbway_advanced"
  ) {
    return s;
  }
  return null;
}

/**
 * Which stored rows THIS build can parse — the rescue rule in
 * `serializeBoardSettings` keeps only the ones it cannot, because a row the user
 * was never shown cannot be a row the user deleted. Passed in rather than
 * imported there, so the serializer never imports this module back.
 */
const NO_STORED_NET_CLASSES: ReadonlyMap<string, PcbNetClass> = new Map();
const BOARD_SETTINGS_ROW_PARSERS: BoardSettingsRowParsers = {
  netClasses: (row) => parseNetClass(row, NO_STORED_NET_CLASSES) !== null,
  diffPairs: (row) => parseDiffPairs([row]).length === 1,
  lengthMatchGroups: (row) => parseLengthMatchGroup(row) !== null,
  drcRules: (row) => parseDrcRules([row]).rules.length === 1,
};

/**
 * Every board-settings payload is built here — including the KiCad importer's,
 * which inserts its row outside this module.
 */
export function serializePcbBoardSettings(
  storedRaw: unknown,
  next: PcbBoardSettings,
): string {
  return serializeBoardSettings(storedRaw, next, BOARD_SETTINGS_ROW_PARSERS);
}

/**
 * The design's settings row as BOTH the typed projection and the raw payload it
 * was parsed from. Every writer needs both — the raw is what
 * `serializeBoardSettings` carries unknown keys over from — and reading them
 * together is what keeps a settings write at one SELECT.
 *
 * The repair branch (a row that does not parse) is a write like any other, so it
 * too carries the unknown keys of the payload it replaces.
 */
function loadBoardSettingsRow(
  db: DbClient,
  designId: string,
  timestamp: string,
): { settings: PcbBoardSettings; storedRaw: unknown } {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .get();

  const storedRaw = row ? parsePayload(row.payloadJson) : undefined;
  if (row) {
    const parsed = parseBoardSettings(storedRaw);
    if (parsed) return { settings: parsed, storedRaw };
  }

  const settings = createDefaultPcbBoardSettings(timestamp);
  if (row) {
    db.update(pcbEntities)
      .set({
        payloadJson: serializePcbBoardSettings(storedRaw, settings),
        updatedAt: timestamp,
      })
      .where(eq(pcbEntities.id, row.id))
      .run();
    return { settings, storedRaw };
  }

  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: BOARD_SETTINGS_KIND,
      payloadJson: serializePcbBoardSettings(undefined, settings),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return { settings, storedRaw: undefined };
}

export function ensurePcbBoardSettings(
  db: DbClient,
  designId: string,
  timestamp: string,
): PcbBoardSettings {
  return loadBoardSettingsRow(db, designId, timestamp).settings;
}

export function updatePcbBoardSize(params: {
  db: DbClient;
  designId: string;
  widthMm: number;
  heightMm: number;
  /** Optional new center. When omitted, the existing center is preserved. */
  centerMm?: { x: number; y: number };
  timestamp: string;
}): PcbBoardSettings {
  const { settings, storedRaw } = loadBoardSettingsRow(
    params.db,
    params.designId,
    params.timestamp,
  );
  const next: PcbBoardSettings = {
    ...settings,
    outline: {
      ...settings.outline,
      widthMm: params.widthMm,
      heightMm: params.heightMm,
      ...(params.centerMm ? { centerMm: params.centerMm } : {}),
    },
    updatedAt: params.timestamp,
  };

  params.db
    .update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(storedRaw, next),
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbBoardOutline(params: {
  db: DbClient;
  designId: string;
  outline: PcbBoardSettings["outline"];
  /** When omitted, existing cutouts are preserved. Pass `[]` to clear them. */
  cutouts?: PcbBoardSettings["cutouts"];
  timestamp: string;
}): PcbBoardSettings {
  const { settings, storedRaw } = loadBoardSettingsRow(
    params.db,
    params.designId,
    params.timestamp,
  );
  const next: PcbBoardSettings = {
    ...settings,
    outline: params.outline,
    cutouts: params.cutouts ?? settings.cutouts,
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(storedRaw, next),
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbActiveLayer(params: {
  db: DbClient;
  designId: string;
  layer: PcbLayerId;
  timestamp: string;
}): PcbBoardSettings {
  const { settings, storedRaw } = loadBoardSettingsRow(
    params.db,
    params.designId,
    params.timestamp,
  );
  const next: PcbBoardSettings = {
    ...settings,
    activeLayer: params.layer,
    visibleLayers: settings.visibleLayers.includes(params.layer)
      ? settings.visibleLayers
      : [...settings.visibleLayers, params.layer],
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(storedRaw, next),
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbVisibleLayers(params: {
  db: DbClient;
  designId: string;
  visibleLayers: ReadonlyArray<PcbLayerId>;
  timestamp: string;
}): PcbBoardSettings {
  const { settings, storedRaw } = loadBoardSettingsRow(
    params.db,
    params.designId,
    params.timestamp,
  );
  // Dedupe + preserve order; auto-pin the active layer ONLY when the new
  // set still contains its family (i.e. the user is reshuffling copper
  // visibility). Presets that intentionally omit all copper (e.g.
  // "Assembly view") shouldn't drag the routing layer back in — that
  // would leave the panel and chip detection out of sync with the user's
  // chosen preset.
  const seen = new Set<PcbLayerId>();
  const visible: PcbLayerId[] = [];
  for (const layer of params.visibleLayers) {
    if (!seen.has(layer)) {
      seen.add(layer);
      visible.push(layer);
    }
  }
  const hasAnyCopper =
    seen.has("F.Cu") ||
    seen.has("In1.Cu") ||
    seen.has("In2.Cu") ||
    seen.has("B.Cu");
  const activeIsCopper = isCopperLayer(settings.activeLayer);
  if (hasAnyCopper && activeIsCopper && !seen.has(settings.activeLayer)) {
    visible.push(settings.activeLayer);
  }
  const next: PcbBoardSettings = {
    ...settings,
    visibleLayers: visible,
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(storedRaw, next),
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbViewState(params: {
  db: DbClient;
  designId: string;
  patch: Partial<PcbViewState>;
  timestamp: string;
}): PcbBoardSettings {
  const { settings, storedRaw } = loadBoardSettingsRow(
    params.db,
    params.designId,
    params.timestamp,
  );
  const current = settings.viewState ?? createDefaultPcbViewState();
  const nextViewState = mergeViewState(current, params.patch);
  const next: PcbBoardSettings = {
    ...settings,
    viewState: nextViewState,
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(storedRaw, next),
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

/**
 * The design-rule fields a `pcb_set_design_rules` payload WILL be persisted
 * as. `updatePcbDesignRules` writes exactly this, and `validateDrcRulesForSave`
 * compiles against exactly this — one function, so the rules a command is
 * judged against can never be a different shape from the rules it stores.
 *
 * That matters because the HTTP parser forwards `designRules` / `netClasses`
 * shape-only: a payload carrying just `{ clearance: { traceToTraceMm } }` is a
 * legal command, and handing that straight to the rule compiler would read
 * `minimums.clearanceMm` off `undefined`.
 */
function resolveDesignRuleFields(
  settings: PcbBoardSettings,
  params: {
    designRules?: PcbDesignRules;
    netClasses?: PcbNetClass[];
    perNetClassAssignments?: Record<string, string>;
  },
): {
  designRules: PcbDesignRules;
  netClasses: PcbNetClass[];
  perNetClassAssignments: Record<string, string> | undefined;
} {
  const netClasses = params.netClasses
    ? parseNetClasses(params.netClasses, settings.netClasses, "update")
    : settings.netClasses;
  // Validate any incoming assignment map against the resulting class set (so a
  // removed class drops its assignments). A full map replaces the existing one.
  const validClassIds = new Set(netClasses.map((c) => c.id));
  return {
    designRules: params.designRules
      ? parseDesignRules(params.designRules, settings.designRules, "update")
      : settings.designRules,
    netClasses,
    perNetClassAssignments:
      params.perNetClassAssignments !== undefined
        ? parsePerNetClassAssignments(
            params.perNetClassAssignments,
            validClassIds,
          )
        : settings.perNetClassAssignments,
  };
}

export function updatePcbDesignRules(params: {
  db: DbClient;
  designId: string;
  designRules?: PcbDesignRules;
  netClasses?: PcbNetClass[];
  boardThicknessMm?: number;
  perNetClassAssignments?: Record<string, string>;
  lengthMatchGroups?: PcbLengthMatchGroup[];
  drcSeverityOverrides?: PcbBoardSettings["drcSeverityOverrides"];
  drcRules?: PcbDrcRule[];
  diffPairs?: PcbDiffPair[];
  timestamp: string;
}): PcbBoardSettings {
  const settings = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  const resolved = resolveDesignRuleFields(settings, params);
  const next: PcbBoardSettings = {
    ...settings,
    designRules: resolved.designRules,
    netClasses: resolved.netClasses,
    perNetClassAssignments: resolved.perNetClassAssignments,
    // A provided array fully replaces the stored rules (re-validated). An
    // empty result overrides the spread with undefined, which JSON
    // serialization drops — that's how rules are cleared.
    ...(params.lengthMatchGroups !== undefined
      ? (() => {
          const parsed = parseLengthMatchGroups(params.lengthMatchGroups);
          return {
            lengthMatchGroups: parsed.length > 0 ? parsed : undefined,
          };
        })()
      : {}),
    ...(params.drcSeverityOverrides !== undefined
      ? (() => {
          const parsed = parseDrcSeverityOverrides(params.drcSeverityOverrides);
          return {
            drcSeverityOverrides:
              parsed && Object.keys(parsed).length > 0 ? parsed : undefined,
          };
        })()
      : {}),
    ...(params.drcRules !== undefined
      ? (() => {
          // Malformed rows never reach here: `pcb_set_design_rules` refuses the
          // whole command with `INVALID_DRC_RULE` first (§2.1).
          const parsed = parseDrcRules(params.drcRules).rules;
          return { drcRules: parsed.length > 0 ? parsed : undefined };
        })()
      : {}),
    ...(params.diffPairs !== undefined
      ? (() => {
          const parsed = parseDiffPairs(params.diffPairs);
          return { diffPairs: parsed.length > 0 ? parsed : undefined };
        })()
      : {}),
    boardThicknessMm:
      params.boardThicknessMm !== undefined
        ? params.boardThicknessMm
        : settings.boardThicknessMm,
    updatedAt: params.timestamp,
  };
  replacePcbBoardSettings(params.db, params.designId, next, params.timestamp);
  return next;
}

/**
 * Reads the stored payload itself rather than taking it from the caller: this is
 * the public "write these settings" entry point, and a caller that arrived with
 * a settings object from somewhere else (a world snapshot, an undo replay) has
 * no raw payload to hand over.
 */
export function replacePcbBoardSettings(
  db: DbClient,
  designId: string,
  settings: PcbBoardSettings,
  timestamp: string,
): void {
  const stored = readRawBoardSettingsRow(db, designId);
  db.update(pcbEntities)
    .set({
      payloadJson: serializePcbBoardSettings(stored?.raw, settings),
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
}

function parsePlacement(value: unknown): PcbPlacedPart | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const partId = asString(record.partId);
  const componentId = asString(record.componentId);
  const reference = asString(record.reference);
  const position = asRecord(record.positionMm);
  const posX = asNumber(position?.x);
  const posY = asNumber(position?.y);
  const rotationDeg = asNumber(record.rotationDeg);
  const mirrored = record.mirrored === true;
  const layer = asString(record.layer);
  const footprint = record.footprint;
  if (
    !id ||
    !partId ||
    !componentId ||
    !reference ||
    posX === null ||
    posY === null ||
    rotationDeg === null ||
    !isPcbLayerId(layer) ||
    !footprint
  ) {
    return null;
  }
  return {
    id,
    partId,
    componentId,
    reference,
    positionMm: { x: posX, y: posY },
    rotationDeg,
    mirrored,
    layer,
    footprint: footprint as PcbPlacedPart["footprint"],
  };
}

export function loadPcbPlacements(
  db: DbClient,
  designId: string,
): PcbPlacedPart[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
      ),
    )
    .all();
  const placements: PcbPlacedPart[] = [];
  for (const row of rows) {
    const parsed = parsePlacement(parsePayload(row.payloadJson));
    if (parsed) placements.push(parsed);
  }
  return placements;
}

export function upsertPcbPlacement(
  db: DbClient,
  designId: string,
  placement: PcbPlacedPart,
  timestamp: string,
): void {
  const existing = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
        eq(pcbEntities.id, placement.id),
      ),
    )
    .get();
  if (existing) {
    db.update(pcbEntities)
      .set({ payloadJson: JSON.stringify(placement), updatedAt: timestamp })
      .where(eq(pcbEntities.id, placement.id))
      .run();
  } else {
    db.insert(pcbEntities)
      .values({
        id: placement.id,
        designId,
        kind: PLACEMENT_KIND,
        payloadJson: JSON.stringify(placement),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
}

export function deletePcbPlacement(db: DbClient, placementId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, placementId)).run();
}

export function replacePcbPlacements(
  db: DbClient,
  designId: string,
  placements: PcbPlacedPart[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
      ),
    )
    .run();
  for (const placement of placements) {
    db.insert(pcbEntities)
      .values({
        id: placement.id,
        designId,
        kind: PLACEMENT_KIND,
        payloadJson: JSON.stringify(placement),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
}

export function loadPcbPlacementById(
  db: DbClient,
  designId: string,
  placementId: string,
): PcbPlacedPart | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
        eq(pcbEntities.id, placementId),
      ),
    )
    .get();
  if (!row) return null;
  return parsePlacement(parsePayload(row.payloadJson));
}

export function movePcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  positionMm: PcbPointMm;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    positionMm: {
      x: Number(params.positionMm.x.toFixed(3)),
      y: Number(params.positionMm.y.toFixed(3)),
    },
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

export function rotatePcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  rotationDeg: 0 | 90 | 180 | 270;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    rotationDeg: params.rotationDeg,
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

export function flipPcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    layer: placement.layer === "B.Cu" ? "F.Cu" : "B.Cu",
    mirrored: !placement.mirrored,
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

function deterministicOffset(index: number): { x: number; y: number } {
  const base = 1.5;
  const step = 0.8;
  const slotsPerRing = 6;
  const ring = Math.floor(index / slotsPerRing);
  const slot = index % slotsPerRing;
  const angle = (slot / slotsPerRing) * 2 * Math.PI;
  const radius = base + ring * step;
  return {
    x: Number((radius * Math.cos(angle)).toFixed(3)),
    y: Number((radius * Math.sin(angle)).toFixed(3)),
  };
}

function hashStringToIndex(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & 0x7fffffff; // Keep within 31-bit positive range
  }
  return hash;
}

export function syncPcbPlacementsFromSchematic(params: {
  db: DbClient;
  designId: string;
  schematicParts: Array<{
    id: string;
    componentId: string;
    reference: string;
    footprint: PcbPlacedPart["footprint"];
  }>;
  boardCenter: PcbPointMm;
  /** Layer assigned to newly-created placements; B.Cu also flips mirror. Defaults to F.Cu. */
  defaultLayer?: PcbLayerId;
  timestamp: string;
}): PcbPlacedPart[] {
  const {
    db,
    designId,
    schematicParts,
    boardCenter,
    defaultLayer = "F.Cu",
    timestamp,
  } = params;
  const existing = loadPcbPlacements(db, designId);
  const existingByPartId = new Map(existing.map((p) => [p.partId, p]));
  const schematicPartIds = new Set(schematicParts.map((p) => p.id));

  // Delete placements for removed schematic parts
  for (const placement of existing) {
    if (!schematicPartIds.has(placement.partId)) {
      deletePcbPlacement(db, placement.id);
    }
  }

  // Self-heal placements with absurd positions. A previous sync bug stored
  // nanometer values into the mm field, putting parts ~86,000 km off-board.
  // Detect any position outside a generous board envelope and reset to the
  // deterministic offset so the user can see and move the part again.
  // Threshold: 10,000 mm — bigger than any realistic PCB, much smaller than
  // the bug's nm-as-mm magnitude.
  const POSITION_SANITY_MM = 10_000;
  const isAbsurd = (p: PcbPlacedPart): boolean =>
    !Number.isFinite(p.positionMm.x) ||
    !Number.isFinite(p.positionMm.y) ||
    Math.abs(p.positionMm.x) > POSITION_SANITY_MM ||
    Math.abs(p.positionMm.y) > POSITION_SANITY_MM;

  // Create or repair placements for each schematic part.
  const result: PcbPlacedPart[] = [];
  for (const part of schematicParts) {
    const existingPlacement = existingByPartId.get(part.id);
    if (existingPlacement && !isAbsurd(existingPlacement)) {
      const footprintChanged =
        JSON.stringify(existingPlacement.footprint) !==
        JSON.stringify(part.footprint);
      if (footprintChanged) {
        const refreshed: PcbPlacedPart = {
          ...existingPlacement,
          componentId: part.componentId,
          reference: part.reference,
          footprint: part.footprint,
        };
        upsertPcbPlacement(db, designId, refreshed, timestamp);
        result.push(refreshed);
      } else {
        result.push(existingPlacement);
      }
      continue;
    }
    const index = hashStringToIndex(part.id) % 24;
    const offset = deterministicOffset(index);
    const repairedPosition = {
      x: Number((boardCenter.x + offset.x).toFixed(3)),
      y: Number((boardCenter.y + offset.y).toFixed(3)),
    };
    if (existingPlacement) {
      // Repair in place: keep id + manual fields the user set, reset position.
      const repaired: PcbPlacedPart = {
        ...existingPlacement,
        positionMm: repairedPosition,
        // Refresh the footprint snapshot too — the stale data was likely
        // committed alongside an outdated snapshot.
        footprint: part.footprint,
      };
      upsertPcbPlacement(db, designId, repaired, timestamp);
      result.push(repaired);
    } else {
      const placement: PcbPlacedPart = {
        id: crypto.randomUUID(),
        partId: part.id,
        componentId: part.componentId,
        reference: part.reference,
        positionMm: repairedPosition,
        rotationDeg: 0,
        mirrored: defaultLayer === "B.Cu",
        layer: defaultLayer,
        footprint: part.footprint,
      };
      upsertPcbPlacement(db, designId, placement, timestamp);
      result.push(placement);
    }
  }

  return result;
}

// ───────────────────────── Traces ─────────────────────────

function parseTrace(value: unknown): PcbTrace | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const netId = record.netId === null ? null : asString(record.netId);
  const netClassId = asString(record.netClassId);
  const layer = asString(record.layer);
  const widthMm = asNumber(record.widthMm);
  const segmentMode = asString(record.segmentMode);
  const points = Array.isArray(record.pointsNm) ? record.pointsNm : null;
  if (
    !id ||
    !netClassId ||
    !isCopperLayer(layer) ||
    widthMm === null ||
    widthMm <= 0 ||
    !isSegmentMode(segmentMode) ||
    !points ||
    points.length < 2
  ) {
    return null;
  }
  const pointsNm: Array<{ x: number; y: number }> = [];
  for (const raw of points) {
    const r = asRecord(raw);
    const x = asNumber(r?.x);
    const y = asNumber(r?.y);
    if (x === null || y === null) return null;
    pointsNm.push({ x, y });
  }
  const netName =
    record.netName === undefined ? undefined : asString(record.netName);
  return {
    id,
    netId: netId ?? null,
    netClassId,
    layer,
    widthMm,
    pointsNm,
    segmentMode,
    ...(netName !== undefined ? { netName: netName ?? null } : {}),
  };
}

export function loadPcbTraces(db: DbClient, designId: string): PcbTrace[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, TRACE_KIND)),
    )
    .all();
  const traces: PcbTrace[] = [];
  for (const row of rows) {
    const parsed = parseTrace(parsePayload(row.payloadJson));
    if (parsed) traces.push(parsed);
  }
  return traces;
}

export function loadPcbTraceById(
  db: DbClient,
  designId: string,
  traceId: string,
): PcbTrace | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, TRACE_KIND),
        eq(pcbEntities.id, traceId),
      ),
    )
    .get();
  if (!row) return null;
  return parseTrace(parsePayload(row.payloadJson));
}

export function insertPcbTrace(
  db: DbClient,
  designId: string,
  trace: PcbTrace,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: trace.id,
      designId,
      kind: TRACE_KIND,
      payloadJson: JSON.stringify(trace),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbTrace(
  db: DbClient,
  trace: PcbTrace,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(trace), updatedAt: timestamp })
    .where(eq(pcbEntities.id, trace.id))
    .run();
}

export function deletePcbTrace(db: DbClient, traceId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, traceId)).run();
}

export function replacePcbTraces(
  db: DbClient,
  designId: string,
  traces: PcbTrace[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, TRACE_KIND)),
    )
    .run();
  for (const trace of traces) {
    insertPcbTrace(db, designId, trace, timestamp);
  }
}

// ───────────────────────── Vias ─────────────────────────

function parseVia(value: unknown): PcbVia | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const netId = record.netId === null ? null : asString(record.netId);
  const netClassId = asString(record.netClassId);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const diameterMm = asNumber(record.diameterMm);
  const drillMm = asNumber(record.drillMm);
  if (
    !id ||
    !netClassId ||
    cx === null ||
    cy === null ||
    diameterMm === null ||
    drillMm === null ||
    diameterMm <= drillMm ||
    drillMm <= 0
  ) {
    return null;
  }
  // Forward-compat default-fill: pre-Phase-B vias lack `viaType` /
  // `protection` / per-via layer pair. Defaults match v1 behaviour
  // (through F→B, tented).
  const fromLayerRaw = asString(record.fromLayer);
  const toLayerRaw = asString(record.toLayer);
  const fromLayer = isCopperLayer(fromLayerRaw) ? fromLayerRaw : "F.Cu";
  const toLayer = isCopperLayer(toLayerRaw) ? toLayerRaw : "B.Cu";
  const viaTypeRaw = asString(record.viaType);
  const viaType: PcbVia["viaType"] =
    viaTypeRaw === "blind" || viaTypeRaw === "buried" || viaTypeRaw === "micro"
      ? viaTypeRaw
      : "through";
  const protectionRaw = asString(record.protection);
  const protection: PcbVia["protection"] =
    protectionRaw === "none" ||
    protectionRaw === "plugged" ||
    protectionRaw === "filled" ||
    protectionRaw === "capped"
      ? protectionRaw
      : "tented";
  const provenanceRaw = asString(record.provenance);
  const provenance: PcbVia["provenance"] =
    provenanceRaw === "manual" ? "manual" : "route";
  const netName =
    record.netName === undefined ? undefined : asString(record.netName);
  return {
    id,
    netId: netId ?? null,
    netClassId,
    centerMm: { x: cx, y: cy },
    diameterMm,
    drillMm,
    fromLayer,
    toLayer,
    viaType,
    protection,
    provenance,
    ...(netName !== undefined ? { netName: netName ?? null } : {}),
  };
}

export function loadPcbVias(db: DbClient, designId: string): PcbVia[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, VIA_KIND)),
    )
    .all();
  const vias: PcbVia[] = [];
  for (const row of rows) {
    const parsed = parseVia(parsePayload(row.payloadJson));
    if (parsed) vias.push(parsed);
  }
  return vias;
}

export function loadPcbViaById(
  db: DbClient,
  designId: string,
  viaId: string,
): PcbVia | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, VIA_KIND),
        eq(pcbEntities.id, viaId),
      ),
    )
    .get();
  if (!row) return null;
  return parseVia(parsePayload(row.payloadJson));
}

export function insertPcbVia(
  db: DbClient,
  designId: string,
  via: PcbVia,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: via.id,
      designId,
      kind: VIA_KIND,
      payloadJson: JSON.stringify(via),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function deletePcbVia(db: DbClient, viaId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, viaId)).run();
}

export function replacePcbVias(
  db: DbClient,
  designId: string,
  vias: PcbVia[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, VIA_KIND)),
    )
    .run();
  for (const via of vias) {
    insertPcbVia(db, designId, via, timestamp);
  }
}

// ─────────────────────── Free holes (F5) ───────────────────────

/** Parse an optional oblong-drill descriptor; null when absent or degenerate. */
function parseDrillSlot(value: unknown): PcbDrillSlot | null {
  const record = asRecord(value);
  if (!record) return null;
  const lengthMm = asNumber(record.lengthMm);
  const widthMm = asNumber(record.widthMm);
  const angleDeg = asNumber(record.angleDeg);
  if (
    lengthMm === null ||
    widthMm === null ||
    angleDeg === null ||
    widthMm <= 0 ||
    lengthMm < widthMm
  ) {
    return null;
  }
  return { lengthMm, widthMm, angleDeg };
}

function parseFreeHole(value: unknown): PcbFreeHole | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const drillMm = asNumber(record.drillMm);
  if (!id || cx === null || cy === null || drillMm === null || drillMm <= 0) {
    return null;
  }
  const lockedAtRaw = asString(record.lockedAt);
  const drillSlot = parseDrillSlot(record.drillSlot);
  return {
    id,
    centerMm: { x: cx, y: cy },
    // `drillMm` and `drillSlot.widthMm` are ONE value — the tool (contract 10
    // §1.2); the slot width wins at hydration, as for free pads.
    drillMm: drillSlot ? drillSlot.widthMm : drillMm,
    drillSlot,
    lockedAt: lockedAtRaw ?? null,
  };
}

export function loadPcbFreeHoles(
  db: DbClient,
  designId: string,
): PcbFreeHole[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
      ),
    )
    .all();
  const out: PcbFreeHole[] = [];
  for (const row of rows) {
    const parsed = parseFreeHole(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbFreeHoleById(
  db: DbClient,
  designId: string,
  freeHoleId: string,
): PcbFreeHole | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
        eq(pcbEntities.id, freeHoleId),
      ),
    )
    .get();
  if (!row) return null;
  return parseFreeHole(parsePayload(row.payloadJson));
}

export function insertPcbFreeHole(
  db: DbClient,
  designId: string,
  hole: PcbFreeHole,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: hole.id,
      designId,
      kind: FREE_HOLE_KIND,
      payloadJson: JSON.stringify(hole),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbFreeHole(
  db: DbClient,
  hole: PcbFreeHole,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({
      payloadJson: JSON.stringify(hole),
      updatedAt: timestamp,
    })
    .where(eq(pcbEntities.id, hole.id))
    .run();
}

export function deletePcbFreeHole(db: DbClient, freeHoleId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, freeHoleId)).run();
}

// ─────────────────────── Free pads (F5) ───────────────────────

function parseFreePad(value: unknown): PcbFreePad | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const rotationDeg = asNumber(record.rotationDeg);
  const padTypeRaw = asString(record.padType);
  const shapeRaw = asString(record.shape);
  const widthMm = asNumber(record.widthMm);
  const heightMm = asNumber(record.heightMm);
  if (
    !id ||
    cx === null ||
    cy === null ||
    rotationDeg === null ||
    !padTypeRaw ||
    !shapeRaw ||
    widthMm === null ||
    heightMm === null ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    !FREE_PAD_TYPES.has(padTypeRaw as PcbFreePadType) ||
    !FREE_PAD_SHAPES.has(shapeRaw as PcbFreePadShape)
  ) {
    return null;
  }
  const padType = padTypeRaw as PcbFreePadType;
  const shape = shapeRaw as PcbFreePadShape;
  const roundrectRatio = asNumber(record.roundrectRatio);
  const drillMm = asNumber(record.drillMm);
  const layerRaw = asString(record.layer);
  const layer = isCopperLayer(layerRaw) ? layerRaw : "F.Cu";
  const netIdRaw = record.netId;
  const netId =
    netIdRaw === null || netIdRaw === undefined ? null : asString(netIdRaw);
  const solderMaskExpansionMm = asNumber(record.solderMaskExpansionMm);
  const solderPasteExpansionMm = asNumber(record.solderPasteExpansionMm);
  const lockedAt = asString(record.lockedAt);
  const drillSlot = parseDrillSlot(record.drillSlot);
  const roundDrill = drillMm !== null && drillMm > 0 ? drillMm : null;
  return {
    id,
    centerMm: { x: cx, y: cy },
    rotationDeg,
    padType,
    shape,
    widthMm,
    // A `circle` pad is a DISC of `widthMm` — the ONE interpretation
    // (manufacturability contract 10 §7), applied at HYDRATION so a row
    // persisted before the rule reads back as a disc too.
    heightMm: shape === "circle" ? widthMm : heightMm,
    ...(roundrectRatio !== null ? { roundrectRatio } : {}),
    // `drillMm` and `drillSlot.widthMm` are ONE value — the tool diameter (the
    // SDK has always said so; contract 10 §1.2). A slotted row's round
    // `drillMm` is whatever the authoring path last wrote, so the slot width
    // wins at hydration and no consumer can drill a different tool from the
    // one the slot is routed with.
    drillMm: drillSlot ? drillSlot.widthMm : roundDrill,
    drillSlot,
    layer,
    netId: netId ?? null,
    solderMaskExpansionMm,
    solderPasteExpansionMm,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbFreePads(db: DbClient, designId: string): PcbFreePad[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
      ),
    )
    .all();
  const out: PcbFreePad[] = [];
  for (const row of rows) {
    const parsed = parseFreePad(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbFreePadById(
  db: DbClient,
  designId: string,
  freePadId: string,
): PcbFreePad | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
        eq(pcbEntities.id, freePadId),
      ),
    )
    .get();
  if (!row) return null;
  return parseFreePad(parsePayload(row.payloadJson));
}

export function insertPcbFreePad(
  db: DbClient,
  designId: string,
  pad: PcbFreePad,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: pad.id,
      designId,
      kind: FREE_PAD_KIND,
      payloadJson: JSON.stringify(pad),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbFreePad(
  db: DbClient,
  pad: PcbFreePad,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(pad), updatedAt: timestamp })
    .where(eq(pcbEntities.id, pad.id))
    .run();
}

export function deletePcbFreePad(db: DbClient, freePadId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, freePadId)).run();
}

// ───────────────────── Overlay text (F5) ─────────────────────

function parseOverlayLayer(value: unknown): PcbOverlayLayer | null {
  const s = asString(value);
  return s && OVERLAY_LAYERS.has(s as PcbOverlayLayer)
    ? (s as PcbOverlayLayer)
    : null;
}

function parseOverlayText(value: unknown): PcbOverlayText | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const layer = parseOverlayLayer(record.layer);
  const pos = asRecord(record.positionMm);
  const px = asNumber(pos?.x);
  const py = asNumber(pos?.y);
  const text = asString(record.text);
  const fontSizeMm = asNumber(record.fontSizeMm);
  const rotationDeg = asNumber(record.rotationDeg);
  if (
    !id ||
    !layer ||
    px === null ||
    py === null ||
    text === null ||
    fontSizeMm === null ||
    fontSizeMm <= 0 ||
    rotationDeg === null
  ) {
    return null;
  }
  const justifyRaw = asString(record.justify);
  const justify: PcbOverlayText["justify"] =
    justifyRaw === "left" || justifyRaw === "right" ? justifyRaw : "center";
  const mirror = record.mirror === true;
  const lockedAt = asString(record.lockedAt);
  return {
    id,
    layer,
    positionMm: { x: px, y: py },
    text,
    fontSizeMm,
    rotationDeg,
    mirror,
    justify,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbOverlayTexts(
  db: DbClient,
  designId: string,
): PcbOverlayText[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
      ),
    )
    .all();
  const out: PcbOverlayText[] = [];
  for (const row of rows) {
    const parsed = parseOverlayText(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbOverlayTextById(
  db: DbClient,
  designId: string,
  id: string,
): PcbOverlayText | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
        eq(pcbEntities.id, id),
      ),
    )
    .get();
  if (!row) return null;
  return parseOverlayText(parsePayload(row.payloadJson));
}

export function insertPcbOverlayText(
  db: DbClient,
  designId: string,
  overlay: PcbOverlayText,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: overlay.id,
      designId,
      kind: OVERLAY_TEXT_KIND,
      payloadJson: JSON.stringify(overlay),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbOverlayText(
  db: DbClient,
  overlay: PcbOverlayText,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(overlay), updatedAt: timestamp })
    .where(eq(pcbEntities.id, overlay.id))
    .run();
}

export function deletePcbOverlayText(db: DbClient, id: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, id)).run();
}

// ───────────────────── Overlay shape (F5) ────────────────────

function parseOverlayShape(value: unknown): PcbOverlayShape | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const layer = parseOverlayLayer(record.layer);
  const kindRaw = asString(record.kind);
  const kind =
    kindRaw && OVERLAY_SHAPE_KINDS.has(kindRaw as PcbOverlayShapeKind)
      ? (kindRaw as PcbOverlayShapeKind)
      : null;
  const strokeWidthMm = asNumber(record.strokeWidthMm);
  const pointsRaw = Array.isArray(record.pointsMm) ? record.pointsMm : null;
  if (
    !id ||
    !layer ||
    !kind ||
    strokeWidthMm === null ||
    strokeWidthMm <= 0 ||
    !pointsRaw ||
    pointsRaw.length < 2
  ) {
    return null;
  }
  const pointsMm: { x: number; y: number }[] = [];
  for (const raw of pointsRaw) {
    const r = asRecord(raw);
    const x = asNumber(r?.x);
    const y = asNumber(r?.y);
    if (x === null || y === null) return null;
    pointsMm.push({ x, y });
  }
  const fill: PcbOverlayShape["fill"] =
    record.fill === "solid" ? "solid" : "none";
  const lockedAt = asString(record.lockedAt);
  return {
    id,
    layer,
    kind,
    pointsMm,
    strokeWidthMm,
    fill,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbOverlayShapes(
  db: DbClient,
  designId: string,
): PcbOverlayShape[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
      ),
    )
    .all();
  const out: PcbOverlayShape[] = [];
  for (const row of rows) {
    const parsed = parseOverlayShape(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbOverlayShapeById(
  db: DbClient,
  designId: string,
  id: string,
): PcbOverlayShape | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
        eq(pcbEntities.id, id),
      ),
    )
    .get();
  if (!row) return null;
  return parseOverlayShape(parsePayload(row.payloadJson));
}

export function insertPcbOverlayShape(
  db: DbClient,
  designId: string,
  shape: PcbOverlayShape,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: shape.id,
      designId,
      kind: OVERLAY_SHAPE_KIND,
      payloadJson: JSON.stringify(shape),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbOverlayShape(
  db: DbClient,
  shape: PcbOverlayShape,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(shape), updatedAt: timestamp })
    .where(eq(pcbEntities.id, shape.id))
    .run();
}

export function deletePcbOverlayShape(db: DbClient, id: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, id)).run();
}

// ─────────── Replace-helpers used by undo/redo replay ───────────
// Each `replacePcb*` wipes all rows of one kind for a design and re-inserts
// the supplied list. The history reconstitution path
// (`applyHistoryPatches`) snapshots before-state, applies patches in an ECS
// world, then calls these to make the DB row set match the post-patch world.

export function replacePcbFreeHoles(
  db: DbClient,
  designId: string,
  holes: PcbFreeHole[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
      ),
    )
    .run();
  for (const hole of holes) insertPcbFreeHole(db, designId, hole, timestamp);
}

export function replacePcbFreePads(
  db: DbClient,
  designId: string,
  pads: PcbFreePad[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
      ),
    )
    .run();
  for (const pad of pads) insertPcbFreePad(db, designId, pad, timestamp);
}

export function replacePcbOverlayTexts(
  db: DbClient,
  designId: string,
  overlays: PcbOverlayText[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
      ),
    )
    .run();
  for (const overlay of overlays) {
    insertPcbOverlayText(db, designId, overlay, timestamp);
  }
}

export function replacePcbOverlayShapes(
  db: DbClient,
  designId: string,
  shapes: PcbOverlayShape[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
      ),
    )
    .run();
  for (const shape of shapes) {
    insertPcbOverlayShape(db, designId, shape, timestamp);
  }
}

// ───────────────────────── Zones and keepouts ─────────────────────────

/**
 * Zone rows are read through the ONE upgrade path (S3a contract §2.1) so a v1
 * payload becomes a v2 record identically here, in the golden loader and in
 * any future paste/import. Warnings travel with the rows; the projection
 * decides what to surface.
 */
export function loadPcbZones(
  db: DbClient,
  designId: string,
): { zones: PcbZone[]; warnings: ZoneRecordWarning[] } {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, ZONE_KIND)),
    )
    .all();
  const zones: PcbZone[] = [];
  const warnings: ZoneRecordWarning[] = [];
  for (const row of rows) {
    const upgraded = upgradePcbZoneRecord(parsePayload(row.payloadJson));
    warnings.push(...upgraded.warnings);
    if (upgraded.zone) zones.push(upgraded.zone);
  }
  return { zones, warnings };
}

/**
 * `designer_pcb_entities.id` is a GLOBAL primary key, so the row id is a fresh
 * uuid and the entity id (`board:<layer>` or a uuid) lives only in the payload
 * — otherwise two designs could not both hold a `board:F.Cu` zone. Readers
 * never depend on the row id; update/delete resolve it by payload id within
 * the design (contract §12.1).
 */
export function insertPcbZone(
  db: DbClient,
  designId: string,
  zone: PcbZone,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: ZONE_KIND,
      payloadJson: JSON.stringify(zone),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function replacePcbZones(
  db: DbClient,
  designId: string,
  zones: PcbZone[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, ZONE_KIND)),
    )
    .run();
  for (const zone of zones) {
    insertPcbZone(db, designId, zone, timestamp);
  }
}

/**
 * Resolve one zone by its PAYLOAD id (the entity id) within a design, returning
 * the row id the writers need. Row ids are uuids, so this scan is the only way
 * back from an entity id to its row.
 */
export function loadPcbZoneRowById(
  db: DbClient,
  designId: string,
  zoneId: string,
): { rowId: string; zone: PcbZone } | null {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, ZONE_KIND)),
    )
    .all();
  for (const row of rows) {
    const upgraded = upgradePcbZoneRecord(parsePayload(row.payloadJson));
    if (upgraded.zone && upgraded.zone.id === zoneId) {
      return { rowId: row.id, zone: upgraded.zone };
    }
  }
  return null;
}

export function updatePcbZone(
  db: DbClient,
  rowId: string,
  zone: PcbZone,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(zone), updatedAt: timestamp })
    .where(eq(pcbEntities.id, rowId))
    .run();
}

export function deletePcbZone(db: DbClient, rowId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, rowId)).run();
}

function parseKeepout(value: unknown): PcbKeepout | null {
  return parsePcbKeepoutRecord(value);
}

export function loadPcbKeepouts(db: DbClient, designId: string): PcbKeepout[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, KEEPOUT_KIND),
      ),
    )
    .all();
  const out: PcbKeepout[] = [];
  for (const row of rows) {
    const parsed = parseKeepout(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Row id is a fresh uuid; the entity id lives in the payload (see `insertPcbZone`). */
export function insertPcbKeepout(
  db: DbClient,
  designId: string,
  keepout: PcbKeepout,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: KEEPOUT_KIND,
      payloadJson: JSON.stringify(keepout),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function replacePcbKeepouts(
  db: DbClient,
  designId: string,
  keepouts: PcbKeepout[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, KEEPOUT_KIND),
      ),
    )
    .run();
  for (const keepout of keepouts) {
    insertPcbKeepout(db, designId, keepout, timestamp);
  }
}

/** Keepout twin of `loadPcbZoneRowById` — resolve by payload id, return the row id. */
export function loadPcbKeepoutRowById(
  db: DbClient,
  designId: string,
  keepoutId: string,
): { rowId: string; keepout: PcbKeepout } | null {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, KEEPOUT_KIND),
      ),
    )
    .all();
  for (const row of rows) {
    const parsed = parseKeepout(parsePayload(row.payloadJson));
    if (parsed && parsed.id === keepoutId) {
      return { rowId: row.id, keepout: parsed };
    }
  }
  return null;
}

export function updatePcbKeepout(
  db: DbClient,
  rowId: string,
  keepout: PcbKeepout,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(keepout), updatedAt: timestamp })
    .where(eq(pcbEntities.id, rowId))
    .run();
}

export function deletePcbKeepout(db: DbClient, rowId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, rowId)).run();
}

// ───────────────── Legacy board-fill migration (contract §12.1) ─────────────

/**
 * The RAW `board_settings` payload, unparsed. The migration below must see the
 * legacy `copperFill*` keys that `parseBoardSettings` no longer reads, and must
 * write back the raw record so unknown fields survive.
 */
export function readRawBoardSettingsRow(
  db: DbClient,
  designId: string,
): { rowId: string; raw: Record<string, unknown> } | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .get();
  if (!row) return null;
  const raw = asRecord(parsePayload(row.payloadJson));
  if (!raw) return null;
  return { rowId: row.id, raw };
}

/** Copper layer ids from a legacy `viewState.copperFillLayers` array. */
function readLegacyFillLayers(value: unknown): PcbCopperLayerId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PcbCopperLayerId>();
  const out: PcbCopperLayerId[] = [];
  for (const item of value) {
    if (isCopperLayerId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

/**
 * One-time, lazy migration of the legacy per-layer copper-fill view state into
 * persisted board zone rows (contract §12.1). Every entry point that can write
 * board settings calls it FIRST, because every settings writer re-serialises the
 * parsed record and would otherwise silently drop the unread legacy keys.
 *
 * The legacy policy poured "the net whose name matches GND_NAMES", so the row
 * persists that net's real NAME (net ids are ephemeral); with no ground net the
 * hint is `"GND"`, which pours nothing until such a net exists.
 *
 * Idempotent, no revision bump, no history entry. Returns whether it wrote.
 */
export function migrateLegacyBoardFill(
  db: DbClient,
  designId: string,
  netNames: ReadonlyMap<string, string>,
  timestamp: string,
): boolean {
  const row = readRawBoardSettingsRow(db, designId);
  if (!row) return false;
  const viewState = asRecord(row.raw.viewState);
  if (!viewState) return false;
  if (
    viewState.copperFillLayers === undefined &&
    viewState.copperFillPourNetIds === undefined &&
    viewState.copperFillPadConnection === undefined
  ) {
    return false;
  }

  const stackup = copperLayersForCount(parseLayerCount(row.raw.layerCount));
  // EVERY zone id, not just the board rows: a polygon row that already holds
  // the reserved `board:<layer>` id would otherwise let the migration insert a
  // colliding second row (both then drop, fail-closed, with no copper).
  const existingZoneIds = new Set(
    loadPcbZones(db, designId).zones.map((zone) => zone.id),
  );
  const gndNetId = findGroundNetId(netNames);
  const gndNetName =
    gndNetId !== null ? (netNames.get(gndNetId) ?? "GND") : "GND";
  const fillLayers = new Set(readLegacyFillLayers(viewState.copperFillLayers));

  for (const layer of stackup) {
    if (!fillLayers.has(layer)) continue;
    const id = boardZoneId(layer);
    if (existingZoneIds.has(id)) continue;
    insertPcbZone(
      db,
      designId,
      {
        id,
        name: null,
        enabled: true,
        lockedAt: null,
        layer,
        netId: null,
        netName: gndNetName,
        region: { kind: "board" },
        priority: 0,
        padConnection: "solid",
      },
      timestamp,
    );
  }

  delete viewState.copperFillLayers;
  delete viewState.copperFillPourNetIds;
  delete viewState.copperFillPadConnection;
  // The RAW record, never the typed serializer: the three legacy keys deleted
  // just above are UNKNOWN to `viewState`'s carry-over, which would faithfully
  // put them straight back. This write is the one that is allowed to remove
  // data, so it writes the record it edited.
  db.update(pcbEntities)
    .set({ payloadJson: serializeRawBoardSettings(row.raw), updatedAt: timestamp })
    .where(eq(pcbEntities.id, row.rowId))
    .run();
  return true;
}
