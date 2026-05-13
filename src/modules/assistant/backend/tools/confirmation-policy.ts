import type { ToolEffect } from "./tool-registry";

export type ToolExecutionPolicy = "auto_readonly_confirm_writes" | "confirm_all_writes" | "auto_all";

export function requiresConfirmation(policy: ToolExecutionPolicy, effect: ToolEffect): boolean {
  if (policy === "auto_all") return false;
  if (policy === "confirm_all_writes") return effect === "write";
  return effect === "write";
}
