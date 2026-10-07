import { dirname, resolve } from "node:path";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../core/contracts/errors";
import {
  createOpenPcbAgentKitHost,
  type OpenPcbAgentKitHost,
  type OpenPcbAgentKitHostOptions,
} from "./agentkit-host";
import { NativeContextStore } from "./agentkit/native-context-store";
import { createNativeToolContributor } from "./agentkit/native-tools";
import { createNativeMcpProposalApplier } from "./agentkit/native-mcp-applier";
import { createNativeMcpEndpoint } from "./agentkit/native-mcp";
import { NativeMcpActors } from "./agentkit/native-mcp-actors";
import {
  createNativeContextProvider,
  createNativeVerification,
} from "./agentkit/native-verification";
import { snapshotPrompt, providerContextMessages } from "./agentkit-context";
import { ContextResolver } from "./context-resolver";
import { PromptService } from "./prompt-service";
import type { AgentKitHttpService } from "./agentkit-routes";

export interface AgentKitServiceOptions {
  databasePath?: string;
  applicationDatabasePath?: string;
  nativeBinding?: string;
  readOnly?: boolean;
  providerFactory?: OpenPcbAgentKitHostOptions["providerFactory"];
}

export interface AgentKitService extends AgentKitHttpService {
  databasePath: string;
  close(): Promise<void>;
}

export function agentKitDatabasePath(options: AgentKitServiceOptions): string {
  if (options.databasePath) return resolve(options.databasePath);
  const appDirectory = process.env.APP_DATA_DIR;
  if (appDirectory) return resolve(appDirectory, "agentkit.sqlite");
  const applicationPath =
    options.applicationDatabasePath ?? process.env.OPENPCB_DB_PATH;
  if (applicationPath && applicationPath !== ":memory:")
    return resolve(dirname(applicationPath), "agentkit.sqlite");
  if (process.env.NODE_ENV === "production")
    throw new ValidationError("AgentKit data directory is not configured");
  return resolve("dev-data", "agentkit.sqlite");
}

/** Composition creates one framework host; native code retains domain rules and storage. */
export async function createAgentKitService(
  context: CoreBackendModuleContext,
  options: AgentKitServiceOptions = {},
): Promise<AgentKitService> {
  const databasePath = agentKitDatabasePath(options);
  let host: OpenPcbAgentKitHost | undefined;
  const native = createNativeServices(
    context,
    () => host,
    options.readOnly ?? false,
  );
  const currentHost = () => {
    if (!host) throw new Error("AgentKit host is not ready");
    return host;
  };
  host = await createOpenPcbAgentKitHost({
    context,
    databasePath,
    applicationDatabasePath: options.applicationDatabasePath,
    nativeBinding: options.nativeBinding,
    providerFactory: options.providerFactory,
    ...nativeHostPorts(context, native),
    ...promptHostPorts(native, currentHost),
  });
  try {
    return exposeService(context, host, native, databasePath);
  } catch (error) {
    try {
      await host.close();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Assistant composition and cleanup failed",
      );
    }
    throw error;
  }
}

function exposeService(
  context: CoreBackendModuleContext,
  host: OpenPcbAgentKitHost,
  native: NativeServices,
  databasePath: string,
): AgentKitService {
  const mcp = createNativeMcpEndpoint({
    context,
    host,
    ...native,
    getSettings: () => host.settings.getSettings(),
  });
  return {
    host,
    mcp,
    runMonitor: host.monitor,
    ...native,
    databasePath,
    close: async () => {
      try {
        await mcp.close();
      } finally {
        await host.close();
      }
    },
  };
}

type NativeServices = Pick<
  AgentKitHttpService,
  | "contextResolver"
  | "contextStore"
  | "prompts"
  | "actors"
  | "actorScope"
  | "readOnly"
>;

function nativeHostPorts(
  context: CoreBackendModuleContext,
  native: NativeServices,
): Pick<
  OpenPcbAgentKitHostOptions,
  "verification" | "contributors" | "proposalApplier"
> {
  const { contextResolver, contextStore, actorScope, readOnly, actors } =
    native;
  return {
    verification: ({ store }) =>
      createNativeVerification({
        context,
        contextResolver,
        contextStore,
        store,
        actorScope,
      }),
    contributors: ({ store, proposals }) => [
      createNativeToolContributor({
        context,
        contextResolver,
        contextStore,
        store,
        proposals,
        actorScope,
        readOnly,
      }),
    ],
    proposalApplier: ({ store }) =>
      createNativeMcpProposalApplier({
        context,
        contextResolver,
        store,
        actors,
        readOnly,
      }),
  };
}

function promptHostPorts(
  native: NativeServices,
  host: () => OpenPcbAgentKitHost,
): Pick<
  OpenPcbAgentKitHostOptions,
  "contextProvider" | "prepareSubmissionMetadata" | "transformProviderMessages"
> {
  const { contextResolver, prompts, readOnly } = native;
  return {
    contextProvider: createNativeContextProvider(contextResolver, async () =>
      prompts.composeSystem(
        host().settings.getSettings().defaultPromptPresetId,
        [],
        { includeWriteTools: !readOnly },
      ),
    ),
    prepareSubmissionMetadata: (input, { store, settings }) =>
      snapshotPrompt(input, store, settings),
    transformProviderMessages: (request) =>
      providerContextMessages({
        request,
        store: host().store,
        resolver: contextResolver,
        prompts,
        readOnly,
      }),
  };
}

function createNativeServices(
  context: CoreBackendModuleContext,
  host: () => OpenPcbAgentKitHost | undefined,
  readOnly: boolean,
): NativeServices {
  const contextStore = new NativeContextStore(context);
  return {
    contextStore,
    contextResolver: new ContextResolver(context, contextStore),
    prompts: new PromptService(),
    actors: new NativeMcpActors(
      () =>
        host()?.settings.getSettings() ?? {
          mcpEnabled: false,
          mcpAllowWrites: false,
        },
      readOnly,
    ),
    actorScope: "desktop",
    readOnly,
  };
}
