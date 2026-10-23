import type { NetIdentityBackupSnapshot } from "./backup";
import { designNetSalt, seqOf } from "./types";
import { requireValid, safeInteger } from "./validation";

function decodeObjectJson(value: string): unknown {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Parse-loss diagnostics belong to the migration coordinator; raw data stays opaque here.
    return undefined;
  }
}

/** Reserve observed IDs without treating a raw historical reference as identity evidence. */
export function legacyBackupSequenceWatermark(
  snapshot: NetIdentityBackupSnapshot, minimum: number,
): number {
  safeInteger(minimum, "minimum", 1);
  const prefix = `net:${designNetSalt(snapshot.designId)}:`;
  const pending: unknown[] = [snapshot], visited = new WeakSet<object>();
  let watermark = minimum;
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      const seq = value.startsWith(prefix) ? seqOf(value) : null;
      if (seq !== null) {
        requireValid(seq < Number.MAX_SAFE_INTEGER, "backup.nextSeq", "durable sequence exhausted");
        watermark = Math.max(watermark, seq + 1);
      }
      const decoded = decodeObjectJson(value);
      if (decoded !== undefined) pending.push(decoded);
    } else if (value !== null && typeof value === "object" && !visited.has(value)) {
      visited.add(value);
      for (const [key, entry] of Object.entries(value)) pending.push(key, entry);
    }
  }
  return watermark;
}
