import type {
  DesignerCommandOkResult,
  DesignerDispatchResult,
  DesignerEntityKind,
  DrcViolation,
  PcbCopperLayerId,
} from "../../../sdks";
import { isCopperLayerId } from "../../../sdks/designer";
import { asNumber, asRecord, asString, parseJsonRecord } from "./value-guards";

export type DesignerDispatchFailure = Extract<DesignerDispatchResult, { ok: false }>;
export type DesignerDispatchFailureCode = DesignerDispatchFailure["code"];
type FailureOf<C extends DesignerDispatchFailureCode> = Extract<
  DesignerDispatchFailure,
  { code: C }
>;
type LoggedRecord = Record<string, unknown>;

/** A non-empty string field, or null — the presence check every branch makes. */
function text(rec: LoggedRecord, key: string): string | null {
  return asString(rec[key]) || null;
}

function isNetSummary(value: unknown): boolean {
  const net = asRecord(value);
  return (
    !!net &&
    (net.name === null || typeof net.name === "string") &&
    asNumber(net.pinCount) !== null
  );
}

/**
 * One parser per failure code. The mapped type makes this table exhaustive:
 * a result code added to `DesignerDispatchResult` without a parser here fails
 * typecheck, instead of replaying as an unparseable row (OPENPCB-103).
 */
