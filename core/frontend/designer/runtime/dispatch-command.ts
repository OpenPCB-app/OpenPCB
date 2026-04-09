import type {
  CommandEnvelope,
  DesignerCommand,
} from "../../../backend/designer/contracts/commands/command-envelope";
import type { CommandResult } from "../../../backend/designer/contracts/commands/command-result";
import type { CommandTransport } from "../ports/command-transport";
import type { PendingCommandState } from "../state/pending-command.state";

export async function dispatchCommand(
  transport: CommandTransport,
  pending: PendingCommandState,
  envelope: CommandEnvelope<DesignerCommand>,
): Promise<CommandResult> {
  pending.byCommandId = new Map(pending.byCommandId).set(envelope.commandId, {
    commandId: envelope.commandId,
    designId: envelope.designId,
    issuedAt: envelope.issuedAt,
    operation: "dispatch",
    envelope,
  });
  try {
    return await transport.dispatch(envelope);
  } finally {
    const next = new Map(pending.byCommandId);
    next.delete(envelope.commandId);
    pending.byCommandId = next;
  }
}
