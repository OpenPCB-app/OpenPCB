import type { AnyEcsComponent } from "../ecs/component";
import type { AppliedPatch, AppliedPatchBatch } from "./apply";
import type { EcsPatch } from "./patch";

export function invertAppliedPatch<TComponent extends AnyEcsComponent>(
  applied: AppliedPatch<TComponent>,
): EcsPatch<TComponent>[] {
  return [...applied.inversePatches];
}

export function invertAppliedPatches<TComponent extends AnyEcsComponent>(
  applied: readonly AppliedPatch<TComponent>[],
): EcsPatch<TComponent>[] {
  const inverted: EcsPatch<TComponent>[] = [];
  for (const item of applied) {
    inverted.unshift(...item.inversePatches);
  }
  return inverted;
}

export function invertPatchBatch<TComponent extends AnyEcsComponent>(
  batch: AppliedPatchBatch<TComponent>,
): EcsPatch<TComponent>[] {
  return [...batch.inversePatches];
}
