import type {
  DesignerPin,
  DesignerSchematicProjection,
  ErcReport,
  ErcViolation,
} from "../../../../sdks/designer";

/**
 * ERC engine v1 — runs over the schematic projection's derived nets and
 * surfaces a small set of high-signal rules:
 *
 *  - `UNCONNECTED_INPUT_PIN`: an `input` / `bidirectional` / `tri_state` /
 *    `power_in` pin that does not appear in any derived net (i.e. has no
 *    wire/label/junction connection to anything else).
 *  - `OUTPUT_OUTPUT_SHORT`: a net containing two or more `output` /
 *    `power_out` pins that would short their drivers if routed.
 *  - `NO_CONNECT_VIOLATION`: a `no_connect` pin that *is* wired up. NC pins
 *    must remain unconnected by definition; surfacing this avoids silent
 *    cap loading on internal die nodes.
 *
 * The engine is pure: takes the projection, returns a report. UI consumers
 * decide whether to render live indicators, a batch panel, or both.
 */

const STRICT_INPUT_TYPES = new Set([
  "input",
  "bidirectional",
  "tri_state",
  "power_in",
]);

const OUTPUT_DRIVER_TYPES = new Set(["output", "power_out"]);

/**
 * Pins typed as `no_connect` must remain electrically isolated.
 */
const NO_CONNECT_TYPE = "no_connect";

export function runErc(projection: DesignerSchematicProjection): ErcReport {
  const violations: ErcViolation[] = [];
  const pinsById = new Map<string, DesignerPin>();
  const allPins = projection.parts.flatMap((part) => part.pins);
  for (const pin of allPins) {
    pinsById.set(pin.id, pin);
  }
  const partOfPin = new Map<string, string>();
  const refsByPart = new Map<string, string>();
  for (const part of projection.parts) {
    refsByPart.set(part.id, part.reference);
    for (const pin of part.pins) {
      partOfPin.set(pin.id, part.id);
    }
  }
  const netByPinId = new Map<string, string>();
  for (const net of projection.nets) {
    for (const pinId of net.pinIds) {
      netByPinId.set(pinId, net.id);
    }
  }

  // Rule 1 — unconnected input.
  for (const pin of allPins) {
    if (!STRICT_INPUT_TYPES.has(pin.electricalType)) continue;
    if (netByPinId.has(pin.id)) continue;
    const partId = partOfPin.get(pin.id);
    const reference = partId ? (refsByPart.get(partId) ?? "?") : "?";
    violations.push({
      code: "UNCONNECTED_INPUT_PIN",
      severity: pin.electricalType === "power_in" ? "error" : "warning",
      message: `Pin ${reference}.${pin.number ?? pin.name} (${pin.electricalType}) is not connected to any net`,
      anchors: [{ kind: "pin", pinId: pin.id }],
    });
  }

  // Rule 2 — output-output short.
  for (const net of projection.nets) {
    const driverPins: DesignerPin[] = [];
    for (const pinId of net.pinIds) {
      const pin = pinsById.get(pinId);
      if (!pin) continue;
      if (OUTPUT_DRIVER_TYPES.has(pin.electricalType)) {
        driverPins.push(pin);
      }
    }
    if (driverPins.length >= 2) {
      const labels = driverPins
        .map((pin) => {
          const partId = partOfPin.get(pin.id);
          const ref = partId ? (refsByPart.get(partId) ?? "?") : "?";
          return `${ref}.${pin.number ?? pin.name}`;
        })
        .join(", ");
      violations.push({
        code: "OUTPUT_OUTPUT_SHORT",
        severity: "error",
        message: `Net "${net.name}" drives ${driverPins.length} output pins together (${labels})`,
        anchors: [
          { kind: "net", netId: net.id },
          ...driverPins.map((pin) => ({ kind: "pin" as const, pinId: pin.id })),
        ],
      });
    }
  }

  // Rule 3 — no-connect pin with connection.
  for (const pin of allPins) {
    if (pin.electricalType !== NO_CONNECT_TYPE) continue;
    if (!netByPinId.has(pin.id)) continue;
    const partId = partOfPin.get(pin.id);
    const reference = partId ? (refsByPart.get(partId) ?? "?") : "?";
    violations.push({
      code: "NO_CONNECT_VIOLATION",
      severity: "warning",
      message: `Pin ${reference}.${pin.number ?? pin.name} is marked no-connect but is wired up`,
      anchors: [{ kind: "pin", pinId: pin.id }],
    });
  }

  return {
    designId: projection.designId,
    revision: projection.revision,
    violations,
    summary: {
      errors: violations.filter((v) => v.severity === "error").length,
      warnings: violations.filter((v) => v.severity === "warning").length,
      infos: violations.filter((v) => v.severity === "info").length,
    },
  };
}
