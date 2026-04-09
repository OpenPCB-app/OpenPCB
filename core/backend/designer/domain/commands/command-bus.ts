import type {
  CommandEnvelope,
  DesignerCommand,
} from "../../contracts/commands/command-envelope";
import type { CommandServices, PlannedCommand } from "./command-handler";
import { CommandRegistry } from "./command-registry";
import type { DesignWorld } from "../design-world";

export class CommandBus {
  constructor(private registry: CommandRegistry) {}

  execute(
    world: DesignWorld,
    envelope: CommandEnvelope<DesignerCommand>,
    services: CommandServices,
  ): PlannedCommand {
    const handler = this.registry.get(envelope.command.type);
    return handler.plan(
      world,
      envelope.command as never,
      services,
    );
  }
}
