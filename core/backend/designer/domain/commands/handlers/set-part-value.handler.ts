import type { SetPartValueCommand } from "../../../contracts/commands/set-part-value.command";
import { NotFoundError, ValidationError } from "../../../contracts/errors";
import type { CommandHandler, PlannedCommand } from "../command-handler";
import type { DesignWorld } from "../../design-world";

export class SetPartValueHandler implements CommandHandler<SetPartValueCommand> {
  readonly type = "set_part_value" as const;

  plan(
    world: DesignWorld,
    command: SetPartValueCommand,
    _services: import("../command-handler").CommandServices,
  ): PlannedCommand {
    const entity = world.entities.get(command.partInstanceId);
    if (!entity) {
      throw new NotFoundError(`Entity not found: ${command.partInstanceId}`);
    }

    if (entity.kind !== "part_instance") {
      throw new ValidationError(`Entity ${command.partInstanceId} is not part_instance`);
    }

    const fields = entity.components.instance_fields;
    if (!fields) {
      throw new ValidationError(`Entity ${command.partInstanceId} missing instance_fields`);
    }

    return {
      patches: [
        {
          op: "set_component",
          entityId: command.partInstanceId,
          component: "instance_fields",
          value: {
            ...fields,
            value: command.value,
          },
        },
      ],
      affectedEntityIds: [command.partInstanceId],
      topologyChanged: false,
    };
  }
}
