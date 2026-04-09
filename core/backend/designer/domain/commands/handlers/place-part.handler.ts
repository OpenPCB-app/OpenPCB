import type { PlacePartCommand } from "../../../contracts/commands/place-part.command";
import type { DesignEntity } from "../../../contracts/entity";
import { ValidationError } from "../../../contracts/errors";
import type { DesignWorld } from "../../design-world";
import { requireSheetEntity } from "../../entity-selectors";
import { assertFiniteNm, assertRotation } from "../../invariants";
import type {
  CommandHandler,
  CommandServices,
  PlannedCommand,
} from "../command-handler";

export class PlacePartHandler implements CommandHandler<PlacePartCommand> {
  readonly type = "place_part" as const;

  plan(
    world: DesignWorld,
    command: PlacePartCommand,
    services: CommandServices,
  ): PlannedCommand {
    if (world.entities.has(command.partInstanceId)) {
      throw new ValidationError(`Entity already exists: ${command.partInstanceId}`);
    }

    requireSheetEntity(world, command.sheetId);
    assertFiniteNm(command.xNm, "place_part.xNm");
    assertFiniteNm(command.yNm, "place_part.yNm");
    assertRotation(command.rotationDeg);

    const reference =
      command.reference ?? services.allocateReference(command.symbolSnapshot.referencePrefix || "U");

    const duplicateReference = [...world.entities.values()].some(
      (entity) =>
        entity.kind === "part_instance" &&
        entity.components.instance_fields?.reference === reference,
    );
    if (duplicateReference) {
      throw new ValidationError(`Duplicate part reference: ${reference}`);
    }

    const pinKeys = new Set<string>();
    for (const pin of command.symbolSnapshot.pins) {
      if (pinKeys.has(pin.originPinKey)) {
        throw new ValidationError(`Duplicate symbol snapshot pin key: ${pin.originPinKey}`);
      }
      pinKeys.add(pin.originPinKey);
    }

    const entity: DesignEntity = {
      id: command.partInstanceId,
      designId: world.head.designId,
      kind: "part_instance",
      createdRevision: world.head.revision,
      updatedRevision: world.head.revision,
      components: {
        sheet_ref: { sheetId: command.sheetId },
        transform_2d: {
          xNm: command.xNm,
          yNm: command.yNm,
          rotationDeg: command.rotationDeg,
          mirrored: command.mirrored,
        },
        part_origin_ref: command.originRef,
        symbol_snapshot: command.symbolSnapshot,
        footprint_snapshot: command.footprintSnapshot,
        instance_fields: {
          reference,
          value: command.value ?? "",
          properties: command.properties ?? {},
        },
      },
    };

    return {
      patches: [{ op: "upsert_entity", entity }],
      affectedEntityIds: [command.partInstanceId],
      topologyChanged: true,
    };
  }
}
