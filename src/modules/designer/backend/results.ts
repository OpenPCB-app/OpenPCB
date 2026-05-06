import type {
  DesignerCommandOkResult,
  DesignerDispatchResult,
  DesignerEntityKind,
} from "../../../sdks";
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
    return {
      ok: true,
      revision,
      createdEntityId:
        typeof createdEntityIdRaw === "string" || createdEntityIdRaw === null
          ? createdEntityIdRaw
          : null,
      idempotent: true,
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
      entityKind !== "label"
    ) {
      return null;
    }
    return { ok: false, code, entityId, entityKind };
  }

  if (code === "INVALID_WIRE_PATH") {
    const detail = asString(parsed.detail);
    return detail ? { ok: false, code, detail } : null;
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

export function okResult(
  revision: number,
  createdEntityId: string | null,
): DesignerCommandOkResult {
  return { ok: true, revision, createdEntityId, idempotent: false };
}
