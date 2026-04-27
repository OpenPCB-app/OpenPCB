import type { AnyEcsComponent } from "./component";
import type { EcsWorld } from "./world";

export interface EcsSystemContext<TComponent extends AnyEcsComponent> {
  world: EcsWorld<TComponent>;
  now: number;
}

export interface EcsSystem<TComponent extends AnyEcsComponent = AnyEcsComponent> {
  id: string;
  run(context: EcsSystemContext<TComponent>): void | Promise<void>;
}

export async function runSystems<TComponent extends AnyEcsComponent>(
  systems: readonly EcsSystem<TComponent>[],
  context: EcsSystemContext<TComponent>,
): Promise<void> {
  for (const system of systems) {
    await system.run(context);
  }
}