const FAILURE_PARSERS: {
  [C in DesignerDispatchFailureCode]: (rec: LoggedRecord) => FailureOf<C> | null;
} = {
  NET_MERGE_REQUIRES_CONFIRM: (rec) => {
    const message = text(rec, "message");
    const nets = rec.nets;
    return message && Array.isArray(nets) && nets.every(isNetSummary)
      ? {
          ok: false,
          code: "NET_MERGE_REQUIRES_CONFIRM",
          message,
          nets: nets as FailureOf<"NET_MERGE_REQUIRES_CONFIRM">["nets"],
        }
      : null;
  },
  OPERATION_IDENTITY_CONFLICT: (rec) => {
    const commandId = text(rec, "commandId");
    return commandId
      ? { ok: false, code: "OPERATION_IDENTITY_CONFLICT", commandId }
      : null;
  },
  PCB_COPPER_ILLEGAL: (rec) => {
    const detail = text(rec, "detail");
    // The row was written by `pcbCopperIllegal` from this process's own DRC
    // report, so the array is structurally trusted; only its presence is
    // checked, as every other branch here checks its fields' presence.
    const violations = rec.violations;
    if (!detail || !Array.isArray(violations)) return null;
    // `violations` is capped, so the count is a field of its own; a row written
    // before the cap existed has none, and its array IS the whole truth.
    const refusedCount = asNumber(rec.refusedCount) ?? violations.length;
    return {
      ok: false,
      code: "PCB_COPPER_ILLEGAL",
      detail,
      violations: violations as DrcViolation[],
      refusedCount,
    };
  },
  REVISION_CONFLICT: (rec) => {
    const conflict = asRecord(rec.conflict);
    const actual = asNumber(conflict?.actual);
    const expectedRaw = conflict?.expected;
    const expected = expectedRaw === null ? null : asNumber(expectedRaw);
    if (actual === null || (expectedRaw !== null && expected === null)) {
      return null;
    }
    return { ok: false, code: "REVISION_CONFLICT", conflict: { expected, actual } };
  },
  COMPONENT_NOT_FOUND: (rec) => {
    const componentId = text(rec, "componentId");
    return componentId ? { ok: false, code: "COMPONENT_NOT_FOUND", componentId } : null;
  },
  COMPONENT_NOT_WIREABLE: (rec) => {
    const componentId = text(rec, "componentId");
    return componentId && rec.reason === "NO_PINS"
      ? { ok: false, code: "COMPONENT_NOT_WIREABLE", componentId, reason: "NO_PINS" }
      : null;
  },
  FOOTPRINT_PIN_MISMATCH: (rec) => {
    const partId = text(rec, "partId");
    const missing = rec.missingPinNumbers;
    return partId &&
      Array.isArray(missing) &&
      missing.every((n) => typeof n === "string")
      ? {
          ok: false,
          code: "FOOTPRINT_PIN_MISMATCH",
          partId,
          missingPinNumbers: missing as string[],
        }
      : null;
  },
  PIN_NOT_FOUND: (rec) => {
    const pinId = text(rec, "pinId");
    return pinId ? { ok: false, code: "PIN_NOT_FOUND", pinId } : null;
  },
  ENTITY_NOT_FOUND: (rec) => {
    const entityId = text(rec, "entityId");
    const entityKind = rec.entityKind;
    return entityId && isEntityKind(entityKind)
      ? { ok: false, code: "ENTITY_NOT_FOUND", entityId, entityKind }
      : null;
  },
  INVALID_WIRE_PATH: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_WIRE_PATH", detail } : null;
  },
  DUPLICATE_REFERENCE: (rec) => {
    const reference = text(rec, "reference");
    return reference ? { ok: false, code: "DUPLICATE_REFERENCE", reference } : null;
  },
  INVALID_LABEL: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_LABEL", detail } : null;
  },
  INVALID_PRIMITIVE: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PRIMITIVE", detail } : null;
  },
  PRIMITIVE_NOT_FOUND: (rec) => {
    const primitiveId = text(rec, "primitiveId");
    return primitiveId ? { ok: false, code: "PRIMITIVE_NOT_FOUND", primitiveId } : null;
  },
  INVALID_PCB_BOARD_SETTINGS: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail } : null;
  },
  PCB_PLACEMENT_NOT_FOUND: (rec) => {
    const placementId = text(rec, "placementId");
    return placementId
      ? { ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId }
      : null;
  },
  INVALID_PCB_TRACE: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_TRACE", detail } : null;
  },
  INVALID_PCB_VIA: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_VIA", detail } : null;
  },
  PCB_TRACE_NOT_FOUND: (rec) => {
    const traceId = text(rec, "traceId");
    return traceId ? { ok: false, code: "PCB_TRACE_NOT_FOUND", traceId } : null;
  },
  PCB_VIA_NOT_FOUND: (rec) => {
    const viaId = text(rec, "viaId");
    return viaId ? { ok: false, code: "PCB_VIA_NOT_FOUND", viaId } : null;
  },
  PCB_NET_CLASS_NOT_FOUND: (rec) => {
    const netClassId = text(rec, "netClassId");
    return netClassId
      ? { ok: false, code: "PCB_NET_CLASS_NOT_FOUND", netClassId }
      : null;
  },
  INVALID_PCB_FREE_HOLE: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_FREE_HOLE", detail } : null;
  },
  PCB_FREE_HOLE_NOT_FOUND: (rec) => {
    const freeHoleId = text(rec, "freeHoleId");
    return freeHoleId
      ? { ok: false, code: "PCB_FREE_HOLE_NOT_FOUND", freeHoleId }
      : null;
  },
  INVALID_PCB_FREE_PAD: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_FREE_PAD", detail } : null;
  },
  PCB_FREE_PAD_NOT_FOUND: (rec) => {
    const freePadId = text(rec, "freePadId");
    return freePadId ? { ok: false, code: "PCB_FREE_PAD_NOT_FOUND", freePadId } : null;
  },
  INVALID_PCB_OVERLAY: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_OVERLAY", detail } : null;
  },
  PCB_OVERLAY_NOT_FOUND: (rec) => {
    const overlayId = text(rec, "overlayId");
    return overlayId ? { ok: false, code: "PCB_OVERLAY_NOT_FOUND", overlayId } : null;
  },
  INVALID_PCB_ZONE: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_ZONE", detail } : null;
  },
  PCB_ZONE_NOT_FOUND: (rec) => {
    const zoneId = text(rec, "zoneId");
    return zoneId ? { ok: false, code: "PCB_ZONE_NOT_FOUND", zoneId } : null;
  },
  PCB_ZONE_BOARD_EXISTS: (rec) => {
    const layer = asString(rec.layer);
    return isCopperLayerId(layer)
      ? { ok: false, code: "PCB_ZONE_BOARD_EXISTS", layer }
      : null;
  },
  INVALID_PCB_KEEPOUT: (rec) => {
    const detail = text(rec, "detail");
    return detail ? { ok: false, code: "INVALID_PCB_KEEPOUT", detail } : null;
  },
  PCB_KEEPOUT_NOT_FOUND: (rec) => {
    const keepoutId = text(rec, "keepoutId");
    return keepoutId ? { ok: false, code: "PCB_KEEPOUT_NOT_FOUND", keepoutId } : null;
  },
  INVALID_DRC_RULE: (rec) => {
    const ruleId = text(rec, "ruleId");
    const detail = text(rec, "detail");
    return ruleId && detail
      ? { ok: false, code: "INVALID_DRC_RULE", ruleId, detail }
      : null;
  },
};

