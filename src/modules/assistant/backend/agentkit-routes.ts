import { Type } from "@sinclair/typebox";
import {
  REST_ROUTES,
  RegenerateMessageRequestSchema,
  SubmitMessageRequestSchema,
  CreateChatRequestSchema,
  UpdateChatRequestSchema,
  ForkChatRequestSchema,
  type RestOperation,
} from "agentkit/contracts";
import { assertScopeIdle } from "agentkit/host";
import {
  createRestHandler,
  deriveIdempotentTaskId,
  deriveRegenerateTaskId,
} from "agentkit/transport-http";
import type { ModuleRouterHandle } from "../../../core/contracts/modules/backend-module";
import { isFeatureEnabled } from "../../../core/contracts/feature-flags/backend";
import { ValidationError, NotFoundError } from "../../../core/contracts/errors";
import type { OpenPcbAgentKitHost } from "./agentkit-host";
import type { ContextResolver } from "./context-resolver";
import type { NativeContextStore } from "./agentkit/native-context-store";
import type { PromptService } from "./prompt-service";
import type { TasksSDK } from "../../../sdks/tasks";
import type { NativeMcpActors } from "./agentkit/native-mcp-actors";
import { authorizeNativeProposal } from "./agentkit/native-identity";
import { json, readInput, safeRoute } from "./agentkit-http-input";
import { registerNativeSessionGrantRoutes } from "./agentkit/native-session-grants";
import { registerAgentKitPreferenceRoutes } from "./agentkit-preference-routes";

export interface AgentKitHttpService {
  host: OpenPcbAgentKitHost;
  contextResolver: ContextResolver;
  contextStore: NativeContextStore;
  prompts: PromptService;
  actorScope: "desktop";
  readOnly: boolean;
  actors: NativeMcpActors;
  runMonitor: TasksSDK;
  mcp: { fetch(request: Request): Promise<Response> };
}

// New framework routes require explicit review before they become desktop capabilities.
export const GENERIC_AGENTKIT_OPERATIONS = [
  "createChat",
  "listChats",
  "getChat",
  "updateChat",
  "deleteChat",
  "listMessages",
  "forkChat",
  "searchMessages",
  "activateBranch",
  "listSiblings",
  "getRun",
  "streamRun",
  "cancelRun",
  "resumeRun",
  "listToolEvents",
  "listTools",
  "listProposals",
  "approveProposal",
  "rejectProposal",
  "applyProposal",
  "getVersion",
] as const satisfies readonly RestOperation[];

export function registerAgentKitRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  registerGenericRoutes(router, genericHandler(service));
  registerMonitorRoutes(router, service);
  registerTurnRoutes(router, service);
  registerContextRoutes(router, service);
  registerPresentationRoutes(router, service);
  registerNativeSessionGrantRoutes(router, {
    store: service.host.store,
    policy: service.host.policy,
    authorize: (proposal) => isWritableProposal(service, proposal),
  });
  registerAgentKitPreferenceRoutes(router, service);
  registerMcpRoutes(router, service);
}

function genericHandler(
  service: AgentKitHttpService,
): ReturnType<typeof createRestHandler> {
  const { host } = service;
  return createRestHandler({
    store: host.store,
    toolCatalog: host.toolCatalog,
    turns: host,
    tasks: {
      cancelTask: (id) => host.runner.requestCancel(id),
      resumeTask: (id) => host.runner.resume(id),
    },
    conversations: {
      deleteChat: async (id) => {
        await host.conversations.deleteChat(id);
        service.contextStore.deleteChatContext(id);
      },
    },
    proposals: {
      approve: (input) =>
        host.proposals.approve({
          ...input,
          actor: "user",
          decidedBy: service.actorScope,
        }),
      reject: (input) =>
        host.proposals.reject({ ...input, decidedBy: service.actorScope }),
      apply: (input) =>
        host.proposals.apply({
          ...input,
          authorize: (proposal) => isWritableProposal(service, proposal),
        }),
    },
    basePath: "/api/modules/assistant",
    authenticate: async () => ({ userId: service.actorScope }),
    authorize: {
      async authorize({ resource, action }) {
        if (resource.kind !== "proposal" || action === "read" || !resource.id)
          return { allowed: true };
        const proposal = await host.store.proposals.get(resource.id);
        return {
          allowed: proposal === null || isWritableProposal(service, proposal),
          reason: "Proposal is outside the writable desktop scope",
        };
      },
    },
  });
}

function registerMonitorRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  router.get(
    "/v1/runs",
    safeRoute(({ req }) => {
      const query = new URL(req.url).searchParams;
      if (
        [...query.keys()].some(
          (key) => !["limit", "cursor", "chatId"].includes(key),
        )
      )
        throw new ValidationError("Unexpected run query field");
      return service.runMonitor
        .listTasks({
          ...(query.has("limit") ? { limit: Number(query.get("limit")) } : {}),
          ...(query.has("cursor") ? { cursor: query.get("cursor")! } : {}),
          ...(query.has("chatId") ? { chatId: query.get("chatId")! } : {}),
        })
        .then((page) => json(page));
    }),
  );
}

function registerPresentationRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  const { host } = service;
  router.get(
    "/v1/proposals/:proposalId/presentation",
    safeRoute(async ({ params }) => {
      const proposal = await host.store.proposals.get(
        params.getOrThrow("proposalId"),
      );
      if (!proposal) throw new NotFoundError("Proposal not found");
      if (
        !authorizeNativeProposal(proposal, service.actorScope) &&
        !service.actors.canApprove(proposal)
      )
        throw new ValidationError("Proposal is outside desktop scope");
      const outcome = proposal.operationId
        ? await host.store.proposals.getOutcome(proposal.operationId)
        : null;
      return json({
        proposalId: proposal.id,
        envelope: proposal.envelope,
        outcome,
      });
    }),
  );
}

function registerMcpRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  if (isFeatureEnabled("mcp.server")) {
    const mcp = ({ req }: { req: Request }) => service.mcp.fetch(req);
    router.get("/mcp", mcp);
    router.post("/mcp", mcp);
    router.delete("/mcp", mcp);
  }
}

function registerGenericRoutes(
  router: ModuleRouterHandle,
  handler: ReturnType<typeof createRestHandler>,
): void {
  for (const operation of GENERIC_AGENTKIT_OPERATIONS) {
    const route = REST_ROUTES[operation];
    const register =
      router[route.method.toLowerCase() as "get" | "post" | "patch" | "delete"];
    register.call(
      router,
      route.path,
      safeRoute(async (context) => {
        if (operation === "createChat")
          await readInput(context.req.clone(), CreateChatRequestSchema, [
            "title",
            "metadata",
          ]);
        if (operation === "updateChat")
          await readInput(context.req.clone(), UpdateChatRequestSchema, [
            "title",
            "metadata",
            "archived",
          ]);
        if (operation === "forkChat")
          await readInput(context.req.clone(), ForkChatRequestSchema, [
            "fromMessageId",
          ]);
        if (["approveProposal", "rejectProposal"].includes(operation)) {
          await readInput(context.req.clone(), DecisionInput, ["reason"]);
        }
        if (operation === "applyProposal") {
          const input = await readInput(context.req.clone(), ApplyInput, [
            "operationId",
          ]);
          const proposalId = context.params.getOrThrow("proposalId");
          if (input.operationId !== `native:${proposalId}`) {
            throw new ValidationError(
              "operationId must match the native proposal identity",
            );
          }
        }
        return handler(context.req);
      }),
    );
  }
}

const DecisionInput = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
});
const ApplyInput = Type.Object({
  operationId: Type.String({ minLength: 1, maxLength: 200 }),
});

