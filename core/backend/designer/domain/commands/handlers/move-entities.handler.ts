import type { MoveEntitiesCommand } from "../../../contracts/commands/move-entities.command";
import { NotFoundError, ValidationError } from "../../../contracts/errors";
import type { DesignPatch } from "../../../contracts/patch";
import type { CommandHandler, PlannedCommand } from "../command-handler";
import type { DesignWorld } from "../../design-world";
import { assertFiniteNm } from "../../invariants";

export class MoveEntitiesHandler implements CommandHandler<MoveEntitiesCommand> {
  readonly type = "move_entities" as const;

  plan(
    world: DesignWorld,
    command: MoveEntitiesCommand,
    _services: import("../command-handler").CommandServices,
  ): PlannedCommand {
    if (command.entityIds.length === 0) {
      throw new ValidationError("entityIds cannot be empty");
    }

    assertFiniteNm(command.deltaXNm, "move_entities.deltaXNm");
    assertFiniteNm(command.deltaYNm, "move_entities.deltaYNm");

    const patches: DesignPatch[] = [];
    for (const entityId of command.entityIds) {
      const entity = world.entities.get(entityId);
      if (!entity) {
        throw new NotFoundError(`Entity not found: ${entityId}`);
      }

      if (entity.kind === "part_instance") {
        const transform = entity.components.transform_2d;
        if (!transform) {
          throw new ValidationError(`Entity ${entityId} missing transform_2d`);
        }
        patches.push({
          op: "set_component",
          entityId,
          component: "transform_2d",
          value: {
            ...transform,
            xNm: transform.xNm + command.deltaXNm,
            yNm: transform.yNm + command.deltaYNm,
          },
        });
        continue;
      }

      if (entity.kind === "wire") {
        const geometry = entity.components.wire_geometry;
        if (!geometry) {
          throw new ValidationError(`Wire ${entityId} missing wire_geometry`);
        }
        patches.push({
          op: "set_component",
          entityId,
          component: "wire_geometry",
          value: {
            pointsNm: geometry.pointsNm.map((point) => ({
              xNm: point.xNm + command.deltaXNm,
              yNm: point.yNm + command.deltaYNm,
            })),
          },
        });
      }
    }

    return {
      patches,
      affectedEntityIds: [...command.entityIds],
      topologyChanged: true,
    };
  }
}
