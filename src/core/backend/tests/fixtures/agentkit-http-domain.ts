import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { PageRepository } from "../../../../modules/knowledge/backend/db/repositories/page-repository";
import { KnowledgePageMentionProvider } from "../../../../modules/knowledge/backend/providers/mention-provider";
import type { AiProviderClient, AiChatRequest } from "agentkit/core";
import type {
  AiRunEvent,
  AiProviderCapabilities,
  AiProviderModel,
} from "agentkit/contracts";
import type { CoreBackendModuleContext } from "../../../contracts/modules/backend-module";
import { createModuleDb } from "../../db/module-db-factory";
import { resetSharedSqliteForTesting } from "../../db/sqlite-client";
import { createLogger } from "../../logging/logger";
import { MentionRegistry } from "../../mentions";
import { applyModuleMigrations } from "../../migrations/module-migrator";
import { RuntimeSdkRegistry } from "../../modules/sdk-registry";
import { createHttpServer } from "../../http/create-http-server";
import { DiagnosticsStore } from "../../diagnostics/diagnostics-store";
import { ModuleRouter } from "../../router/module-router";
import { ModuleRouterRegistry } from "../../router/module-registry";
import {
  createAgentKitService,
  type AgentKitService,
} from "../../../../modules/assistant/backend/agentkit-service";
import { registerAgentKitRoutes } from "../../../../modules/assistant/backend/agentkit-routes";
import { buildDesignerSdk } from "../../../../modules/designer/backend/sdk";
import { buildSdk } from "../../../../modules/library/backend/queries";
import { commitKicadImport } from "../../../../modules/library/backend/import/commit-kicad";
import { buildInspectResponse } from "../../../../modules/library/backend/import/inspect-kicad";
import { MODULE_SDK_TOKENS } from "../../../../sdks";

const MODULES_ROOT = path.resolve("src/modules");
export const TOKEN = "a".repeat(64);
export const UI_SESSION = "designer-ui-session";

export interface ModelTurn {
  calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  content?: string;
  waitForStop?: boolean;
  newRun?: boolean;
}

/** Only model output is scripted; storage, HTTP security and native tools are real. */
export class HttpFixtureProvider implements AiProviderClient {
  readonly id = "http-fixture";
  readonly kind = "openai-compatible";
  readonly requests: AiChatRequest[] = [];
  private cursor = 0;
  private currentRunId: string | undefined;
  constructor(private readonly turns: ModelTurn[]) {}
  async capabilities(): Promise<AiProviderCapabilities> {
    return { streaming: true, toolCalling: true, modelList: true };
  }
  async listModels(): Promise<AiProviderModel[]> {
    return [];
  }
  async *streamChat(input: AiChatRequest): AsyncIterable<AiRunEvent> {
    this.requests.push(
      structuredClone({
        ...input,
        signal: undefined,
        beforeRequest: undefined,
        onActivity: undefined,
      }),
    );
    const next = this.turns[this.cursor];
    const blocked = this.currentRunId === input.runId && next?.newRun;
    this.currentRunId = input.runId;
    const turn = blocked
      ? { content: "Fixture complete." }
      : (this.turns[this.cursor++] ?? { content: "Fixture complete." });
    const timestamp = "2026-10-07T00:00:00.000Z";
    if (turn.waitForStop) {
      await new Promise<void>((resolve) => {
        if (input.signal?.aborted) resolve();
        else
          input.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
      });
      return;
    }
    const toolCalls = (turn.calls ?? []).map((call) => ({
      id: call.id,
      name: call.name,
      argumentsJson: JSON.stringify(call.arguments),
    }));
    yield {
      contractVersion: "0.6.0",
      eventId: `provider-${this.cursor}`,
      seq: 0,
      type: "run.message.completed",
      runId: input.runId,
      timestamp,
      data: {
        content: turn.content ?? "",
        toolCallCount: toolCalls.length,
        toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : "stop",
      },
    };
  }
}

function context(
  moduleId: string,
  sdk: RuntimeSdkRegistry,
): CoreBackendModuleContext {
  return {
    moduleId,
    db: createModuleDb(moduleId),
    sdk,
    logger: createLogger(`agentkit-http.${moduleId}`),
    manifest: {
      id: moduleId,
      label: moduleId,
      version: "0.1.0",
      apiVersion: 2,
      namespace: `space.${moduleId}`,
      kind: "space",
      enabled: true,
      availability: "all",
      defaultPinned: false,
      dependsOn: [],
      sidebar: { label: moduleId, icon: "Box", order: 0 },
      runtime: {
        backendEntry: "module.backend.ts",
        frontendEntry: "module.frontend.ts",
      },
    },
  };
}

async function importFixture(ctx: CoreBackendModuleContext): Promise<string> {
  const directory = path.resolve(
    "src/core/backend/tests/fixtures/assistant-parity",
  );
  const input = {
    symbolLibrary: {
      fileName: "C.kicad_sym",
      content: await readFile(
        path.join(directory, "capacitor.kicad_sym"),
        "utf8",
      ),
    },
    footprints: [
      {
        fileName: "C_0603_1608Metric.kicad_mod",
        content: await readFile(
          path.join(directory, "capacitor.kicad_mod"),
          "utf8",
        ),
      },
    ],
  };
  const inspected = buildInspectResponse(input);
  return commitKicadImport(ctx, {
    ...input,
    selection: {
      symbolId: inspected.symbols[0]!.id,
      footprintId: inspected.footprints[0]!.id,
    },
    component: {
      name: "Parity Capacitor",
      description: "Real AgentKit native fixture",
    },
  }).componentId;
}

