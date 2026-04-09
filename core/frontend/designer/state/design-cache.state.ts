import type { SchematicProjection } from "../../../backend/designer/contracts/projection";

export interface DesignCacheState {
  designId: string | null;
  projection: SchematicProjection | null;
  knownRevision: number | null;
  staleRevision: number | null;
  status: "idle" | "loading" | "ready" | "stale" | "conflict" | "error";
  pendingInvalidated: Array<"schematic" | "nets">;
  conflictServerRevision: number | null;
  error: string | null;
}

export function createInitialDesignCacheState(): DesignCacheState {
  return {
    designId: null,
    projection: null,
    knownRevision: null,
    staleRevision: null,
    status: "idle",
    pendingInvalidated: [],
    conflictServerRevision: null,
    error: null,
  };
}

export function beginProjectionLoad(
  state: DesignCacheState,
  designId: string,
): DesignCacheState {
  return {
    ...state,
    designId,
    status: "loading",
    error: null,
  };
}

export function completeProjectionLoad(
  state: DesignCacheState,
  projection: SchematicProjection,
): DesignCacheState {
  const knownRevision = Math.max(state.knownRevision ?? 0, projection.revision);
  const staleRevision = state.staleRevision;
  const isStale = staleRevision !== null && projection.revision < staleRevision;

  return {
    ...state,
    designId: projection.designId,
    projection,
    knownRevision,
    staleRevision: isStale ? staleRevision : null,
    status: isStale ? "stale" : "ready",
    pendingInvalidated: isStale ? state.pendingInvalidated : [],
    conflictServerRevision: null,
    error: null,
  };
}

export function failProjectionLoad(
  state: DesignCacheState,
  error: string,
): DesignCacheState {
  return {
    ...state,
    status: "error",
    error,
  };
}
