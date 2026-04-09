import type { AppRuntime } from "./runtime";
import type { ModuleRegistryResponse } from "../modules/registry";

export type BootstrapStatus = "idle" | "loading" | "ready" | "error";

export interface BootstrapState {
  status: BootstrapStatus;
  runtime: AppRuntime | null;
  backendURL: string | null;
  error: string | null;
  moduleRegistry: ModuleRegistryResponse | null;
}
