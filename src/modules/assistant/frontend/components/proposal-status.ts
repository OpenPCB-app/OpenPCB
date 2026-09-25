/**
 * What a proposal card says about a proposal that did not apply, from the
 * persisted apply result. Pure, so it is unit-tested without React.
 *
 * `STALE_PROPOSAL` (see ProposalStaleError on the backend) means the design
 * moved on after the proposal was made. That is never retried or "applied
 * anyway": the agent has to propose again against the current design.
 */

export interface ProposalApplyResultLike {
  code?: string;
  message?: string;
  expectedRevision?: number;
  currentRevision?: number;
}

export function proposalFailureNote(
  status: string,
  applyResult: unknown,
): string | null {
  if (status !== "failed") return null;
  const result = (applyResult ?? null) as ProposalApplyResultLike | null;
  if (result?.code === "STALE_PROPOSAL") {
    const from = result.expectedRevision ?? "?";
    const to = result.currentRevision ?? "?";
    return `Not applied: the design changed after this was proposed (revision ${from} → ${to}). Ask the agent to propose it again.`;
  }
  return result?.message ? `Not applied: ${result.message}` : "Not applied.";
}

/** A backend refusal message that means the proposal is stale. */
export function isStaleMessage(message: string): boolean {
  return /design changed since proposal was created/i.test(message);
}

/**
 * Proposal kinds that always need a fresh approval — the backend never
 * honours a session allowance for them, so the card does not offer one.
 */
export const NO_SESSION_ALLOW_KINDS: ReadonlySet<string> = new Set([
  "designer_design_delete",
  "designer_pcb_drc_rule_ignores",
]);
