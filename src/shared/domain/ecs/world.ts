import {
  type AnyEcsComponent,
  type ComponentType,
  cloneComponent,
  componentMapToRecord,
  recordToComponentEntries,
  type SerializedComponentMap,
} from "./component";
import type { EntityId, EntitySnapshot } from "./entity";

export class EcsWorld<TComponent extends AnyEcsComponent = AnyEcsComponent> {
  private readonly entities = new Map<EntityId, Map<string, TComponent>>();

  get size(): number {
    return this.entities.size;
  }

  entityIds(): EntityId[] {
    return [...this.entities.keys()];
  }

  hasEntity(entityId: EntityId): boolean {
    return this.entities.has(entityId);
  }

  ensureEntity(entityId: EntityId): boolean {
    if (this.entities.has(entityId)) {
      return false;
    }
    this.entities.set(entityId, new Map());
    return true;
  }

  deleteEntity(entityId: EntityId): EntitySnapshot<TComponent> | null {
    const componentMap = this.entities.get(entityId);
    if (!componentMap) {
      return null;
    }
    const snapshot = this.buildSnapshot(entityId, componentMap);
    this.entities.delete(entityId);
    return snapshot;
  }

  restoreEntity(
    entityId: EntityId,
    components: SerializedComponentMap<TComponent>,
  ): EntitySnapshot<TComponent> | null {
    const previous = this.snapshotEntity(entityId);
    this.entities.set(entityId, new Map(recordToComponentEntries(components)));
    return previous;
  }

  snapshotEntity(entityId: EntityId): EntitySnapshot<TComponent> | null {
    const componentMap = this.entities.get(entityId);
    if (!componentMap) {
      return null;
    }
    return this.buildSnapshot(entityId, componentMap);
  }

  getComponent<TType extends ComponentType<TComponent>>(
    entityId: EntityId,
    type: TType,
  ): Extract<TComponent, { type: TType }> | null {
    const componentMap = this.entities.get(entityId);
    const component = componentMap?.get(type);
    if (!component) {
      return null;
    }
    return cloneComponent(component) as Extract<TComponent, { type: TType }>;
  }

  setComponent<TType extends ComponentType<TComponent>>(
    entityId: EntityId,
    component: Extract<TComponent, { type: TType }>,
  ): Extract<TComponent, { type: TType }> | null {
    const componentMap = this.ensureComponentMap(entityId);
    const previous = componentMap.get(component.type);
    componentMap.set(component.type, cloneComponent(component));
    return previous
      ? (cloneComponent(previous) as Extract<TComponent, { type: TType }>)
      : null;
  }

  removeComponent<TType extends ComponentType<TComponent>>(
    entityId: EntityId,
    type: TType,
  ): Extract<TComponent, { type: TType }> | null {
    const componentMap = this.entities.get(entityId);
    if (!componentMap) {
      return null;
    }
    const previous = componentMap.get(type);
    if (!previous) {
      return null;
    }
    componentMap.delete(type);
    if (componentMap.size === 0) {
      this.entities.delete(entityId);
    }
    return cloneComponent(previous) as Extract<TComponent, { type: TType }>;
  }

  componentsForEntity(entityId: EntityId): ReadonlyMap<string, TComponent> | null {
    const componentMap = this.entities.get(entityId);
    if (!componentMap) {
      return null;
    }
    return new Map(recordToComponentEntries(componentMapToRecord(componentMap)));
  }

  snapshots(): EntitySnapshot<TComponent>[] {
    return this.entityIds()
      .map((entityId) => this.snapshotEntity(entityId))
      .filter((snapshot): snapshot is EntitySnapshot<TComponent> => snapshot !== null);
  }

  private ensureComponentMap(entityId: EntityId): Map<string, TComponent> {
    const existing = this.entities.get(entityId);
    if (existing) {
      return existing;
    }
    const created = new Map<string, TComponent>();
    this.entities.set(entityId, created);
    return created;
  }

  private buildSnapshot(
    entityId: EntityId,
    componentMap: ReadonlyMap<string, TComponent>,
  ): EntitySnapshot<TComponent> {
    const cloned = new Map(recordToComponentEntries(componentMapToRecord(componentMap)));
    return {
      id: entityId,
      components: cloned,
    };
  }
}
