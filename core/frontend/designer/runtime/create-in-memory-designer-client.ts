import { createInMemoryDesignerFoundation } from "../../../backend/designer/application/create-in-memory-foundation";
import { DesignerClient } from "./designer-client";
import {
  InMemoryCommandTransport,
  InMemoryEventStream,
  InMemoryQueryTransport,
} from "./in-memory-transports";

export function createInMemoryDesignerClient(): DesignerClient {
  const foundation = createInMemoryDesignerFoundation();
  return new DesignerClient(
    new InMemoryCommandTransport(
      foundation.dispatchCommand,
      foundation.undo,
      foundation.redo,
    ),
    new InMemoryQueryTransport(foundation.getSchematicProjection),
    new InMemoryEventStream(foundation.eventPublisher),
  );
}
