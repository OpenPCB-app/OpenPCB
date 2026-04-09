import type { AppRuntime } from "./runtime";

export interface BackendTarget {
  runtime: AppRuntime;
  backendURL: string;
}
