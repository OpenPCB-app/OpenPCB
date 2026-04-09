import type { ComponentKind } from "../../contracts/component-kind";
import type { ComponentTypeMap } from "../../contracts/component-map";
import { NotFoundError } from "../../contracts/errors";
import type { DesignPatch } from "../../contracts/patch";
import type { DesignWorld } from "../design-world";

function asComponent<K extends ComponentKind>(
  value: unknown,
): ComponentTypeMap[K] {
  return value as ComponentTypeMap[K];
}

export function applyPatches(world: DesignWorld, patches: DesignPatch[]): void {
  for (const patch of patches) {
    if (patch.op === "upsert_entity") {
      world.entities.set(patch.entity.id, structuredClone(patch.entity));
      continue;
    }

    if (patch.op === "delete_entity") {
      world.entities.delete(patch.entityId);
      continue;
    }

    if (patch.op === "set_component") {
      const entity = world.entities.get(patch.entityId);
      if (!entity) {
        throw new NotFoundError(`Entity not found: ${patch.entityId}`);
      }
      (entity.components as Record<string, unknown>)[patch.component] =
        asComponent(patch.value);
      entity.updatedRevision = world.head.revision;
      continue;
    }

    if (patch.op === "remove_component") {
      const entity = world.entities.get(patch.entityId);
      if (!entity) {
        throw new NotFoundError(`Entity not found: ${patch.entityId}`);
      }
      delete entity.components[patch.component];
      entity.updatedRevision = world.head.revision;
      continue;
    }

    if (patch.op === "replace_net_members") {
      world.netMembers = structuredClone(patch.members);
      continue;
    }

    world.head = {
      designId: patch.designId,
      revision: patch.revision,
      nextAutoNetOrdinals: structuredClone(patch.nextAutoNetOrdinals),
      referenceCounters: structuredClone(patch.referenceCounters),
    };
  }
}
