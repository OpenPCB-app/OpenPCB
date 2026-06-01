import type {
  AssistantPlacementApplyResult,
  AssistantPlacementProposal,
  AssistantWriteProposalDto,
  DesignerSDK,
} from "../../../../sdks";
import {
  applySchematicProposalOperations,
  applyDesignerPlaceComponentsProposal,
  isAssistantProposalApplyError,
  type SchematicApplyResult,
  type SchematicProposalEnvelope,
} from "../tools/designer-tools";

export interface ApplyAssistantWriteProposalInput {
  designer: DesignerSDK;
  record: AssistantWriteProposalDto;
  allowPartial: boolean;
}

export async function applyAssistantWriteProposal(
  input: ApplyAssistantWriteProposalInput,
): Promise<AssistantPlacementApplyResult | SchematicApplyResult> {
  // Idempotency: a proposal that already landed (applied/partial) must not be
  // re-dispatched — return its persisted apply result so a forced re-run keyed
  // by the same `action_id` is a safe no-op rather than duplicating writes.
  if (
    (input.record.status === "applied" || input.record.status === "partial") &&
    input.record.applyResult != null
  ) {
    return input.record.applyResult as
      | AssistantPlacementApplyResult
      | SchematicApplyResult;
  }
  const kind = String(input.record.kind);
  if (
    kind === "designer_schematic_edits" ||
    kind === "designer_schematic_wires" ||
    kind === "designer_schematic_updates" ||
    kind === "designer_schematic_deletions"
  ) {
    return applyDesignerSchematicEditsProposal(input);
  }
  if (kind !== "designer_place_components") {
    throw new Error(`Unsupported proposal kind: ${kind}`);
  }
  return applyDesignerPlaceComponentsProposal({
    designer: input.designer,
    proposal: input.record.proposal as AssistantPlacementProposal,
    designId: input.record.designId,
    baseRevision: input.record.baseRevision,
    allowPartial: input.allowPartial,
  });
}

export function applyFailureResult(err: unknown): unknown | null {
  return isAssistantProposalApplyError(err) ? err.applyResult : null;
}

async function applyDesignerSchematicEditsProposal(
  input: ApplyAssistantWriteProposalInput,
): Promise<SchematicApplyResult> {
  const envelope = (
    input.record as AssistantWriteProposalDto & { envelope?: unknown }
  ).envelope as SchematicProposalEnvelope | null;
  if (!envelope || !Array.isArray(envelope.operations)) {
    throw new Error("Schematic proposal envelope is missing operations.");
  }
  // Authorize partial apply from the PERSISTED envelope, not the client: a
  // non-destructive proposal always applies its valid ops (skips reported);
  // destructive proposals require the explicit client confirm (`allowPartial`).
  const allowPartial =
    input.allowPartial || envelope.riskLevel !== "destructive";
  return applySchematicProposalOperations({
    designer: input.designer,
    designId: input.record.designId,
    baseRevision: input.record.baseRevision,
    envelope,
    allowPartial,
  });
}
