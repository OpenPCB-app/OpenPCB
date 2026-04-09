import type { SchematicProjection } from "../../contracts/projection";
import type { DesignWorld } from "../design-world";

export function buildSchematicProjection(world: DesignWorld): SchematicProjection {
  const sheets = [...world.entities.values()]
    .filter((entity) => entity.kind === "sheet")
    .map((entity) => ({
      id: entity.id,
      title: entity.components.sheet_meta?.title ?? "Sheet",
      index: entity.components.sheet_meta?.index ?? 0,
    }))
    .sort((a, b) => a.index - b.index);

  const parts = [...world.entities.values()]
    .filter((entity) => entity.kind === "part_instance")
    .map((entity) => {
      const sheetRef = entity.components.sheet_ref!;
      const transform = entity.components.transform_2d!;
      const originRef = entity.components.part_origin_ref!;
      const instanceFields = entity.components.instance_fields!;
      const snapshot = entity.components.symbol_snapshot!;
      return {
        id: entity.id,
        sheetId: sheetRef.sheetId,
        componentId: originRef.componentId,
        variantId: originRef.variantId,
        reference: instanceFields.reference,
        value: instanceFields.value,
        position: { xNm: transform.xNm, yNm: transform.yNm },
        rotationDeg: transform.rotationDeg,
        mirrored: transform.mirrored,
        symbolKind: snapshot.symbolKind,
      };
    });

  const wires = [...world.entities.values()]
    .filter((entity) => entity.kind === "wire")
    .map((entity) => ({
      id: entity.id,
      sheetId: entity.components.sheet_ref!.sheetId,
      pointsNm: entity.components.wire_geometry!.pointsNm,
      netId: entity.components.wire_net_ref?.netId,
    }));

  const nets = [...world.entities.values()]
    .filter((entity) => entity.kind === "net")
    .map((entity) => ({
      id: entity.id,
      sheetId: entity.components.sheet_ref!.sheetId,
      name: entity.components.net_meta!.stableName,
    }));

  return {
    designId: world.head.designId,
    revision: world.head.revision,
    sheets,
    parts,
    wires,
    nets,
  };
}
