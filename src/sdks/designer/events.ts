import type { AggregateInvalidatedEvent } from "../../shared/domain/events/invalidation-event";

export interface DesignerInvalidatedEvent extends AggregateInvalidatedEvent {
  moduleId: "designer";
}
