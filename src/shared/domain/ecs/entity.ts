import type { AnyEcsComponent } from "./component";

declare const entityIdBrand: unique symbol;
export type EntityId = string & { readonly [entityIdBrand]: true };

export interface EntitySnapshot<TComponent extends AnyEcsComponent = AnyEcsComponent> {
  id: EntityId;
  components: ReadonlyMap<string, TComponent>;
}

export function asEntityId(value: string): EntityId {
  return value as EntityId;
}

export function createEntityId(prefix = "ent"): EntityId {
  return `${prefix}_${crypto.randomUUID()}` as EntityId;
}
