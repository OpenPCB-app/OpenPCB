import {
  componentMapToRecord,
  type AnyEcsComponent,
} from "../ecs/component";
import type { EcsWorld } from "../ecs/world";
import {
  clonePatch,
  compactPatches,
  type EcsPatch,
  type RestoreEntityPatch,
  type SetComponentPatch,
} from "./patch";

export interface AppliedPatch<TComponent extends AnyEcsComponent = AnyEcsComponent> {
  patch: EcsPatch<TComponent>;
  inversePatches: EcsPatch<TComponent>[];
  changed: boolean;
}

export interface AppliedPatchBatch<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  applied: AppliedPatch<TComponent>[];
  inversePatches: EcsPatch<TComponent>[];
}

export function applyPatch<TComponent extends AnyEcsComponent>(
  world: EcsWorld<TComponent>,
  patch: EcsPatch<TComponent>,
): AppliedPatch<TComponent> {
  switch (patch.kind) {
    case "noop":
      return {
        patch,
        inversePatches: [clonePatch(patch)],
        changed: false,
      };
    case "entity.ensure": {
      const created = world.ensureEntity(patch.entityId);
      return {
        patch,
        inversePatches: created ? [{ kind: "entity.delete", entityId: patch.entityId }] : [],
        changed: created,
      };
    }
    case "entity.delete": {
      const removed = world.deleteEntity(patch.entityId);
      if (!removed) {
        return {
          patch,
          inversePatches: [],
          changed: false,
        };
      }
      const inverse: RestoreEntityPatch<TComponent> = {
        kind: "entity.restore",
        entityId: patch.entityId,
        components: componentMapToRecord(removed.components),
      };
      return {
        patch,
        inversePatches: [inverse],
        changed: true,
      };
    }
    case "entity.restore": {
      const previous = world.restoreEntity(patch.entityId, patch.components);
      if (!previous) {
        return {
          patch,
          inversePatches: [{ kind: "entity.delete", entityId: patch.entityId }],
          changed: true,
        };
      }
      const inverse: RestoreEntityPatch<TComponent> = {
        kind: "entity.restore",
        entityId: patch.entityId,
        components: componentMapToRecord(previous.components),
      };
      return {
        patch,
        inversePatches: [inverse],
        changed: true,
      };
    }
    case "component.set": {
      const existed = world.hasEntity(patch.entityId);
      const previous = world.setComponent(
        patch.entityId,
        patch.component as Extract<TComponent, { type: TComponent["type"] }>,
      );
      const inversePatches = previous
        ? ([
            {
              kind: "component.set",
              entityId: patch.entityId,
              component: previous,
            },
          ] satisfies SetComponentPatch<TComponent>[])
        : [
            {
              kind: "component.remove",
              entityId: patch.entityId,
              componentType: patch.component.type,
            } satisfies EcsPatch<TComponent>,
          ];
      const changed = !previous || JSON.stringify(previous) !== JSON.stringify(patch.component);
      if (!existed && !changed) {
        return {
          patch,
          inversePatches: [],
          changed: false,
        };
      }
      return {
        patch,
        inversePatches,
        changed,
      };
    }
    case "component.remove": {
      const previous = world.removeComponent(patch.entityId, patch.componentType);
      if (!previous) {
        return {
          patch,
          inversePatches: [],
          changed: false,
        };
      }
      return {
        patch,
        inversePatches: [
          {
            kind: "component.set",
            entityId: patch.entityId,
            component: previous,
          },
        ],
        changed: true,
      };
    }
  }
}

export function applyPatches<TComponent extends AnyEcsComponent>(
  world: EcsWorld<TComponent>,
  patches: readonly EcsPatch<TComponent>[],
): AppliedPatchBatch<TComponent> {
  const applied: AppliedPatch<TComponent>[] = [];
  const inverse: EcsPatch<TComponent>[] = [];

  for (const patch of patches) {
    const result = applyPatch(world, clonePatch(patch));
    applied.push(result);
    const compacted = compactPatches(result.inversePatches);
    inverse.unshift(...compacted);
  }

  return {
    applied,
    inversePatches: inverse,
  };
}
