import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { cloudLink, netIdentityRetired, netIdentityState, schematicPins } from "./schema";

export const CLOUD_PIN_INTENT_UNSUPPORTED =
  "CLOUD_PIN_ELECTRICAL_INTENT_UNSUPPORTED: cloud pin-intent preservation has not been verified; local intent retained";
export const CLOUD_NET_IDENTITY_UNSUPPORTED =
  "CLOUD_NET_IDENTITY_UNSUPPORTED: cloud durable net-identity preservation is unsupported; local identity retained";

export class CloudPreservationUnsupportedError extends Error {}

export function hasPinElectricalIntent(
  db: BetterSQLite3Database<Record<string, unknown>>,
  designId: string,
): boolean {
  return db.select({ id: schematicPins.id }).from(schematicPins).where(and(
    eq(schematicPins.designId, designId), isNotNull(schematicPins.electricalIntent),
  )).limit(1).get() !== undefined;
}

export function compatibilityError(
  db: BetterSQLite3Database<Record<string, unknown>>,
  designId: string,
): string | null {
  if (hasPinElectricalIntent(db, designId)) return CLOUD_PIN_INTENT_UNSUPPORTED;
  // The reviewed peer normalizes away identity state and never reconciles seeded
  // net arrays after schematic commands. Neither its version nor a net array is
  // proof of a lossless protocol. Even corrupt or empty local state must block.
  const state = db.select({ designId: netIdentityState.designId }).from(netIdentityState)
    .where(eq(netIdentityState.designId, designId)).limit(1).get();
  if (state) return CLOUD_NET_IDENTITY_UNSUPPORTED;
  const retired = db.select({ designId: netIdentityRetired.designId }).from(netIdentityRetired)
    .where(eq(netIdentityRetired.designId, designId)).limit(1).get();
  return retired ? CLOUD_NET_IDENTITY_UNSUPPORTED : null;
}

/** Refuse writes until a peer explicitly guarantees preservation of local state. */
export function assertCloudPreservesDesign(
  db: BetterSQLite3Database<Record<string, unknown>>,
  designId: string,
): void {
  const error = compatibilityError(db, designId);
  if (!error) return;
  db.update(cloudLink).set({
    failedAttempts: sql`${cloudLink.failedAttempts} + 1`,
    lastError: error,
  }).where(eq(cloudLink.designId, designId)).run();
  throw new CloudPreservationUnsupportedError(error);
}
