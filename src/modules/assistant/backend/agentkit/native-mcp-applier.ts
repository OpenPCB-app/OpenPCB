import type { AssistantStore, ProposalApplier } from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { ContextResolver } from "../context-resolver";
import { createNativeProposalApplier } from "./native-applier";
import { nativeIdentity } from "./native-identity";
import type { NativeMcpActors } from "./native-mcp-actors";

export function createNativeMcpProposalApplier(options: {
  context: CoreBackendModuleContext; store: AssistantStore; contextResolver: ContextResolver;
  actors: NativeMcpActors; readOnly?: boolean;
}): ProposalApplier {
  const applierOf = (actorScope: string) => createNativeProposalApplier({ ...options, actorScope,
    authorize: (proposal) => !options.readOnly && (actorScope === "desktop" || options.actors.canWrite(actorScope, proposal.chatId)) });
  return {
    async apply(input) {
      const scope = nativeIdentity(input.proposal).actorScope;
      if (scope !== "desktop" && !options.actors.canWrite(scope, input.proposal.chatId)) {
        return { status: "failed", appliedOps: 0, failedOps: [{ opIndex: 0, error: "MCP_ACTOR_DENIED" }] };
      }
      return applierOf(scope).apply(input);
    },
    async getOutcome(operationId) {
      if (!operationId.startsWith("native:")) return null;
      const proposal = await options.store.proposals.get(operationId.slice("native:".length));
      if (!proposal) return null;
      const scope = nativeIdentity(proposal).actorScope;
      if (scope !== "desktop" && !/^mcp:[0-9a-f-]{36}$/i.test(scope)) return null;
      return applierOf(scope).getOutcome(operationId);
    },
    async currentRevision(scopeKey) {
      const marker = scopeKey.indexOf(":chat:");
      if (marker < 0) return null;
      const scope = scopeKey.slice(0, marker);
      if (scope !== "desktop" && !/^mcp:[0-9a-f-]{36}$/i.test(scope)) return null;
      return applierOf(scope).currentRevision?.(scopeKey) ?? null;
    },
  };
}