function isEntityKind(value: unknown): value is DesignerEntityKind {
  return (
    value === "part" ||
    value === "wire" ||
    value === "label" ||
    value === "primitive"
  );
}

function isFailureCode(code: string): code is DesignerDispatchFailureCode {
  return Object.prototype.hasOwnProperty.call(FAILURE_PARSERS, code);
}

export function parseDispatchResultJson(
  payloadJson: string,
): DesignerDispatchResult | null {
  const parsed = parseJsonRecord(payloadJson);
  if (parsed.ok === true) {
    const revision = asNumber(parsed.revision);
    if (revision === null) {
      return null;
    }
    const createdEntityIdRaw = parsed.createdEntityId;
    // The gate verdict is replayed verbatim: an idempotent retry answers with
    // the verdict of the revision that actually committed (contract 07 §6).
    const legalityRaw = asRecord(parsed.legality);
    const refused = asNumber(legalityRaw?.refused);
    const warnings = asNumber(legalityRaw?.warnings);
    return {
      ok: true,
      revision,
      createdEntityId:
        typeof createdEntityIdRaw === "string" || createdEntityIdRaw === null
          ? createdEntityIdRaw
          : null,
      idempotent: true,
      ...(refused !== null && warnings !== null
        ? { legality: { refused, warnings } }
        : {}),
    };
  }

  if (parsed.ok !== false) {
    return null;
  }

  const code = asString(parsed.code);
  if (!code || !isFailureCode(code)) {
    return null;
  }
  const parse = FAILURE_PARSERS[code] as (
    rec: LoggedRecord,
  ) => DesignerDispatchFailure | null;
  return parse(parsed);
}

/**
 * What a logged result says about itself when this build cannot rebuild it:
 * `rawOk` is null when the row is not even a result-shaped JSON object.
 */
export function inspectLoggedResult(resultJson: string): {
  rawOk: boolean | null;
  rawCode: string | null;
} {
  const parsed = parseJsonRecord(resultJson);
  return {
    rawOk: typeof parsed.ok === "boolean" ? parsed.ok : null,
    rawCode: asString(parsed.code),
  };
}

/**
 * The result a duplicate command id replays. An unparseable row must never
 * replay as a REVISION_CONFLICT with `actual >= 0`: that reads as an ordinary
 * conflict and invites a fresh-id reapply of a command that already applied.
 * A logged success replays as success at its applied revision; anything else
 * replays as "not applied" (`actual: -1`).
 */
export function replayLoggedResult(
  resultJson: string,
  appliedRevision: number,
  baseRevision: number | null,
): DesignerDispatchResult {
  const parsed = parseDispatchResultJson(resultJson);
  if (parsed) return parsed;
  if (inspectLoggedResult(resultJson).rawOk === true) {
    return {
      ok: true,
      revision: appliedRevision,
      createdEntityId: null,
      idempotent: true,
    };
  }
  return conflict(baseRevision, -1);
}

export function conflict(
  expected: number | null,
  actual: number,
): DesignerDispatchResult {
  return {
    ok: false,
    code: "REVISION_CONFLICT",
    conflict: { expected, actual },
  };
}

export function componentNotFound(componentId: string): DesignerDispatchResult {
  return { ok: false, code: "COMPONENT_NOT_FOUND", componentId };
}

export function footprintPinMismatch(
  partId: string,
  missingPinNumbers: string[],
): DesignerDispatchResult {
  return { ok: false, code: "FOOTPRINT_PIN_MISMATCH", partId, missingPinNumbers };
}

export function pinNotFound(pinId: string): DesignerDispatchResult {
  return { ok: false, code: "PIN_NOT_FOUND", pinId };
}

export function entityNotFound(
  entityId: string,
  entityKind: DesignerEntityKind,
): DesignerDispatchResult {
  return { ok: false, code: "ENTITY_NOT_FOUND", entityId, entityKind };
}

export function invalidWirePath(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_WIRE_PATH", detail };
}

export function invalidLabel(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_LABEL", detail };
}

export function invalidPrimitive(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PRIMITIVE", detail };
}

export function primitiveNotFound(primitiveId: string): DesignerDispatchResult {
  return { ok: false, code: "PRIMITIVE_NOT_FOUND", primitiveId };
}

export function invalidPcbBoardSettings(
  detail: string,
): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_BOARD_SETTINGS", detail };
}

