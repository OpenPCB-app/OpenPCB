export type ActionId = string; // "<verb>_<primaryKey>_<designId>"

export const ACTION_ID_DESC =
  "Stable idempotency key you generate: `<verb>_<primaryKey>_<designId>` " +
  "(e.g. `place_R1_<designId>`, `wire_U1.OUT__R1.1_<designId>`). " +
  "Re-using the same action_id is a safe no-op.";

export function isValidActionId(s: string): boolean {
  return /^[a-z]+_[^_]+.*_[A-Za-z0-9-]+$/.test(s);
}
