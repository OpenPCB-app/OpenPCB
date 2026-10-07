import type { AssistantStore, ContextProvider, ProposalRecord, VerificationCheck, VerificationHook } from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS, type DesignerSDK } from "../../../../sdks";
import type { ContextResolver } from "../context-resolver";
import type { NativeContextStore } from "./native-context-store";
import { createNativeProposalApplier } from "./native-applier";
import { runDefinitionOfDone } from "../verification/run-dod";

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
      const report = await runDefinitionOfDone({
        designer, chatId: input.chatId, taskId: input.runId, designId,
        requireSnapshot: records.length > 0,
        conversation: { listWriteProposals: () => records.map((proposal, index) => ({
          status: outcomes[index]?.status === "partial" ? "partial" : proposal.status,
        })) },
        buildIntents: { get: (chatId, runId) => options.contextStore.getBuildIntent(chatId, runId) },
      });
      const mutationFailures = records.flatMap((proposal, index) => mutationDeficiencies(proposal, outcomes[index] ?? null));
      const checks: VerificationCheck[] = report.checks.map((check) => ({ id: check.id, ok: check.passed, message: check.message }));
      if (records.length) checks.push({ id: "native_mutations", ok: mutationFailures.length === 0,
        message: mutationFailures.length ? mutationFailures.join("; ") : "Every native mutation has a successful domain receipt." });
      return { status: report.status === "partial" || mutationFailures.length ? "partial" : "pass", checks,
        deficiencies: [...report.checks.filter((check) => !check.passed).map((check) => check.message), ...mutationFailures] };
    },
  };
}

function mutationDeficiencies(proposal: ProposalRecord, outcome: { status: string; failedOps: Array<{ opIndex: number; error: string }> } | null): string[] {
  if (!outcome) return [`${proposal.toolName}: proposal is ${proposal.status}; no committed apply outcome is available.`];
  if (outcome.status === "applied" && outcome.failedOps.length === 0) return [];
  return [`${proposal.toolName}: apply is ${outcome.status}.`,
    ...outcome.failedOps.map((item) => `${proposal.toolName} unit ${item.opIndex}: ${item.error}`)];
}
