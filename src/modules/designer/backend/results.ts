import type {
  DesignerCommandOkResult,
  DesignerDispatchResult,
  DesignerEntityKind,
  DrcViolation,
  PcbCopperLayerId,
} from "../../../sdks";
import { isCopperLayerId } from "../../../sdks/designer";
import { asNumber, asRecord, asString, parseJsonRecord } from "./value-guards";

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
  if (!code) {
    return null;
  }

  if (code === "REVISION_CONFLICT") {
    const conflict = asRecord(parsed.conflict);
    const actual = asNumber(conflict?.actual);
    const expectedRaw = conflict?.expected;
    const expected = expectedRaw === null ? null : asNumber(expectedRaw);
    if (actual === null || (expectedRaw !== null && expected === null)) {
      return null;
    }
    return { ok: false, code, conflict: { expected, actual } };
  }

  if (code === "COMPONENT_NOT_FOUND") {
    const componentId = asString(parsed.componentId);
    return componentId ? { ok: false, code, componentId } : null;
  }

  if (code === "COMPONENT_NOT_WIREABLE") {
    const componentId = asString(parsed.componentId);
    const reason = asString(parsed.reason);
    return componentId && reason === "NO_PINS"
      ? { ok: false, code, componentId, reason }
      : null;
  }

  if (code === "PIN_NOT_FOUND") {
    const pinId = asString(parsed.pinId);
    return pinId ? { ok: false, code, pinId } : null;
  }

  if (code === "ENTITY_NOT_FOUND") {
    const entityId = asString(parsed.entityId);
    const entityKind = asString(parsed.entityKind) as DesignerEntityKind | null;
    if (!entityId || !entityKind) {
      return null;
    }
    if (
      entityKind !== "part" &&
      entityKind !== "wire" &&
      entityKind !== "label" &&
      entityKind !== "primitive"
    ) {
      return null;
    }
    return { ok: false, code, entityId, entityKind };
  }

  if (code === "INVALID_PRIMITIVE") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "PRIMITIVE_NOT_FOUND") {
    const primitiveId = asString(parsed.primitiveId);
    return primitiveId ? { ok: false, code, primitiveId } : null;
  }

  if (code === "INVALID_WIRE_PATH") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "DUPLICATE_REFERENCE") {
    const reference = asString(parsed.reference);
    return reference ? { ok: false, code, reference } : null;
  }

  if (code === "INVALID_LABEL") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "INVALID_PCB_BOARD_SETTINGS") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "PCB_PLACEMENT_NOT_FOUND") {
    const placementId = asString(parsed.placementId);
    return placementId ? { ok: false, code, placementId } : null;
  }

  if (code === "INVALID_PCB_TRACE") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "INVALID_PCB_VIA") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "PCB_TRACE_NOT_FOUND") {
    const traceId = asString(parsed.traceId);
    return traceId ? { ok: false, code, traceId } : null;
  }

  if (code === "PCB_VIA_NOT_FOUND") {
    const viaId = asString(parsed.viaId);
    return viaId ? { ok: false, code, viaId } : null;
  }

  if (code === "PCB_NET_CLASS_NOT_FOUND") {
    const netClassId = asString(parsed.netClassId);
    return netClassId ? { ok: false, code, netClassId } : null;
  }

  if (code === "INVALID_PCB_ZONE") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "PCB_ZONE_NOT_FOUND") {
    const zoneId = asString(parsed.zoneId);
    return zoneId ? { ok: false, code, zoneId } : null;
  }

  if (code === "PCB_ZONE_BOARD_EXISTS") {
    const layer = asString(parsed.layer);
    return isCopperLayerId(layer) ? { ok: false, code, layer } : null;
  }

  if (code === "INVALID_PCB_KEEPOUT") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
  }

  if (code === "PCB_KEEPOUT_NOT_FOUND") {
    const keepoutId = asString(parsed.keepoutId);
    return keepoutId ? { ok: false, code, keepoutId } : null;
  }

  if (code === "PCB_COPPER_ILLEGAL") {
    const detail = asString(parsed.detail);
    // The row was written by `pcbCopperIllegal` from this process's own DRC
    // report, so the array is structurally trusted; only its presence is
    // checked, as every other branch here checks its fields' presence.
    const violations = parsed.violations;
    if (!detail || !Array.isArray(violations)) return null;
    // `violations` is capped, so the count is a field of its own; a row written
    // before the cap existed has none, and its array IS the whole truth.
    const refusedCount = asNumber(parsed.refusedCount) ?? violations.length;
    return {
      ok: false,
      code,
      detail,
      violations: violations as DrcViolation[],
      refusedCount,
    };
  }

  if (code === "INVALID_DRC_RULE") {
    const ruleId = asString(parsed.ruleId);
    const detail = asString(parsed.detail);
    return ruleId && detail ? { ok: false, code, ruleId, detail } : null;
  }

  return null;
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
