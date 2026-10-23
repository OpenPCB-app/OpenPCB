import { eq } from "drizzle-orm";
import type { DesignerPcbRebindNetReferencesCommand, DesignerSchematicProjection } from "../../../../sdks/designer";
import { invalidPcbBoardSettings, okResult } from "../results";
import { pcbEntities } from "../schema";
import { createNetReferenceJudge } from "./command-reference-id";
import { applyRawNetRebindDelta } from "./rebind-history";
import type { RawNetRebindDelta } from "./rebind-history-types";
import { planNetReferenceRebind } from "./rebind-plan";
import type { NetIdentityDb } from "./state-store";
import { isDurableNetIdOf, isLoneNetId, type NetIdentityMode } from "./types";

interface Input {
  tx: NetIdentityDb;
  designId: string;
  command: DesignerPcbRebindNetReferencesCommand;
  projection: DesignerSchematicProjection;
  identityMode: NetIdentityMode;
  timestamp: string;
  bumpRevision: () => number;
  onNetRebindApplied?: (delta: RawNetRebindDelta) => void;
}

/** Repair changes authored references only; geometry and identity state stay untouched. */
export function executeNetReferenceRebind(input: Input) {
  const { tx, designId, command, projection } = input;
  if (input.identityMode !== "durable") return invalidPcbBoardSettings("Net reference repair requires durable net identity. Retry net identity migration first.");
  const activeIds = new Set(projection.nets.filter((net) => isDurableNetIdOf(net.id, designId) || isLoneNetId(net.id)).map((net) => net.id));
  const plan = planNetReferenceRebind({ designId, bindings: command.bindings, activeIds,
    judge: createNetReferenceJudge(tx, designId, projection), rows: tx.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).all() });
  if (!plan.ok) return plan.result;
  applyRawNetRebindDelta(tx, designId, plan.delta, input.timestamp);
  input.onNetRebindApplied?.(plan.delta);
  return { ...okResult(input.bumpRevision(), null), netRebind: plan.receipt };
}
