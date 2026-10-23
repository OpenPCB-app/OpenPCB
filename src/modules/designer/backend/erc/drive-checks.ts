import type {
  DesignerDerivedNet,
  DesignerPin,
  ErcViolation,
} from "../../../../sdks/designer";
import { pinDeclaresPowerSource } from "../pin-electrical-intent";

const SIGNAL_DRIVER_TYPES = new Set([
  "output",
  "bidirectional",
  "tri_state",
  "power_out",
  "passive",
  "open_collector",
  "open_emitter",
]);

/** Labels and power ports name nets; pins and explicit local intent establish drive. */
export function checkNetDrive(
  net: DesignerDerivedNet,
  pinsById: ReadonlyMap<string, DesignerPin>,
): ErcViolation[] {
  const pins = net.pinIds.flatMap((id) => {
    const pin = pinsById.get(id);
    return pin ? [pin] : [];
  });
  const violations: ErcViolation[] = [];
  const externalSource = pins.some(pinDeclaresPowerSource);
  const checks = [
    {
      type: "input",
      code: "UNDRIVEN_INPUT_PIN",
      severity: "warning" as const,
      driven: externalSource || pins.some((pin) => SIGNAL_DRIVER_TYPES.has(pin.electricalType)),
      message: `Net "${net.name}" has input pins but no signal-driving pin`,
    },
    {
      type: "power_in",
      code: "UNDRIVEN_POWER_PIN",
      severity: "error" as const,
      driven: externalSource || pins.some((pin) => pin.electricalType === "power_out"),
      message: `Net "${net.name}" has power input pins but no power output pin`,
    },
  ];
  for (const check of checks) {
    const inputs = pins.filter((pin) => pin.electricalType === check.type);
    if (check.driven || inputs.length === 0) continue;
    violations.push({
      code: check.code,
      severity: check.severity,
      message: check.message,
      anchors: [
        { kind: "net", netId: net.id },
        ...inputs.map((pin) => ({ kind: "pin" as const, pinId: pin.id })),
      ],
    });
  }
  return violations;
}
