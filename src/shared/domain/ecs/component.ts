export interface EcsComponent<TType extends string = string> {
  type: TType;
}

export type AnyEcsComponent = EcsComponent<string> & Record<string, unknown>;

export type ComponentType<TComponent extends AnyEcsComponent = AnyEcsComponent> =
  TComponent["type"];

export type SerializedComponentMap<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> = Record<string, TComponent>;

export function cloneComponent<TComponent extends AnyEcsComponent>(
  component: TComponent,
): TComponent {
  if (typeof structuredClone === "function") {
    return structuredClone(component);
  }
  return JSON.parse(JSON.stringify(component)) as TComponent;
}

export function componentMapToRecord<TComponent extends AnyEcsComponent>(
  componentMap: ReadonlyMap<string, TComponent>,
): SerializedComponentMap<TComponent> {
  const record: SerializedComponentMap<TComponent> = {};
  for (const [type, component] of componentMap.entries()) {
    record[type] = cloneComponent(component);
  }
  return record;
}

export function recordToComponentEntries<TComponent extends AnyEcsComponent>(
  record: SerializedComponentMap<TComponent>,
): Array<[string, TComponent]> {
  const entries: Array<[string, TComponent]> = [];
  for (const [type, component] of Object.entries(record)) {
    entries.push([type, cloneComponent(component)]);
  }
  return entries;
}
