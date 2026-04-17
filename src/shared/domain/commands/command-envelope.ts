import type { Revision } from "../revision/revision";

export interface CommandEnvelope<TCommand> {
  commandId: string;
  sessionId: string;
  aggregateId: string;
  baseRevision: Revision | null;
  issuedAt: number;
  command: TCommand;
}
