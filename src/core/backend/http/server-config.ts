import type { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import type { ModuleRouterRegistry } from "../router/module-registry";
import type { ModuleRuntimeSnapshotProvider } from "../modules/module-loader";

export interface HttpServerConfig {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  diagnosticsStore: DiagnosticsStore;
  moduleRegistry?: ModuleRouterRegistry;
  moduleRuntime?: ModuleRuntimeSnapshotProvider;
}
