import type { CreateWireCommand } from "../../../contracts/commands/create-wire.command";
import type { DesignEntity } from "../../../contracts/entity";
import { ValidationError } from "../../../contracts/errors";
import {
  assertPinRefExistsOnSheet,
  getPartPinWorldPosition,
  requireSheetEntity,
} from "../../entity-selectors";
import { assertFiniteNm } from "../../invariants";
import { normalizeWirePoints } from "../../systems/wire-normalizer";
import type { CommandHandler, PlannedCommand } from "../command-handler";
import type { DesignWorld } from "../../design-world";

export class CreateWireHandler implements CommandHandler<CreateWireCommand> {
  readonly type = "create_wire" as const;

  plan(
    world: DesignWorld,
    command: CreateWireCommand,
    _services: import("../command-handler").CommandServices,
  ): PlannedCommand {
    if (world.entities.has(command.wireId)) {
      throw new ValidationError(`Entity already exists: ${command.wireId}`);
    }

    requireSheetEntity(world, command.sheetId);
    for (let i = 0; i < command.pointsNm.length; i++) {
      const point = command.pointsNm[i]!;
      assertFiniteNm(point.xNm, `create_wire.pointsNm[${i}].xNm`);
      assertFiniteNm(point.yNm, `create_wire.pointsNm[${i}].yNm`);
    }
    if (command.startPinRef) {
      assertPinRefExistsOnSheet(world, command.sheetId, command.startPinRef);
    }
    if (command.endPinRef) {
      assertPinRefExistsOnSheet(world, command.sheetId, command.endPinRef);
    }

    const pointsNm = normalizeWirePoints(command.pointsNm);
    if (pointsNm.length < 2) {
      throw new ValidationError("Wire must have at least 2 points after normalization");
    }

    const firstPoint = pointsNm[0]!;
    const lastPoint = pointsNm[pointsNm.length - 1]!;

    if (command.startPinRef) {
      const expected = getPartPinWorldPosition(world, command.sheetId, command.startPinRef);
      if (expected.xNm !== firstPoint.xNm || expected.yNm !== firstPoint.yNm) {
        throw new ValidationError("create_wire startPinRef must match first wire point");
      }
    }

    if (command.endPinRef) {
      const expected = getPartPinWorldPosition(world, command.sheetId, command.endPinRef);
      if (expected.xNm !== lastPoint.xNm || expected.yNm !== lastPoint.yNm) {
        throw new ValidationError("create_wire endPinRef must match last wire point");
      }
    }

    const wireEntity: DesignEntity = {
      id: command.wireId,
      designId: world.head.designId,
      kind: "wire",
      createdRevision: world.head.revision,
      updatedRevision: world.head.revision,
      components: {
        sheet_ref: { sheetId: command.sheetId },
        wire_geometry: { pointsNm },
        wire_end_hints: {
          startPinRef: command.startPinRef,
          endPinRef: command.endPinRef,
        },
      },
    };

    return {
      patches: [{ op: "upsert_entity", entity: wireEntity }],
      affectedEntityIds: [wireEntity.id],
      topologyChanged: true,
    };
  }
}
