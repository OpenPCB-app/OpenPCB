import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { NodeSqliteAssistantStore } from "agentkit/adapters-sqlite-node";
import type { AiProviderConfig } from "agentkit/contracts";
import type { AiProviderClient } from "agentkit/core";
import {
  ChatTurnExecutor, ConversationService, ExecutorRegistry, ProposalService,
  SessionWritePolicy, TurnRunner, createDispatchingWorker, defaultClock, defaultIds,
  recoverOnBoot, createContributorToolCatalog, type ToolCatalog,
  type AssistantStore, type Clock, type ContextProvider, type ProposalApplier,
  type RegenerateMessageInput, type SubmitMessageInput, type SubmitMessageResult,
  type ToolGuard, type ToolSetContributor, type VerificationHook, type WorkerHandle,
} from "agentkit/host";
import { SingleProcessTaskRunner } from "agentkit/runner-local";
import type { TasksSDK } from "../../../sdks/tasks";
import { createRunMonitor } from "./agentkit/run-monitor";
import type { ProviderCredentialAccess } from "../../../core/contracts/credentials/renderer";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../core/contracts/errors";
import { ProviderStore } from "./provider-store";
import { SettingsStore } from "./settings-store";
import {
  LOCAL_EXECUTION_BUDGETS, LOCAL_TURN_KIND, REMOTE_EXECUTION_BUDGETS, isLocalProvider,
} from "./agentkit/budgets";
import { awaitProviderSnapshot } from "./agentkit/await-snapshot";
import { providerFactoryWithMessages, type ProviderMessageTransform } from "./agentkit/provider-messages";
import { createProviderCredentialAccess } from "./agentkit/credential-access";
import { startManualRecoverySweep } from "./agentkit/recovery-sweep";
import { separateDatabasePath } from "./agentkit/database-path";
import { SUBMISSION_FINGERPRINT_KEY, assertReplayMatches, submissionFingerprint } from "./agentkit/submission";
import {
  assertSafeSubmissionMetadata, buildAgentKitProviderClient, pinProviderGeneration,
} from "./agentkit/providers";

export interface AgentKitContributorServices {
  store: AssistantStore;
  proposals: ProposalService;
  policy: SessionWritePolicy;
}
export interface OpenPcbAgentKitHostOptions {
  context: CoreBackendModuleContext;
  databasePath: string;
  applicationDatabasePath?: string;
  nativeBinding?: string;
  clock?: Clock;
  contributors: ToolSetContributor[] | ((services: AgentKitContributorServices) => ToolSetContributor[]);
  proposalApplier: ProposalApplier | ((services: { store: AssistantStore }) => ProposalApplier);
  contextProvider?: ContextProvider;
  verification?: VerificationHook | ((services: { store: AssistantStore }) => VerificationHook);
  toolGuards?: ToolGuard[];
  providerFactory?: (config: AiProviderConfig) => AiProviderClient;
  transformProviderMessages?: ProviderMessageTransform;
  prepareSubmissionMetadata?: (
    input: SubmitMessageInput | RegenerateMessageInput,
    services: { store: AssistantStore; providers: ProviderStore; settings: SettingsStore; regenerate: boolean; signal: AbortSignal },
  ) => Promise<Record<string, unknown>>;
}
export interface OpenPcbAgentKitHost extends AgentKitContributorServices {
  turns: TurnRunner;
  conversations: ConversationService;
  runner: SingleProcessTaskRunner;
  monitor: TasksSDK;
  toolCatalog: ToolCatalog;
  providers: ProviderStore;
  settings: SettingsStore;
  credentialAccess: ProviderCredentialAccess;
  submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult>;
  regenerate(input: RegenerateMessageInput): Promise<SubmitMessageResult>;
  close(): Promise<void>;
}

const activePaths = new Set<string>();

