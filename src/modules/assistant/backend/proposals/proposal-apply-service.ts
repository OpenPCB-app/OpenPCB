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
  ProposalStaleError,
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
  if (
    kind === "designer_pcb_place_batch" ||
    kind === "designer_pcb_route_batch" ||
    // MCP-only PCB tools: their operations are real DesignerCommands too.
    kind === "designer_pcb_board_edits" ||
    kind === "designer_pcb_rules_edits" ||
    kind === "designer_pcb_deletions" ||
    kind === "designer_pcb_drc_waivers" ||
    kind === "designer_pcb_drc_rule_ignores"
  ) {
    return applyDesignerPcbBatchProposal(input);
  }
  if (kind === "designer_design_delete") {
    return applyDesignDeleteProposal(input);
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

/**
 * MCP `designer_delete_design`: deleting a whole design is not a
 * DesignerCommand (it has no revision to apply against, and no undo), so the
 * proposal carries a descriptive operation only and approval calls the SDK.
 */
async function applyDesignDeleteProposal(
  input: ApplyAssistantWriteProposalInput,
): Promise<SchematicApplyResult> {
  const designId = input.record.designId;
  // Irreversible: refuse unless the design is exactly what the user saw when
  // it was proposed. A newer edit (by the user or anyone) means the approval
  // is for a design that no longer exists in that form — no apply-anyway.
  const current = await input.designer.getDesign(designId);
  if (
    current &&
    input.record.baseRevision !== null &&
    current.head.revision !== input.record.baseRevision
  ) {
    throw new ProposalStaleError(input.record.baseRevision, current.head.revision);
  }
  const deleted = current ? await input.designer.deleteDesign(designId) : false;
  const operationId = input.record.operations?.[0]?.id ?? `${input.record.id}:delete`;
  return {
    proposalId: input.record.id,
    status: deleted ? "applied" : "failed",
    designId,
    appliedCount: deleted ? 1 : 0,
    skippedCount: 0,
    failedCount: deleted ? 0 : 1,
    operations: [
      deleted
        ? { operationId, status: "applied" }
        : { operationId, status: "failed", error: "Design not found" },
    ],
    message: deleted ? "Design deleted." : "The design no longer exists.",
  };
}

/** S8: cloud auto-layout batches (pcb_move/rotate/flip, pcb_add_trace/via). The
 * generic op dispatcher already handles them — operation.payload is a real
 * DesignerCommand, so dispatch runs the same command executor (incl. fab
 * validation) as the manual autoroute/autoplace apply routes. After a
 * successful/partial apply, DRC re-runs so the desktop's stored report reflects
 * the new copper (desktop stays DRC authority). */
async function applyDesignerPcbBatchProposal(
  input: ApplyAssistantWriteProposalInput,
): Promise<SchematicApplyResult> {
  const result = await applyDesignerSchematicEditsProposal(input);
  if (result.status !== "failed") {
    await input.designer.runDrc(input.record.designId);
  }
  return result;
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
