import type { AiToolExecutionContext } from "agentkit/core";
import type { AiToolResult } from "agentkit/contracts";
import type { AssistantStore, ProposalRecord, ProposalService } from "agentkit/host";
import type { NativeContextStore } from "./native-context-store";
import { argumentFingerprint, commandRisk, nativeIdentity, authorizeNativeProposal } from "./native-identity";

export interface NativeStageDeps {
  store: AssistantStore;
  proposals: ProposalService;
  actorScope: string;
  readOnly?: boolean;
  contextStore?: NativeContextStore;
}

export interface NativeBuiltProposal {
  id: string;
  toolName: string;
  kind: string;
  designId: string;
  baseRevision: number | null;
  operations: unknown[];
  warnings: string[];
  expectedUnits: number;
  envelope: Record<string, unknown>;
  actionId?: string;
}

export function nativeScope(actorScope: string, designId: string, chatId: string): string {
  return `${actorScope}:chat:${chatId}:design:${designId}`;
}

export function nativeToolFailure(message: string, context: AiToolExecutionContext): AiToolResult<null> {
  return { ok: false, status: "partial", data: null, warnings: [message], sources: [],
    truncated: false, limits: context.limits, summary: message };
}

export async function findNativeDuplicate(
  deps: NativeStageDeps, context: AiToolExecutionContext, toolName: string,
  input: unknown, scopeKey: string, actionId: string,
): Promise<AiToolResult | null> {
  const prior = await deps.store.proposals.getByActionId(scopeKey, actionId);
  if (!prior) return null;
  if (prior.chatId !== context.chatId || prior.toolName !== toolName || nativeIdentity(prior).actorScope !== deps.actorScope ||
      nativeIdentity(prior).argumentFingerprint !== argumentFingerprint(input)) {
    return nativeToolFailure("OPERATION_IDENTITY_CONFLICT: action_id arguments changed.", context);
  }
  const outcome = prior.operationId ? await deps.store.proposals.getOutcome(prior.operationId) : null;
  const status = prior.status === "applied" ? outcome?.status === "partial" ? "partial" : "already_applied" : "pending";
  return proposalResult(prior, context, status, outcome);
}

export async function stageNativeProposal(
  deps: NativeStageDeps, context: AiToolExecutionContext, input: unknown, built: NativeBuiltProposal,
): Promise<AiToolResult> {
  if (deps.readOnly) return nativeToolFailure("READ_ONLY: native writes are disabled.", context);
  if (!context.chatId) return nativeToolFailure("Chat context missing.", context);
  context.signal?.throwIfAborted();
  const scopeKey = nativeScope(deps.actorScope, built.designId, context.chatId);
  const fingerprint = argumentFingerprint(input);
  const actionId = built.actionId ?? `native_${argumentFingerprint([deps.actorScope, context.chatId, context.runId, built.toolName, fingerprint])}`;
  const duplicate = await findNativeDuplicate(deps, context, built.toolName, input, scopeKey, actionId);
  if (duplicate) return duplicate;
  let risk: ReturnType<typeof commandRisk>;
  try { risk = commandRisk(built.operations); }
  catch (error) { return nativeToolFailure(error instanceof Error ? error.message : String(error), context); }
  const proposalId = built.id;
  try {
    deps.contextStore?.reserveAction({ actorScope: deps.actorScope, chatId: context.chatId,
      actionId, designId: built.designId, toolName: built.toolName, argumentFingerprint: fingerprint, proposalId });
  } catch (error) { return nativeToolFailure(error instanceof Error ? error.message : String(error), context); }
  const truncated = built.warnings.some((warning) => warning.startsWith("Only the first"));
  let proposal: ProposalRecord;
  try { proposal = await deps.proposals.stage({
    id: proposalId, chatId: context.chatId, runId: context.runId, scopeKey, actionId,
    toolName: built.toolName, kind: built.kind, risk, operations: built.operations,
    warnings: built.warnings, truncated,
    revisionAtCreate: built.baseRevision === null ? undefined : String(built.baseRevision),
    envelope: { ...built.envelope, nativeIdentity: { actorScope: deps.actorScope,
      argumentFingerprint: fingerprint, expectedUnits: built.expectedUnits } },
  }); } catch (error) {
    const duplicate = await findNativeDuplicate(deps, context, built.toolName, input, scopeKey, actionId);
    if (duplicate) return duplicate;
    return nativeToolFailure(error instanceof Error ? error.message : String(error), context);
  }
  return executeStagedProposal(deps, context, proposal, fingerprint);
}

