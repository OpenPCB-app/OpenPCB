import type { DesignerNetIdentityEvent } from "../../../../sdks/designer/net-identity";
import { deriveNetComponents, type DesignerCombinedState, type WorldIdentityBinder } from "../projection-world";
import { lazyCensus, type NetDependentsCensus } from "./census";
import { bindSchematicIdentity } from "./projection";
import { persistReplayIdentity, priorNetOwners } from "./replay";
import { readNetIdentitySeqWatermark, type NetIdentityDb } from "./state-store";
import { designNetSalt, type NetIdentityState } from "./types";
import { requireValid } from "./validation";

/** The census belongs to the patched world, never to the pre-replay database rows. */
export function historyIdentityBinding(tx: NetIdentityDb, prior: NetIdentityState): {
  binder: WorldIdentityBinder;
  persist(next: DesignerCombinedState, revision: number, timestamp: string): DesignerNetIdentityEvent[];
} {
  const priorOwner = priorNetOwners(prior.active);
  let census: NetDependentsCensus | undefined;
  return {
    binder(source, previousActive, references) {
      requireValid(references, "identity.replay", "patched PCB reference source is required");
      census = lazyCensus(() => references);
      const derived = deriveNetComponents(source.parts, source.wires, source.labels, source.primitives);
      return bindSchematicIdentity(source, derived, {
        previousActive, priorOwner, salt: designNetSalt(prior.designId), mode: "commit",
        seqWatermark: readNetIdentitySeqWatermark(tx, prior.designId), dependentCount: (id) => census!.count(id),
      });
    },
    persist(next, revision, timestamp) {
      requireValid(census && next.identityBinding, "identity.replay", "world identity binding was not evaluated");
      const { bind, previousActive } = next.identityBinding;
      return persistReplayIdentity(tx, prior.designId, prior, previousActive, bind, census, revision, timestamp).events;
    },
  };
}
