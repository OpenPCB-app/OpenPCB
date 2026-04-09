import type { CommandResult } from "../../../backend/designer/contracts/commands/command-result";
import type { DesignCacheState } from "../state/design-cache.state";

function mergeInvalidated(
  current: Array<"schematic" | "nets">,
  next: Array<"schematic" | "nets">,
): Array<"schematic" | "nets"> {
  return [...new Set([...current, ...next])];
}

export function reconcileCommandResult(
  state: DesignCacheState,
  result: CommandResult,
): DesignCacheState {
  if (!result.ok) {
    return {
      ...state,
      designId: result.designId,
      knownRevision: Math.max(state.knownRevision ?? 0, result.serverRevision),
      staleRevision: result.serverRevision,
      status: "conflict",
      conflictServerRevision: result.serverRevision,
      error: null,
    };
  }

  return {
    ...state,
    designId: result.designId,
    knownRevision: result.nextRevision,
    staleRevision: result.nextRevision,
    status: "stale",
    pendingInvalidated: mergeInvalidated(state.pendingInvalidated, result.invalidated),
    conflictServerRevision: null,
    error: null,
  };
}