export function pcbPlacementNotFound(
  placementId: string,
): DesignerDispatchResult {
  return { ok: false, code: "PCB_PLACEMENT_NOT_FOUND", placementId };
}

export function invalidPcbTrace(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_TRACE", detail };
}

export function invalidPcbVia(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_VIA", detail };
}

export function pcbTraceNotFound(traceId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_TRACE_NOT_FOUND", traceId };
}

export function pcbViaNotFound(viaId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_VIA_NOT_FOUND", viaId };
}

export function invalidPcbFreeHole(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_FREE_HOLE", detail };
}

export function pcbFreeHoleNotFound(
  freeHoleId: string,
): DesignerDispatchResult {
  return { ok: false, code: "PCB_FREE_HOLE_NOT_FOUND", freeHoleId };
}

export function invalidPcbFreePad(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_FREE_PAD", detail };
}

export function pcbFreePadNotFound(freePadId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_FREE_PAD_NOT_FOUND", freePadId };
}

export function invalidPcbOverlay(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_OVERLAY", detail };
}

export function pcbOverlayNotFound(overlayId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_OVERLAY_NOT_FOUND", overlayId };
}

export function invalidPcbZone(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_ZONE", detail };
}

export function pcbZoneNotFound(zoneId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_ZONE_NOT_FOUND", zoneId };
}

export function pcbZoneBoardExists(
  layer: PcbCopperLayerId,
): DesignerDispatchResult {
  return { ok: false, code: "PCB_ZONE_BOARD_EXISTS", layer };
}

export function invalidPcbKeepout(detail: string): DesignerDispatchResult {
  return { ok: false, code: "INVALID_PCB_KEEPOUT", detail };
}

export function pcbKeepoutNotFound(keepoutId: string): DesignerDispatchResult {
  return { ok: false, code: "PCB_KEEPOUT_NOT_FOUND", keepoutId };
}

export function invalidDrcRule(
  ruleId: string,
  detail: string,
): DesignerDispatchResult {
  return { ok: false, code: "INVALID_DRC_RULE", ruleId, detail };
}

export function pcbNetClassNotFound(
  netClassId: string,
): DesignerDispatchResult {
  return { ok: false, code: "PCB_NET_CLASS_NOT_FOUND", netClassId };
}

export function duplicateReference(reference: string): DesignerDispatchResult {
  return { ok: false, code: "DUPLICATE_REFERENCE", reference };
}

/** `0.250`, or `?` for a violation that carries no measurement. */
function mm(value: number | undefined): string {
  return value === undefined ? "?" : value.toFixed(3);
}

/**
 * One line naming what blocked the commit. The first three violations in the
 * report's canonical `(code, id)` order, so the same board and the same pending
 * copper always produce the same detail string.
 */
function copperIllegalDetail(violations: readonly DrcViolation[]): string {
  const head = violations
    .slice(0, 3)
    .map((v) => `${v.code} (${mm(v.measuredMm)}/${mm(v.requiredMm)})`)
    .join(", ");
  const rest = violations.length > 3 ? ", …" : "";
  return `${violations.length} DRC violation(s): ${head}${rest}`;
}

/**
 * How many refused violations a refusal carries. A bundle route can cross a
 * dense board in both directions, and the verdict is O(pending × board): the
 * result is persisted verbatim in `command_log.result_json` and shipped over
 * HTTP, so it must not grow with the board. The count is reported in full.
 */
const MAX_REPORTED_VIOLATIONS = 50;

/**
 * The copper commit gate's refusal (live-parity contract 07 §6): the command
 * persisted nothing, and `violations` is the reference DRC verdict on the
 * copper it would have committed, with the ids batch DRC would assign — the
 * first 50 of them, in the canonical order `finalizeReport` sorted them into.
 */
export function pcbCopperIllegal(
  violations: DrcViolation[],
): DesignerDispatchResult {
  return {
    ok: false,
    code: "PCB_COPPER_ILLEGAL",
    detail: copperIllegalDetail(violations),
    violations: violations.slice(0, MAX_REPORTED_VIOLATIONS),
    refusedCount: violations.length,
  };
}

export function okResult(
  revision: number,
  createdEntityId: string | null,
  /** Gate verdict counts; omitted entirely under `legality: "off"` (§6). */
  legality?: { refused: number; warnings: number },
): DesignerCommandOkResult {
  return {
    ok: true,
    revision,
    createdEntityId,
    idempotent: false,
    ...(legality ? { legality } : {}),
  };
}