/** One trusted app host owns the separate database and every worker on it. */
export async function createOpenPcbAgentKitHost(
  options: OpenPcbAgentKitHostOptions,
): Promise<OpenPcbAgentKitHost> {
  if ("Bun" in globalThis) throw new ValidationError("AgentKit host requires Node or Electron");
  const databasePath = await separateDatabasePath(options.databasePath, options.applicationDatabasePath);
  if (activePaths.has(databasePath)) throw new ValidationError("AgentKit host is already running");
  activePaths.add(databasePath);
  let store: NodeSqliteAssistantStore | undefined;
  let worker: WorkerHandle | undefined;
  let turns: TurnRunner | undefined;
  try {
    await mkdir(dirname(databasePath), { recursive: true, mode: 0o700 });
    store = new NodeSqliteAssistantStore(databasePath, { nativeBinding: options.nativeBinding, clock: options.clock });
    const services = composeHost(options, store);
    turns = services.turns;
    await recoverOnBoot({ taskRunner: services.runner, proposals: services.proposals });
    worker = await services.runner.startWorker(services.worker, {
      concurrency: 1, kinds: services.registry.kinds(),
    });
    return exposeHost(options, services, worker, databasePath);
  } catch (error) {
    let failures: unknown[];
    try {
      failures = await collectCleanupFailures([
        () => worker?.stop(), () => turns?.disposeContributors(), () => store?.close(),
      ]);
    } finally { activePaths.delete(databasePath); }
    if (failures.length) throw new AggregateError([error, ...failures], "AgentKit host boot failed", { cause: error });
    throw error;
  }
}

function composeHost(options: OpenPcbAgentKitHostOptions, store: NodeSqliteAssistantStore) {
  const clock = options.clock ?? defaultClock;
  const policy = new SessionWritePolicy({ clock });
  const applier = typeof options.proposalApplier === "function"
    ? options.proposalApplier({ store }) : options.proposalApplier;
  const proposals = new ProposalService({
    store, applier, policy, clock, ids: defaultIds,
  });
  const contributors = typeof options.contributors === "function"
    ? options.contributors({ store, proposals, policy }) : options.contributors;
  const runner = new SingleProcessTaskRunner({
    store, clock, recoveryMode: "manual", shutdownMode: "cancel",
  });
  const providers = new ProviderStore(options.context);
  const verification = typeof options.verification === "function"
    ? options.verification({ store }) : options.verification;
  const common = {
    store, taskRunner: runner, contributors, toolGuards: options.toolGuards,
    context: options.contextProvider, verification,
    correction: { maxPasses: 3 }, clock, ids: defaultIds,
    providerFactory: providerFactoryWithMessages(options.providerFactory ?? buildAgentKitProviderClient,
      options.transformProviderMessages),
    secrets: { get: (reference: string) => providers.credentials.resolve(reference),
      set: forbiddenSecretMutation, delete: forbiddenSecretMutation,
      listRefs: async (): Promise<string[]> => [] },
  };
  const turns = new TurnRunner({ ...common, executionBudgets: REMOTE_EXECUTION_BUDGETS });
  const localTurns = new TurnRunner({ ...common, executionBudgets: LOCAL_EXECUTION_BUDGETS });
  const registry = new ExecutorRegistry();
  registry.register(new ChatTurnExecutor(turns));
  registry.register({ kind: LOCAL_TURN_KIND, execute: (execution) => localTurns.executeTask(execution) });
  const settings = new SettingsStore(options.context, providers);
  const credentialAccess = createProviderCredentialAccess(providers);
  return { store, proposals, policy, runner, turns, localTurns, registry, providers, settings, credentialAccess,
    monitor: createRunMonitor(store, runner),
    toolCatalog: createContributorToolCatalog({ contributors, context: options.contextProvider, guards: options.toolGuards }),
    worker: createDispatchingWorker(registry, { store, clock }),
    conversations: new ConversationService({ store }) };
}

async function forbiddenSecretMutation(): Promise<never> {
  throw new ValidationError("AgentKit cannot mutate app credentials");
}

type ComposedHost = ReturnType<typeof composeHost>;

