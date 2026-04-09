import type { DesignInvalidatedEvent } from "../../../backend/designer/contracts/event";

export interface EventStream {
  subscribe(
    designId: string,
    fromRevision: number | undefined,
    handler: (event: DesignInvalidatedEvent) => void,
  ): () => void;
}
