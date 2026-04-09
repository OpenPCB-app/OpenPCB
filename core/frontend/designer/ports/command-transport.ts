import type {
  CommandEnvelope,
  DesignerCommand,
} from "../../../backend/designer/contracts/commands/command-envelope";
import type { CommandResult } from "../../../backend/designer/contracts/commands/command-result";

export interface CommandTransport {
  dispatch(envelope: CommandEnvelope<DesignerCommand>): Promise<CommandResult>;
  undo(designId: string, sessionId: string): Promise<CommandResult | null>;
  redo(designId: string, sessionId: string): Promise<CommandResult | null>;
}
