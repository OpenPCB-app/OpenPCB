import type { AnyEcsComponent } from "./component";
import type { EntitySnapshot } from "./entity";
import type { EcsWorld } from "./world";

export interface EntityQueryOptions<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  require?: readonly string[];
  predicate?: (snapshot: EntitySnapshot<TComponent>) => boolean;
}

export function hasRequiredComponents<TComponent extends AnyEcsComponent>(
  snapshot: EntitySnapshot<TComponent>,
  required: readonly string[],
): boolean {
  for (const type of required) {
    if (!snapshot.components.has(type)) {
      return false;
    }
  }
  return true;
}

export function queryEntities<TComponent extends AnyEcsComponent>(
  world: EcsWorld<TComponent>,
  options: EntityQueryOptions<TComponent> = {},
): EntitySnapshot<TComponent>[] {
  const require = options.require ?? [];
  const predicate = options.predicate;
  return world.snapshots().filter((snapshot) => {
    if (!hasRequiredComponents(snapshot, require)) {
      return false;
    }
    return predicate ? predicate(snapshot) : true;
  });
}

export function firstEntity<TComponent extends AnyEcsComponent>(
  world: EcsWorld<TComponent>,
  options: EntityQueryOptions<TComponent> = {},
): EntitySnapshot<TComponent> | null {
  const matches = queryEntities(world, options);
  return matches[0] ?? null;
}
