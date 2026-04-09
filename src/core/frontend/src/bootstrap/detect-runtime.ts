import type { AppRuntime } from "../../../contracts/app/runtime";

export function detectRuntime(): AppRuntime {
  if (typeof window !== "undefined" && window.electronAPI) {
    return "electron";
  }
  return "web";
}
