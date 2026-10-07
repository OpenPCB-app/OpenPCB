import type { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import type { ModuleRouterRegistry } from "../router/module-registry";
import type { ModuleRuntimeSnapshotProvider } from "../modules/module-loader";
import type { LocalApiSecurityConfig } from "../../contracts/security/local-api";

export interface HttpServerConfig {
  host?: string;
  port?: number;
  allowedOrigins?: string[];
  localApi?: LocalApiSecurityConfig;
  diagnosticsStore: DiagnosticsStore;
  moduleRegistry?: ModuleRouterRegistry;
  moduleRuntime?: ModuleRuntimeSnapshotProvider;
}
