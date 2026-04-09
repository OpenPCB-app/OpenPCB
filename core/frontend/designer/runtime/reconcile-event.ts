import type { DesignInvalidatedEvent } from "../../../backend/designer/contracts/event";
import type { DesignCacheState } from "../state/design-cache.state";

function mergeInvalidated(
  current: Array<"schematic" | "nets">,
  next: Array<"schematic" | "nets">,
): Array<"schematic" | "nets"> {
  return [...new Set([...current, ...next])];
}

export function reconcileEvent(
  state: DesignCacheState,
  event: DesignInvalidatedEvent,
): DesignCacheState {
  const activeDesignId = state.designId ?? state.projection?.designId ?? null;
  if (!activeDesignId || activeDesignId !== event.designId) {
    return state;
  }

  return {
    ...state,
    knownRevision: Math.max(state.knownRevision ?? 0, event.revision),
    staleRevision: Math.max(state.staleRevision ?? 0, event.revision),
    status: state.status === "loading" ? state.status : "stale",
    pendingInvalidated: mergeInvalidated(state.pendingInvalidated, event.invalidated),
  };
}
