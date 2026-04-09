import type { DesignPatch } from "../../contracts/patch";
import type { DesignWorld } from "../design-world";

export function invertPatches(world: DesignWorld, patches: DesignPatch[]): DesignPatch[] {
  const inverse: DesignPatch[] = [];

  for (let i = patches.length - 1; i >= 0; i--) {
    const patch = patches[i]!;

    if (patch.op === "upsert_entity") {
      const existing = world.entities.get(patch.entity.id);
      if (existing) {
        inverse.push({ op: "upsert_entity", entity: structuredClone(existing) });
      } else {
        inverse.push({ op: "delete_entity", entityId: patch.entity.id });
      }
      continue;
    }

    if (patch.op === "delete_entity") {
      const existing = world.entities.get(patch.entityId);
      if (existing) {
        inverse.push({ op: "upsert_entity", entity: structuredClone(existing) });
      }
      continue;
    }

    if (patch.op === "set_component") {
      const entity = world.entities.get(patch.entityId);
      const prev = entity?.components[patch.component];
      if (prev === undefined) {
        inverse.push({
          op: "remove_component",
          entityId: patch.entityId,
          component: patch.component,
        });
      } else {
        inverse.push({
          op: "set_component",
          entityId: patch.entityId,
          component: patch.component,
          value: structuredClone(prev),
        });
      }
      continue;
    }

    if (patch.op === "remove_component") {
      const entity = world.entities.get(patch.entityId);
      const prev = entity?.components[patch.component];
      if (prev !== undefined) {
        inverse.push({
          op: "set_component",
          entityId: patch.entityId,
          component: patch.component,
          value: structuredClone(prev),
        });
      }
      continue;
    }

    if (patch.op === "replace_net_members") {
      inverse.push({
        op: "replace_net_members",
        designId: patch.designId,
        members: structuredClone(world.netMembers),
      });
      continue;
    }

    inverse.push({
      op: "set_design_head",
      designId: patch.designId,
      revision: world.head.revision,
      nextAutoNetOrdinals: structuredClone(world.head.nextAutoNetOrdinals),
      referenceCounters: structuredClone(world.head.referenceCounters),
    });
  }

  return inverse;
}
