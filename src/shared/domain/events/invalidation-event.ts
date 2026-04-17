import type { Revision } from "../revision/revision";

export interface AggregateInvalidatedEvent {
  aggregateId: string;
  revision: Revision;
  at: number;
}
