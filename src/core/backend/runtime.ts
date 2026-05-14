import {
  createHttpServer,
  DiagnosticsStore,
  ModuleRouterRegistry,
  ModuleRuntime,
} from "./index";
import type { StartedRuntimeServer } from "./http/create-http-server";
import type { ModuleRegistryResponse } from "../contracts/modules/registry";

export interface BackendRuntimeOptions {
  host?: string;
  port?: number;
}

export interface StartedBackendRuntime {
  host: string;
  port: number;
  url: string;
  snapshot: ModuleRegistryResponse;
  close(): Promise<void>;
}

export async function startBackendRuntime(
  options: BackendRuntimeOptions = {},
): Promise<StartedBackendRuntime> {
  const host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "3000", 10);

  const diagnosticsStore = new DiagnosticsStore(100);
  const moduleRegistry = new ModuleRouterRegistry();
  const moduleRuntime = new ModuleRuntime({ moduleRegistry });

  await moduleRuntime.bootstrap();
  const snapshot = moduleRuntime.snapshot();

  const server = createHttpServer({
    host,
    port,
    diagnosticsStore,
    moduleRegistry,
    moduleRuntime,
  });
  const started: StartedRuntimeServer = await server.start();
  const url = `http://${started.hostname}:${started.port}`;

  return {
    host: started.hostname,
    port: started.port,
    url,
    snapshot,
    close: () => started.close(),
  };
}
