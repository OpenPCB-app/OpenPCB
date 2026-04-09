import type {
  CommandEnvelope,
  DesignerCommand,
} from "../../../backend/designer/contracts/commands/command-envelope";
import type { CommandResult } from "../../../backend/designer/contracts/commands/command-result";
import type { DesignInvalidatedEvent } from "../../../backend/designer/contracts/event";
import type { SchematicProjection } from "../../../backend/designer/contracts/projection";
import type { DispatchCommandUsecase } from "../../../backend/designer/application/dispatch-command.usecase";
import type { GetSchematicProjectionUsecase } from "../../../backend/designer/application/get-schematic-projection.usecase";
import type { RedoUsecase } from "../../../backend/designer/application/redo.usecase";
import type { UndoUsecase } from "../../../backend/designer/application/undo.usecase";
import type { InMemoryEventPublisher } from "../../../backend/designer/persistence/memory/in-memory-event-publisher";
import type { CommandTransport } from "../ports/command-transport";
import type { EventStream } from "../ports/event-stream";
import type { QueryTransport } from "../ports/query-transport";

export class InMemoryCommandTransport implements CommandTransport {
  constructor(
    private dispatchUsecase: DispatchCommandUsecase,
    private undoUsecase: UndoUsecase,
    private redoUsecase: RedoUsecase,
  ) {}

  dispatch(envelope: CommandEnvelope<DesignerCommand>): Promise<CommandResult> {
    return this.dispatchUsecase.execute(envelope);
  }

  undo(designId: string, sessionId: string): Promise<CommandResult | null> {
    return this.undoUsecase.execute(designId, sessionId);
  }

  redo(designId: string, sessionId: string): Promise<CommandResult | null> {
    return this.redoUsecase.execute(designId, sessionId);
  }
}

export class InMemoryQueryTransport implements QueryTransport {
  constructor(private projectionUsecase: GetSchematicProjectionUsecase) {}

  getSchematicProjection(designId: string): Promise<SchematicProjection | null> {
    return this.projectionUsecase.execute(designId);
  }
}

export class InMemoryEventStream implements EventStream {
  constructor(private publisher: InMemoryEventPublisher) {}

  subscribe(
    designId: string,
    fromRevision: number | undefined,
    handler: (event: DesignInvalidatedEvent) => void,
  ): () => void {
    for (const event of this.publisher.events) {
      if (
        event.designId === designId &&
        (fromRevision === undefined || event.revision > fromRevision)
      ) {
        handler(structuredClone(event));
      }
    }

    return this.publisher.subscribe((event) => {
      if (
        event.designId === designId &&
        (fromRevision === undefined || event.revision > fromRevision)
      ) {
        handler(structuredClone(event));
      }
    });
  }
}
