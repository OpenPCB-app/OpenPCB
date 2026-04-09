import type { DeleteEntitiesCommand } from "../../../contracts/commands/delete-entities.command";
import { ValidationError } from "../../../contracts/errors";
import { getPartPinWorldPosition } from "../../entity-selectors";
import type { CommandHandler, PlannedCommand } from "../command-handler";
import type { DesignWorld } from "../../design-world";

export class DeleteEntitiesHandler implements CommandHandler<DeleteEntitiesCommand> {
  readonly type = "delete_entities" as const;

  plan(
    world: DesignWorld,
    command: DeleteEntitiesCommand,
    _services: import("../command-handler").CommandServices,
  ): PlannedCommand {
    const affected = new Set<string>();
    const deleteSet = new Set(command.entityIds);

    for (const entityId of deleteSet) {
      const entity = world.entities.get(entityId);
      if (entity?.kind === "sheet") {
        throw new ValidationError("Deleting sheet entities is not supported");
      }
    }

    const patches = command.entityIds
      .filter((entityId) => world.entities.has(entityId))
      .map((entityId) => {
        affected.add(entityId);
        return {
          op: "delete_entity" as const,
          entityId,
        };
      });

    for (const entity of world.entities.values()) {
      if (entity.kind !== "wire") {
        continue;
      }

      const hints = entity.components.wire_end_hints;
      if (!hints) {
        continue;
      }

      const geometry = entity.components.wire_geometry;
      const sheetId = entity.components.sheet_ref?.sheetId;
      if (!geometry || geometry.pointsNm.length < 2 || !sheetId) {
        continue;
      }

      const firstPoint = geometry.pointsNm[0]!;
      const lastPoint = geometry.pointsNm[geometry.pointsNm.length - 1]!;
      const startAttached =
        hints.startPinRef &&
        deleteSet.has(hints.startPinRef.partInstanceId) &&
        (() => {
          const position = getPartPinWorldPosition(world, sheetId, hints.startPinRef!);
          return position.xNm === firstPoint.xNm && position.yNm === firstPoint.yNm;
        })();
      const endAttached =
        hints.endPinRef &&
        deleteSet.has(hints.endPinRef.partInstanceId) &&
        (() => {
          const position = getPartPinWorldPosition(world, sheetId, hints.endPinRef!);
          return position.xNm === lastPoint.xNm && position.yNm === lastPoint.yNm;
        })();

      if (startAttached || endAttached) {
        patches.push({ op: "delete_entity" as const, entityId: entity.id });
        affected.add(entity.id);
      }
    }

    return {
      patches,
      affectedEntityIds: [...affected],
      topologyChanged: true,
    };
  }
}