export async function isolatedHttpDomain(
  turns: ModelTurn[] = [],
  readOnly = false,
  options: { existingDirectory?: string; preserveDirectory?: boolean } = {},
) {
  const previousDb = process.env.OPENPCB_DB_PATH;
  const directory =
    options.existingDirectory ??
    (await mkdtemp(path.join(os.tmpdir(), "openpcb-agentkit-http-")));
  const databasePath = path.join(directory, "app.sqlite");
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = databasePath;
  MentionRegistry.reset();
  MentionRegistry.init();
  const sdk = new RuntimeSdkRegistry();
  const secrets = new Map<string, string>();
  sdk.registerValue("core.secret-store", {
    async get(reference: string) {
      return secrets.get(reference) ?? null;
    },
    async set(reference: string, secret: string) {
      secrets.set(reference, secret);
    },
    async delete(reference: string) {
      secrets.delete(reference);
    },
    async listRefs() {
      return [...secrets.keys()];
    },
  });
  let service: AgentKitService | undefined;
  const cleanup = async () => {
    await service?.close();
    resetSharedSqliteForTesting();
    if (previousDb === undefined) delete process.env.OPENPCB_DB_PATH;
    else process.env.OPENPCB_DB_PATH = previousDb;
    if (!options.preserveDirectory)
      await rm(directory, { recursive: true, force: true });
  };
  try {
    for (const id of ["library", "designer", "assistant", "knowledge"]) {
      const report = await applyModuleMigrations(
        id,
        path.join(MODULES_ROOT, id, "backend/migrations"),
      );
      if (report.failed)
        throw new Error(`${id}/${report.failed.name}: ${report.failed.error}`);
    }
    const library = context("library", sdk);
    sdk.registerValue(MODULE_SDK_TOKENS.LIBRARY, buildSdk(library));
    const designer = buildDesignerSdk(context("designer", sdk));
    sdk.registerValue(MODULE_SDK_TOKENS.DESIGNER, designer);
    const ctx = context("assistant", sdk);
    const knowledge = new PageRepository(
      context("knowledge", sdk).db.db as BetterSQLite3Database<
        Record<string, unknown>
      >,
    );
    MentionRegistry.get().register(new KnowledgePageMentionProvider(knowledge));
    const provider = new HttpFixtureProvider(turns);
    const serviceOptions = {
      databasePath: path.join(directory, "agentkit.sqlite"),
      applicationDatabasePath: databasePath,
      providerFactory: () => provider,
      readOnly,
    };
    service = await createAgentKitService(ctx, serviceOptions);
    await service.host.providers.updateProvider("lmstudio", { enabled: true });
    service.host.settings.updateSettings({ defaultProviderId: "lmstudio" });
    const registry = new ModuleRouterRegistry();
    const router = new ModuleRouter("assistant");
    registerAgentKitRoutes(router, service);
    registry.register(router);
    const server = createHttpServer({
      host: "127.0.0.1",
      port: 3000,
      localApi: { token: TOKEN, rendererOrigins: ["http://127.0.0.1:1420"] },
      moduleRegistry: registry,
      diagnosticsStore: new DiagnosticsStore(),
    });
    return {
      ctx,
      designer,
      knowledge,
      service,
      provider,
      server,
      directory,
      options: serviceOptions,
      componentId: options.existingDirectory
        ? library.db.rawSql<{ id: string }>(
            "SELECT id FROM library_components WHERE name = ?",
            ["Parity Capacitor"],
          )[0]!.id
        : await importFixture(library),
      close: cleanup,
      async request(
        route: string,
        init: RequestInit = {},
        token: string | null = TOKEN,
      ): Promise<Response> {
        const headers = new Headers(init.headers);
        if (token !== null) headers.set("X-OpenPCB-Token", token);
        return server.fetch(
          new Request(`http://127.0.0.1:3000/api/modules/assistant${route}`, {
            ...init,
            headers,
          }),
        );
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export type HttpDomain = Awaited<ReturnType<typeof isolatedHttpDomain>>;

export async function waitUntil(
  check: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("AgentKit HTTP fixture did not settle within 5000 ms");
}

export async function submit(
  domain: HttpDomain,
  chatId: string,
  key: string,
  content = "Execute native fixture.",
) {
  const response = await domain.request(`/v1/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ content }),
  });
  if (response.status !== 201)
    throw new Error(`Submit ${response.status}: ${await response.text()}`);
  const result = (await response.json()) as {
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
  };
  await waitUntil(async () => {
    const task = await domain.service.host.store.tasks.getTask(result.runId);
    if (task?.status === "failed") throw new Error(`Run failed: ${task.error}`);
    return task?.status === "completed" || task?.status === "cancelled";
  });
  return { ...result, taskId: result.runId };
}
