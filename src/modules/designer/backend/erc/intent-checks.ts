import type { DesignerPin, ErcViolation } from "../../../../sdks/designer";
import { isPinElectricalIntent } from "../pin-electrical-intent";

export function checkPinElectricalIntent(
  pins: readonly DesignerPin[],
  connectedPinIds: ReadonlyMap<string, string>,
): ErcViolation[] {
  const violations: ErcViolation[] = [];
  for (const pin of pins) {
    if (pin.electricalIntent === undefined) continue;
    if (!isPinElectricalIntent(pin.electricalIntent) || (
      pin.electricalIntent === "power_source" && pin.electricalType === "no_connect"
    )) {
      violations.push({
        code: "PIN_ELECTRICAL_INTENT_UNSUPPORTED",
        severity: "error",
        message: `Pin ${pin.number ?? pin.name} has unsupported electrical intent "${pin.electricalIntent}" for type "${pin.electricalType}"`,
        anchors: [{ kind: "pin", pinId: pin.id }],
      });
    } else if (pin.electricalIntent === "no_connect" && connectedPinIds.has(pin.id)) {
      violations.push({
        code: "NO_CONNECT_INTENT_VIOLATION",
        severity: "error",
        message: `Pin ${pin.number ?? pin.name} declares no-connect intent but is electrically connected`,
        anchors: [{ kind: "pin", pinId: pin.id }],
      });
    }
  }
  return violations;
}
