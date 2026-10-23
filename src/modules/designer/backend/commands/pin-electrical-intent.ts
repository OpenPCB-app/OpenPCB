import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerDispatchResult,
  DesignerSetPinElectricalIntentCommand,
} from "../../../../sdks/designer";
import { pinNotFound } from "../results";
import { schematicPins } from "../schema";
import { isPinElectricalIntent } from "../pin-electrical-intent";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

/** Returns a failure result, or null after writing the validated pin intent. */
export function applyPinElectricalIntent(params: {
  tx: DbClient;
  designId: string;
  timestamp: string;
  command: DesignerSetPinElectricalIntentCommand;
}): DesignerDispatchResult | null {
  const { tx, designId, timestamp, command } = params;
  const pin = tx.select().from(schematicPins).where(and(
    eq(schematicPins.designId, designId),
    eq(schematicPins.id, command.pinId),
  )).get();
  if (!pin) return pinNotFound(command.pinId);
  if (command.intent !== null && !isPinElectricalIntent(command.intent)) {
    return {
      ok: false, code: "INVALID_PIN_ELECTRICAL_INTENT", pinId: command.pinId,
      detail: "Intent must be no_connect, power_source, or null",
    };
  }
  if (command.intent === "power_source" && pin.electricalType === "no_connect") {
    return {
      ok: false, code: "INVALID_PIN_ELECTRICAL_INTENT", pinId: command.pinId,
      detail: "A library no_connect pin cannot declare a power source",
    };
  }
  tx.update(schematicPins).set({
    electricalIntent: command.intent,
    updatedAt: timestamp,
  }).where(and(eq(schematicPins.designId, designId), eq(schematicPins.id, pin.id))).run();
  return null;
}
