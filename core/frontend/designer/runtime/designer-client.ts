import type {
  CommandEnvelope,
  DesignerCommand,
} from "../../../backend/designer/contracts/commands/command-envelope";
import type { CommandResult } from "../../../backend/designer/contracts/commands/command-result";
import type { DesignInvalidatedEvent } from "../../../backend/designer/contracts/event";
import type { SchematicProjection } from "../../../backend/designer/contracts/projection";
import type { CommandTransport } from "../ports/command-transport";
import type { EventStream } from "../ports/event-stream";
import type { QueryTransport } from "../ports/query-transport";

export class DesignerClient {
  constructor(
    private commandTransport: CommandTransport,
    private queryTransport: QueryTransport,
    private eventStream: EventStream,
  ) {}

  dispatch(
    envelope: CommandEnvelope<DesignerCommand>,
  ): Promise<CommandResult> {
    return this.commandTransport.dispatch(envelope);
  }

  undo(designId: string, sessionId: string): Promise<CommandResult | null> {
    return this.commandTransport.undo(designId, sessionId);
  }

  redo(designId: string, sessionId: string): Promise<CommandResult | null> {
    return this.commandTransport.redo(designId, sessionId);
  }

  getSchematicProjection(designId: string): Promise<SchematicProjection | null> {
    return this.queryTransport.getSchematicProjection(designId);
  }

  subscribe(
    designId: string,
    fromRevision: number | undefined,
    handler: (event: DesignInvalidatedEvent) => void,
  ): () => void {
    return this.eventStream.subscribe(designId, fromRevision, handler);
  }
}
