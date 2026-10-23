import type {
  DesignerPrimitive,
  DesignerSchematicProjection,
  ErcViolation,
} from "../../../../sdks/designer";

function portName(primitive: DesignerPrimitive): string {
  if (primitive.kind === "pwr") return primitive.railText;
  if (primitive.kind === "net_portal") return primitive.portalText;
  return "GND";
}

export function checkDetachedAnchors(
  projection: DesignerSchematicProjection,
): ErcViolation[] {
  const violations: ErcViolation[] = [];
  // Absent metadata is unknown, not proof of detachment (older projections).
  for (const label of projection.labels) {
    if (label.attached !== false) continue;
    violations.push({
      code: "UNCONNECTED_LABEL",
      severity: "warning",
      message: `Label "${label.text}" is not attached to a pin or wire`,
      anchors: [{ kind: "label", labelId: label.id }],
    });
  }
  for (const primitive of projection.primitives) {
    if (primitive.kind === "junction" || primitive.attached !== false) continue;
    violations.push({
      code: "UNCONNECTED_PORT",
      severity: "warning",
      message: `Port "${portName(primitive)}" is not attached to a pin or wire`,
      anchors: [{ kind: "primitive", primitiveId: primitive.id }],
    });
  }
  return violations;
}

export function checkNetDiagnostics(
  projection: DesignerSchematicProjection,
): ErcViolation[] {
  return (projection.netDiagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    severity: "warning",
    message: diagnostic.detail,
    anchors: [{ kind: "net", netId: diagnostic.netRoot }],
  }));
}
