import type { CommandEnvelope } from "../../../backend/designer/contracts/commands/command-envelope";

export interface PendingCommandEntry {
  commandId: string;
  designId?: string;
  issuedAt: number;
  operation: "dispatch" | "undo" | "redo";
  envelope?: CommandEnvelope;
}

export interface PendingCommandState {
  byCommandId: Map<string, PendingCommandEntry>;
}

export function createInitialPendingCommandState(): PendingCommandState {
  return {
    byCommandId: new Map(),
  };
}
