import type {
  AssistantStore, ContextProvider, DeficiencyReport, ProposalRecord, VerificationCheck, VerificationHook,
} from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import type { NativeContextStore } from "./native-context-store";
import { createNativeProposalApplier } from "./native-applier";
import { runDefinitionOfDone } from "../verification/run-dod";
import type { BuildIntent } from "../verification/types";

export function createNativeContextProvider(
  contextResolver: ContextResolver, systemPrompt?: (chatId: string) => Promise<string | null>,
): ContextProvider {
  return {
    async listBindings(chatId, signal) { signal?.throwIfAborted(); return contextResolver.listBindings(chatId); },
    async refresh(chatId, signal) { signal?.throwIfAborted(); await contextResolver.refreshBindingHealth(chatId); },
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

export function createNativeVerification(options: {
  context: CoreBackendModuleContext; contextResolver: ContextResolver; contextStore: NativeContextStore;
  store: AssistantStore; actorScope?: string;
}): VerificationHook {
  const designer = options.context.sdk.get<DesignerSDK>(MODULE_SDK_TOKENS.DESIGNER);
  if (!designer) throw new Error("Designer module not available.");
  return {
    async verify(input) {
      input.signal?.throwIfAborted();
      if (input.toolCallCount === 0) return null;
      const designId = options.contextResolver.getPrimaryDesign(input.chatId)?.refId ?? null;
      const records = (await options.store.proposals.listByChat(input.chatId, { limit: 1000 }))
        .filter((item) => item.runId === input.runId);
      const outcomes = await Promise.all(records.map(async (proposal) => {
        const persisted = proposal.operationId ? await options.store.proposals.getOutcome(proposal.operationId) : null;
        if (persisted || !proposal.operationId) return persisted;
        return createNativeProposalApplier({ context: options.context, store: options.store, actorScope: options.actorScope ?? "desktop" })
          .getOutcome(proposal.operationId);
      }));
      const mutationFailures = records.flatMap((proposal, index) => mutationDeficiencies(proposal, outcomes[index] ?? null));
      if (options.contextStore.isUnboundRun(input.runId)) {
        const created = designId && records.some((proposal, index) => proposal.kind === "designer_create_design" &&
          proposal.envelope.designId === designId && outcomes[index]?.status === "applied") ? designId : null;
        return deferredBuildReport(options.contextStore, input.chatId, input.runId, created, records.length > 0, mutationFailures);
      }
      const report = await runDefinitionOfDone({
        designer, chatId: input.chatId, taskId: input.runId, designId,
        requireSnapshot: records.length > 0,
        conversation: { listWriteProposals: () => records.map((proposal, index) => ({
          status: outcomes[index]?.status === "partial" ? "partial" : proposal.status,
        })) },
        buildIntents: { get: (chatId, runId) => adoptBuildIntent(options.contextStore, chatId, runId, designId) },
      });
      const checks: VerificationCheck[] = report.checks.map((check) => ({ id: check.id, ok: check.passed, message: check.message }));
      if (records.length) checks.push({ id: "native_mutations", ok: mutationFailures.length === 0,
        message: mutationFailures.length ? mutationFailures.join("; ") : "Every native mutation has a successful domain receipt." });
      return { status: report.status === "partial" || mutationFailures.length ? "partial" : "pass", checks,
        deficiencies: [...report.checks.filter((check) => !check.passed).map((check) => check.message), ...mutationFailures] };
    },
  };
}

/**
 * An unbound run was staged without placement or wiring tools, so a correction pass could not
 * act on placement gaps. Only a run that created and bound its own design hands its build intent
 * on, scoped to that design: a BOM lookup alone is not a build, and another design is not its target.
 */
function deferredBuildReport(
  store: NativeContextStore, chatId: string, runId: string, createdDesignId: string | null,
  attempted: boolean, mutationFailures: string[],
): DeficiencyReport {
  const intent = store.getBuildIntent(chatId, runId);
  const deferred = Boolean(createdDesignId && intent?.items.length);
  if (deferred) store.deferBuildIntent(intent!, createdDesignId!);
  const checks: VerificationCheck[] = [{ id: "build_deferred", ok: true, message: deferred
    ? "No design was bound when this run started, so placement and wiring were not available; the next run on the created design verifies the build."
    : "No design was bound when this run started, so placement and wiring were not available." }];
  if (attempted) checks.push({ id: "native_mutations", ok: mutationFailures.length === 0,
    message: mutationFailures.length ? mutationFailures.join("; ") : "Every native mutation has a successful domain receipt." });
  return { status: mutationFailures.length ? "partial" : "pass", checks, deficiencies: mutationFailures };
}

/**
 * A bound run's own intent wins; otherwise it adopts the intent its unbound predecessor deferred,
 * but only on the design that predecessor created. Any other outcome discards the deferred intent.
 */
function adoptBuildIntent(store: NativeContextStore, chatId: string, runId: string, designId: string | null): BuildIntent | null {
  const own = store.getBuildIntent(chatId, runId);
  const deferred = store.takeDeferredBuildIntent(chatId);
  if (own || !deferred || !designId || deferred.designId !== designId) return own;
  const adopted: BuildIntent = { chatId: deferred.chatId, taskId: runId, goal: deferred.goal, items: deferred.items };
  store.saveBuildIntent(adopted);
  return adopted;
}

function mutationDeficiencies(proposal: ProposalRecord, outcome: { status: string; failedOps: Array<{ opIndex: number; error: string }> } | null): string[] {
  if (!outcome) return [`${proposal.toolName}: proposal is ${proposal.status}; no committed apply outcome is available.`];
  if (outcome.status === "applied" && outcome.failedOps.length === 0) return [];
  return [`${proposal.toolName}: apply is ${outcome.status}.`,
    ...outcome.failedOps.map((item) => `${proposal.toolName} unit ${item.opIndex}: ${item.error}`)];
}
