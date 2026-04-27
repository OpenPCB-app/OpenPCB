import type { AnyEcsComponent, SerializedComponentMap } from "../ecs/component";
import type { EntityId } from "../ecs/entity";

export interface NoopPatch {
  kind: "noop";
}

export interface EnsureEntityPatch {
  kind: "entity.ensure";
  entityId: EntityId;
}

export interface DeleteEntityPatch {
  kind: "entity.delete";
  entityId: EntityId;
}

export interface RestoreEntityPatch<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  kind: "entity.restore";
  entityId: EntityId;
  components: SerializedComponentMap<TComponent>;
}

export interface SetComponentPatch<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  kind: "component.set";
  entityId: EntityId;
  component: TComponent;
}

export interface RemoveComponentPatch {
  kind: "component.remove";
  entityId: EntityId;
  componentType: string;
}

export type EcsPatch<TComponent extends AnyEcsComponent = AnyEcsComponent> =
  | NoopPatch
  | EnsureEntityPatch
  | DeleteEntityPatch
  | RestoreEntityPatch<TComponent>
  | SetComponentPatch<TComponent>
  | RemoveComponentPatch;

export function clonePatch<TComponent extends AnyEcsComponent>(
  patch: EcsPatch<TComponent>,
): EcsPatch<TComponent> {
  if (typeof structuredClone === "function") {
    return structuredClone(patch);
  }
  return JSON.parse(JSON.stringify(patch)) as EcsPatch<TComponent>;
}

export function compactPatches<TComponent extends AnyEcsComponent>(
  patches: readonly EcsPatch<TComponent>[],
): EcsPatch<TComponent>[] {
  return patches.filter((patch) => patch.kind !== "noop");
}
