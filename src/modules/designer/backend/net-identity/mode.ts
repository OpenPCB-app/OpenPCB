import { readNetIdentityState, type NetIdentityDb } from "./state-store";
import { NetIdentityStateInvalidError, type NetIdentityState } from "./types";

export interface IdentityMode {
  mode: "durable" | "legacy";
  state: NetIdentityState | null;
  unavailable?: string;
}

export function resolveIdentityMode(tx: NetIdentityDb, designId: string): IdentityMode {
  try {
    const state = readNetIdentityState(tx, designId);
    return { mode: state?.status === "active" ? "durable" : "legacy", state };
  } catch (error) {
    if (!(error instanceof NetIdentityStateInvalidError)) throw error;
    return { mode: "legacy", state: null, unavailable: error.message };
  }
}
