import { Type } from "@sinclair/typebox";
import type { AssistantStore, ProposalRecord, SessionWritePolicy, WriteAllowance } from "agentkit/host";
import type { ModuleRouterHandle } from "../../../../core/contracts/modules/backend-module";
import { NotFoundError, ValidationError } from "../../../../core/contracts/errors";
import { json, readInput, safeRoute } from "../agentkit-http-input";
import { commandRisk, nativeIdentity } from "./native-identity";
import { nativeScope } from "./native-stage";

interface NativeSessionGrantOptions {
  store: AssistantStore;
  policy: SessionWritePolicy;
  authorize(proposal: ProposalRecord): boolean;
}

/** Consent is stored by AgentKit; its scope is derived from trusted native proposal identity. */
export function allowNativeSession(options: NativeSessionGrantOptions, proposal: ProposalRecord): WriteAllowance {
  if (!options.authorize(proposal)) throw new ValidationError("Proposal is outside the writable native scope");
  const actor = nativeIdentity(proposal).actorScope;
  const designId = proposal.envelope.designId;
  if (typeof designId !== "string" || proposal.scopeKey !== nativeScope(actor, designId, proposal.chatId) ||
      proposal.risk !== "destructive" || commandRisk(proposal.operations) !== "destructive") {
    throw new ValidationError("Session allowance requires a native destructive proposal");
  }
  if (!["pending", "approved", "applied"].includes(proposal.status)) throw new ValidationError("Proposal cannot grant session writes");
  // Broad consent uses the canonical scoped policy path. Actor is immutable in
  // the server-derived scope, while future validated arguments/revisions may vary.
  return options.policy.allow({ chatId: proposal.chatId, scopeKey: proposal.scopeKey,
    toolName: proposal.toolName, proposalKind: proposal.kind, maxRisk: "destructive" });
}

export function revokeNativeActorGrants(policy: SessionWritePolicy, actorScope: string, chatId: string): void {
  for (const grant of policy.list(chatId)) {
    if (grant.actorId === actorScope || grant.scopeKey?.startsWith(`${actorScope}:chat:${chatId}:design:`)) {
      policy.revoke(chatId, grant.key);
    }
  }
}

export function registerNativeSessionGrantRoutes(router: ModuleRouterHandle, options: NativeSessionGrantOptions): void {
  router.post("/v1/proposals/:proposalId/allow-session", safeRoute(async ({ req, params }) => {
    await readInput(req, Type.Object({}), []);
    const proposal = await options.store.proposals.get(params.getOrThrow("proposalId"));
    if (!proposal) throw new NotFoundError("Proposal not found");
    return json(allowNativeSession(options, proposal), 201);
  }));
  router.get("/v1/chats/:chatId/native-write-allowances", safeRoute(async ({ params }) => {
    const chatId = params.getOrThrow("chatId");
    return json(await visibleGrants(options, chatId));
  }));
  router.delete("/v1/chats/:chatId/native-write-allowances/:key", safeRoute(async ({ params }) => {
    const chatId = params.getOrThrow("chatId");
    const key = params.getOrThrow("key");
    if (!(await visibleGrants(options, chatId)).some((grant) => grant.key === key)) throw new NotFoundError("Session allowance not found");
    options.policy.revoke(chatId, key);
    return new Response(null, { status: 204 });
  }));
}

async function visibleGrants(options: NativeSessionGrantOptions, chatId: string): Promise<WriteAllowance[]> {
  if (!await options.store.conversations.getChat(chatId)) throw new NotFoundError("Chat not found");
  const proposals = await options.store.proposals.listByChat(chatId);
  return options.policy.list(chatId).filter((grant) => proposals.some((proposal) => {
    if (!options.authorize(proposal)) return false;
    const actor = nativeIdentity(proposal).actorScope;
    return grant.scopeKey === nativeScope(actor, String(proposal.envelope.designId), chatId) &&
      (grant.actorId === undefined || grant.actorId === actor) && grant.toolName === proposal.toolName && grant.proposalKind === proposal.kind;
  }));
}
