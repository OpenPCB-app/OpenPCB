import type { DesignInvalidatedEvent } from "../../contracts/event";
import type { EventPublisher } from "../ports/event-publisher";

export class InMemoryEventPublisher implements EventPublisher {
  public readonly events: DesignInvalidatedEvent[] = [];
  private listeners = new Set<(event: DesignInvalidatedEvent) => void>();

  async publish(event: DesignInvalidatedEvent): Promise<void> {
    const cloned = structuredClone(event);
    this.events.push(cloned);
    for (const listener of this.listeners) {
      listener(structuredClone(cloned));
    }
  }

  subscribe(listener: (event: DesignInvalidatedEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