async function executeStagedProposal(
  deps: NativeStageDeps, context: AiToolExecutionContext, proposal: ProposalRecord, fingerprint: string,
): Promise<AiToolResult> {
  const { scopeKey, toolName, kind, risk } = proposal;
  const revision = proposal.revisionAtCreate ?? null;
  const scopedDestructiveGrant = risk === "destructive" && deps.proposals.policy.list(proposal.chatId).some((grant) =>
    (grant.actorId === undefined || grant.actorId === deps.actorScope) && grant.scopeKey === scopeKey &&
    grant.toolName === toolName && grant.proposalKind === kind && grant.maxRisk === "destructive" &&
    (grant.payloadFingerprint === undefined || grant.payloadFingerprint === fingerprint) &&
    (grant.revision === undefined || grant.revision === revision) &&
    deps.proposals.policy.isAutoApplyAllowed({ chatId: proposal.chatId, toolName, proposalKind: kind,
      scopeKey, risk, actorId: grant.actorId, payloadFingerprint: fingerprint, revision }));
  const placement = proposal.kind === "designer_place_components" ? proposal.envelope.payload as
    { requiresPartialConfirmation?: boolean } | undefined : undefined;
  const malformedAction = proposal.warnings.some((warning) => warning.startsWith("Ignored malformed action_id"));
  if ((risk === "destructive" && !scopedDestructiveGrant) || placement?.requiresPartialConfirmation || malformedAction ||
      proposal.truncated || nativeIdentity(proposal).expectedUnits === 0) {
    return proposalResult(proposal, context, "pending", null);
  }
  await deps.proposals.approve({ proposalId: proposal.id, actor: "policy", policyId: scopedDestructiveGrant ? "openpcb-native-session-grant" : "openpcb-native-default" });
  let outcome: Awaited<ReturnType<ProposalService["apply"]>>;
  try { outcome = await deps.proposals.apply({ proposalId: proposal.id, operationId: `native:${proposal.id}`,
    signal: context.signal, authorize: (item) => authorizeNativeProposal(item, deps.actorScope, deps.readOnly) });
  } catch (error) {
    const failed = await deps.store.proposals.get(proposal.id) ?? proposal;
    const result = proposalResult(failed, context, "partial", failed.operationId ? await deps.store.proposals.getOutcome(failed.operationId) : null);
    const message = error instanceof Error ? error.message : String(error);
    return { ...result, ok: false, warnings: [...result.warnings, message], summary: message };
  }
  const finalized = await deps.store.proposals.get(proposal.id) ?? proposal;
  return proposalResult(finalized, context, outcome.status === "applied" ? "ok" : "partial", outcome);
}

function proposalResult(
  proposal: ProposalRecord, context: AiToolExecutionContext,
  status: "ok" | "partial" | "pending" | "already_applied",
  outcome: Awaited<ReturnType<ProposalService["apply"]>> | null,
): AiToolResult {
  const blocked = status === "pending" && proposal.status !== "pending";
  const failed = status === "partial" || blocked;
  const warnings = [...proposal.warnings, ...(blocked ? [`Proposal is ${proposal.status}; inspect before retrying.`] : [])];
  return {
    ok: !failed, status: failed ? "partial" : "ok",
    data: { proposalId: proposal.id, status: proposal.status, kind: proposal.kind, risk: proposal.risk,
      operationCount: proposal.operations.length, envelope: proposal.envelope, outcome },
    modelData: { status, appliedCount: outcome?.appliedOps ?? 0, ...modelDomainOutcome(outcome),
      skipped: [...warnings.map((reason) => ({ id: "build", reason })),
        ...(outcome?.failedOps.map((item) => ({ id: String(item.opIndex), reason: item.error })) ?? [])] },
    summary: `${status}: ${proposal.toolName}`, warnings, sources: [],
    truncated: proposal.truncated, limits: context.limits,
  };
}

function modelDomainOutcome(outcome: Awaited<ReturnType<ProposalService["apply"]>> | null): Record<string, unknown> {
  if (!outcome?.resultJson) return {};
  const decoded = JSON.parse(outcome.resultJson) as {
    designId: string;
    receipts: Array<{ commandId: string; result: { ok: boolean; revision?: number; createdEntityId?: string | null; code?: string } }>;
    creations: Array<{ design: { id: string; name: string; revision: number } }>;
  };
  const results = decoded.receipts.slice(0, 100).map(({ commandId, result }) => ({ commandId,
    ok: result.ok, ...(result.revision === undefined ? {} : { revision: result.revision }),
    ...(result.createdEntityId === undefined ? {} : { createdEntityId: result.createdEntityId }),
    ...(result.code === undefined ? {} : { code: result.code }) }));
  return { designId: decoded.designId, results, creations: decoded.creations.slice(0, 100).map(({ design }) => ({
    id: design.id, name: design.name, revision: design.revision })),
    ...(decoded.receipts.length > 100 ? { omittedResultCount: decoded.receipts.length - 100 } : {}) };
}
