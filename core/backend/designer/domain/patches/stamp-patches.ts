import type { DesignPatch } from "../../contracts/patch";
import type { DesignWorld } from "../design-world";

export function stampPatchesForRevision(
  world: DesignWorld,
  patches: DesignPatch[],
  nextRevision: number,
  options?: {
    preserveCreatedRevisionForMissingEntity?: boolean;
  },
): void {
  for (const patch of patches) {
    if (patch.op !== "upsert_entity") {
      continue;
    }

    const existing = world.entities.get(patch.entity.id);
    patch.entity.createdRevision =
      existing?.createdRevision ??
      (options?.preserveCreatedRevisionForMissingEntity
        ? patch.entity.createdRevision
        : nextRevision);
    patch.entity.updatedRevision = nextRevision;
  }
}
