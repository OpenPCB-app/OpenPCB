import type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";
import { asRecord } from "../value-guards";

const COUNTS = ["traces", "vias", "zones", "freePads", "assignments", "lengthGroups", "diffPairs", "drcRules"] as const;
const ARRAYS = ["removedRules", "removedDiffPairs", "removedLengthGroups", "disabledZones"] as const;

/** A partial receipt cannot stand in for the operation that actually committed. */
export function parseNetRebindReceipt(value: unknown): NetRebindReceipt | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const counts = {} as Pick<NetRebindReceipt, typeof COUNTS[number]>;
  for (const key of COUNTS) {
    const count = raw[key];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
    counts[key] = count;
  }
  const arrays = {} as Pick<NetRebindReceipt, typeof ARRAYS[number]>;
  for (const key of ARRAYS) {
    const values: unknown = raw[key];
    if (!Array.isArray(values) || Object.keys(values).length !== values.length ||
      !values.every((id) => typeof id === "string" && id.trim().length > 0) || new Set(values).size !== values.length) return null;
    arrays[key] = [...values] as string[];
  }
  if (arrays.removedRules.length > counts.drcRules || arrays.removedDiffPairs.length > counts.diffPairs ||
    arrays.removedLengthGroups.length > counts.lengthGroups || arrays.disabledZones.length > counts.zones) return null;
  return { ...counts, ...arrays };
}
