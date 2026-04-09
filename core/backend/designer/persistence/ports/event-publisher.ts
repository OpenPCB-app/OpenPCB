import type { DesignInvalidatedEvent } from "../../contracts/event";

export interface EventPublisher {
  publish(event: DesignInvalidatedEvent): Promise<void>;
}