function exposeHost(
  options: OpenPcbAgentKitHostOptions, services: ComposedHost,
  worker: WorkerHandle, databasePath: string,
): OpenPcbAgentKitHost {
  let closing: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const keyed = new Map<string, Promise<unknown>>();
  const submissionAbort = new AbortController();
  const recovery = startManualRecoverySweep(services.runner, options.context.logger);
  const submit = <T extends SubmitMessageInput | RegenerateMessageInput>(input: T, regenerate: boolean) => {
    if (closing) return Promise.reject(new ValidationError("AgentKit host is closed"));
    const prior = input.taskId ? keyed.get(input.taskId) : undefined;
    const operation = (prior ?? Promise.resolve()).catch(() => {}).then(() =>
      submitPinned(options, services, input, regenerate, submissionAbort.signal));
    if (input.taskId) keyed.set(input.taskId, operation);
    void operation.finally(() => {
      if (input.taskId && keyed.get(input.taskId) === operation) keyed.delete(input.taskId);
    }).catch(() => {});
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  };
  return {
    store: services.store, proposals: services.proposals, policy: services.policy,
    turns: services.turns, runner: services.runner, monitor: services.monitor, toolCatalog: services.toolCatalog,
    conversations: services.conversations,
    providers: services.providers, settings: services.settings, credentialAccess: services.credentialAccess,
    submitMessage: (input) => submit(input, false),
    regenerate: (input) => submit(input, true),
    close() {
      closing ??= (async () => {
        submissionAbort.abort(new ValidationError("AgentKit host is closed"));
        let failures: unknown[];
        try {
          failures = await collectCleanupFailures([
            () => settleHostStops(worker, recovery),
            async () => { await Promise.allSettled([...pending]); },
            () => services.turns.disposeContributors(), () => services.store.close(),
          ]);
        } finally { activePaths.delete(databasePath); }
        if (failures.length) throw new AggregateError(failures, "AgentKit host shutdown failed");
      })();
      return closing;
    },
  };
}

async function collectCleanupFailures(steps: readonly (() => void | Promise<void>)[]): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try { await step(); } catch (error) { failures.push(error); }
  }
  return failures;
}

async function settleHostStops(worker: WorkerHandle, recovery: { stop(): Promise<void> }): Promise<void> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => worker.stop()), Promise.resolve().then(() => recovery.stop()),
  ]);
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, "AgentKit host workers failed to stop");
}

async function submitPinned(
  options: OpenPcbAgentKitHostOptions, services: ComposedHost,
  input: SubmitMessageInput | RegenerateMessageInput, regenerate: boolean, signal: AbortSignal,
): Promise<SubmitMessageResult> {
  signal.throwIfAborted();
  assertSafeSubmissionMetadata(input.metadata);
  if (input.kind !== undefined) throw new ValidationError("Task kind is owned by OpenPCB");
  const fingerprint = submissionFingerprint(input, regenerate);
  const existing = input.taskId ? await services.store.tasks.getTask(input.taskId) : null;
  let providerId: string;
  let model: string;
  let kind: string;
  let preparedMetadata: Record<string, unknown> = {};
  if (existing) {
    await assertReplayMatches(services.store, existing, fingerprint, regenerate);
    if (existing.kind !== "chat.turn" && existing.kind !== LOCAL_TURN_KIND) {
      throw new ValidationError("Idempotency key belongs to another task kind");
    }
    providerId = String(existing.payload.providerId);
    model = String(existing.payload.model);
    kind = existing.kind;
  } else {
    if (options.prepareSubmissionMetadata) {
      preparedMetadata = await awaitProviderSnapshot(() => options.prepareSubmissionMetadata!(input,
        { store: services.store, providers: services.providers, settings: services.settings, regenerate, signal }),
        signal, "Submission preparation timed out");
    }
    const settings = services.settings.getSettings();
    const provider = await pinProviderGeneration(services.providers, services.store,
      input.providerId ?? settings.defaultProviderId, input.model, signal);
    providerId = provider.id;
    model = provider.defaultModel;
    kind = isLocalProvider(provider.kind, provider.baseUrl) ? LOCAL_TURN_KIND : "chat.turn";
  }
  signal.throwIfAborted();
  const pinned = { ...input, providerId, model, kind,
    metadata: { ...input.metadata, ...preparedMetadata, [SUBMISSION_FINGERPRINT_KEY]: fingerprint } };
  const turns = kind === LOCAL_TURN_KIND ? services.localTurns : services.turns;
  return regenerate ? turns.regenerate(pinned as RegenerateMessageInput)
    : turns.submitMessage(pinned as SubmitMessageInput);
}
