import {
  createHttpServer,
  DiagnosticsStore,
  ModuleRouterRegistry,
  ModuleRuntime,
} from "./index";
import { MentionRegistry } from "./mentions";
import type { StartedRuntimeServer } from "./http/create-http-server";
import type { ModuleRegistryResponse } from "../contracts/modules/registry";
import type { SecretStore } from "../contracts/credentials/secret-store";
import type { ProviderCredentialAccess } from "../contracts/credentials/renderer";
import { RuntimeSdkRegistry } from "./modules/sdk-registry";
import type { LocalApiSecurityConfig } from "../contracts/security/local-api";

export interface BackendRuntimeOptions {
  host?: string;
  port?: number;
  secretStore?: SecretStore;
  localApi?: LocalApiSecurityConfig;
}

export interface StartedBackendRuntime {
  host: string;
  port: number;
  url: string;
  snapshot: ModuleRegistryResponse;
  providerCredentials?: ProviderCredentialAccess;
  close(): Promise<void>;
}

export async function startBackendRuntime(
  options: BackendRuntimeOptions = {},
): Promise<StartedBackendRuntime> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "3000", 10);

  const diagnosticsStore = new DiagnosticsStore(100);
  const moduleRegistry = new ModuleRouterRegistry();
  MentionRegistry.init();
  const sdkRegistry = new RuntimeSdkRegistry();
  if (options.secretStore)
    sdkRegistry.registerValue("core.secret-store", options.secretStore);
  const moduleRuntime = new ModuleRuntime({ moduleRegistry, sdkRegistry });

  let started: StartedRuntimeServer;
  let snapshot: ModuleRegistryResponse;
  try {
    await moduleRuntime.bootstrap();
    snapshot = moduleRuntime.snapshot();
    const server = createHttpServer({
      host,
      port,
      diagnosticsStore,
      moduleRegistry,
      moduleRuntime,
      localApi: options.localApi,
    });
    started = await server.start();
  } catch (error) {
    try {
      await moduleRuntime.shutdown();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Backend startup and cleanup failed",
      );
    }
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    host: started.hostname,
    port: started.port,
    url: `http://${started.hostname}:${started.port}`,
    snapshot,
    providerCredentials:
      sdkRegistry.get<ProviderCredentialAccess>("core.provider-credentials") ??
      undefined,
    close() {
      closing ??= closeRuntime(started, moduleRuntime);
      return closing;
    },
  };
}

async function closeRuntime(
  server: StartedRuntimeServer,
  modules: ModuleRuntime,
): Promise<void> {
  // SSE can await host cancellation; initiate listener close without awaiting it first.
  let listener: Promise<void>;
  try {
    listener = server.close();
  } catch (error) {
    listener = Promise.reject(error);
  }
  const results = await Promise.allSettled([listener, modules.shutdown()]);
  const errors = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : [],
  );
  if (errors.length)
    throw new AggregateError(errors, "Backend shutdown failed");
}