function isWritableProposal(
  service: AgentKitHttpService,
  proposal: Parameters<typeof authorizeNativeProposal>[0],
): boolean {
  if (
    service.readOnly ||
    (!authorizeNativeProposal(proposal, service.actorScope) &&
      !service.actors.canApprove(proposal))
  )
    return false;
  const binding = service.contextResolver.getPrimaryDesign(proposal.chatId);
  return proposal.kind === "designer_create_design"
    ? !binding || binding.refId === proposal.envelope.designId
    : binding?.refId === proposal.envelope.designId;
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("Idempotency-Key")?.trim();
  if (!key || key.length > 200)
    throw new ValidationError("A bounded Idempotency-Key header is required");
  return key;
}

function registerTurnRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  const { host } = service;
  router.post(
    REST_ROUTES.submitMessage.path,
    safeRoute(async ({ req, params }) => {
      const key = idempotencyKey(req);
      const input = await readInput(req, SubmitMessageRequestSchema, [
        "content",
        "model",
        "providerId",
        "parentMessageId",
        "metadata",
      ]);
      const chatId = params.getOrThrow("chatId");
      const taskId = await deriveIdempotentTaskId(chatId, key);
      const existing = await host.store.tasks.getTask(taskId);
      return json(
        await host.submitMessage({ ...input, chatId, taskId }),
        existing ? 200 : 201,
      );
    }),
  );
  router.post(
    REST_ROUTES.regenerateMessage.path,
    safeRoute(async ({ req, params }) => {
      const key = idempotencyKey(req);
      const input = await readInput(req, RegenerateMessageRequestSchema, [
        "model",
        "providerId",
        "metadata",
      ]);
      const chatId = params.getOrThrow("chatId");
      const messageId = params.getOrThrow("messageId");
      const taskId = await deriveRegenerateTaskId(chatId, messageId, key);
      const existing = await host.store.tasks.getTask(taskId);
      return json(
        await host.regenerate({ ...input, chatId, messageId, taskId }),
        existing ? 200 : 201,
      );
    }),
  );
}

const BindingInput = Type.Object({
  designId: Type.String({ minLength: 1, maxLength: 128 }),
});

function registerContextRoutes(
  router: ModuleRouterHandle,
  service: AgentKitHttpService,
): void {
  const requireChat = async (id: string) => {
    if (!(await service.host.store.conversations.getChat(id)))
      throw new NotFoundError("Chat not found");
  };
  router.get(
    "/v1/chats/:chatId/context-bindings",
    safeRoute(async ({ params }) => {
      const id = params.getOrThrow("chatId");
      await requireChat(id);
      return json(service.contextStore.listBindings(id));
    }),
  );
  router.post(
    "/v1/chats/:chatId/context-bindings",
    safeRoute(async ({ req, params }) => {
      const id = params.getOrThrow("chatId");
      await requireChat(id);
      await assertBindingIdle(service, id);
      const input = await readInput(req, BindingInput, ["designId"]);
      const binding = await service.contextResolver.maybeAutoBindDesign(
        id,
        input.designId,
      );
      if (!binding)
        throw new ValidationError(
          "Design is missing or chat is already bound to another design",
        );
      const chat = await service.host.store.conversations.getChat(id);
      await service.host.store.conversations.updateChat(id, {
        metadata: {
          ...chat?.metadata,
          designId: binding.refId,
          designName: binding.label,
        },
      });
      return json(binding, 201);
    }),
  );
  router.delete(
    "/v1/chats/:chatId/context-bindings/:bindingId",
    safeRoute(async ({ params }) => {
      const id = params.getOrThrow("chatId");
      await requireChat(id);
      await assertBindingIdle(service, id);
      service.contextStore.deleteBinding(id, params.getOrThrow("bindingId"));
      return new Response(null, { status: 204 });
    }),
  );
}

async function assertBindingIdle(
  service: AgentKitHttpService,
  chatId: string,
): Promise<void> {
  const tasks = await service.host.store.tasks.listByScope(chatId);
  assertScopeIdle(
    chatId,
    tasks
      .filter((task) =>
        ["queued", "running", "waiting_approval", "interrupted"].includes(
          task.status,
        ),
      )
      .map((task) => ({ taskId: task.taskId, status: task.status })),
  );
}
