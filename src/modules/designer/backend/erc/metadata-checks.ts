import type {
  DesignerSchematicProjection,
  ErcViolation,
} from "../../../../sdks/designer";

const ELECTRICAL_TYPES = new Set([
  "input",
  "output",
  "bidirectional",
  "tri_state",
  "passive",
  "free",
  "unspecified",
  "power_in",
  "power_out",
  "open_collector",
  "open_emitter",
  "no_connect",
]);

export function checkElectricalMetadata(
  projection: DesignerSchematicProjection,
): ErcViolation[] {
  const violations: ErcViolation[] = [];
  for (const part of projection.parts) {
    const units = new Set(
      part.pins.filter((pin) => pin.unit > 0).map((pin) => pin.unit),
    );
    if (units.size > 1) {
      violations.push({
        code: "MULTI_UNIT_SYMBOL_UNSUPPORTED",
        severity: "error",
        message: `Part ${part.reference} combines multiple symbol units in one placement; its connections cannot be validated reliably`,
        anchors: [{ kind: "part", partId: part.id }],
      });
    }
    for (const pin of part.pins) {
      if (ELECTRICAL_TYPES.has(pin.electricalType)) continue;
      violations.push({
        code: "PIN_ELECTRICAL_TYPE_UNKNOWN",
        severity: "warning",
        message: `Pin ${part.reference}.${pin.number ?? pin.name} has unsupported electrical type "${pin.electricalType}"`,
        anchors: [{ kind: "pin", pinId: pin.id }],
      });
    }
  }
  return violations;
}
