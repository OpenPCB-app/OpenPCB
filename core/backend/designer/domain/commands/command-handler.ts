import type { DesignerCommand } from "../../contracts/commands/command-envelope";
import type { DesignPatch } from "../../contracts/patch";
import type { DesignWorld } from "../design-world";

export interface CommandServices {
  allocateReference(prefix: string): string;
}

export interface PlannedCommand {
  patches: DesignPatch[];
  affectedEntityIds: string[];
  topologyChanged: boolean;
}

export interface CommandHandler<T extends DesignerCommand> {
  readonly type: T["type"];
  plan(world: DesignWorld, command: T, services: CommandServices): PlannedCommand;
}
