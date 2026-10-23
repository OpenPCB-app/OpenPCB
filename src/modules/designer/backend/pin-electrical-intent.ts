import type { DesignerPin, DesignerPinElectricalIntent } from "../../../sdks/designer";

export function isPinElectricalIntent(value: unknown): value is DesignerPinElectricalIntent {
  return value === "no_connect" || value === "power_source";
}

/** A library NC pin cannot carry an external source, even in stored input. */
export function pinDeclaresPowerSource(pin: DesignerPin): boolean {
  return pin.electricalIntent === "power_source" && pin.electricalType !== "no_connect";
}
