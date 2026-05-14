import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryTagStat } from "../../../../sdks/library";

interface UseLibraryTagsArgs {
  backendURL?: string | null;
  moduleId: string;
  excludeSystem?: boolean;
  /** Bump to force a refetch from the caller (e.g. after a successful PATCH). */
  refreshToken?: number;
}

export interface UseLibraryTagsResult {
  tags: LibraryTagStat[];
  byName: Map<string, LibraryTagStat>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface TagsResponse {
  ok?: boolean;
  data?: { tags?: unknown };
}

function parseTags(payload: unknown): LibraryTagStat[] {
  if (!payload || typeof payload !== "object") return [];
  const body = payload as TagsResponse;
  const raw = body.data?.tags;
  if (!Array.isArray(raw)) return [];
  const out: LibraryTagStat[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const tag = (entry as { tag?: unknown }).tag;
    const count = (entry as { count?: unknown }).count;
    if (typeof tag !== "string" || typeof count !== "number") continue;
    out.push({ tag, count });
  }
  return out;
}

/**
 * Fetches `/api/modules/{moduleId}/tags` (works for both library and designer
 * proxies — designer mounts the proxy at `/library/tags` so callers pass
 * `${moduleId}/library` when using it from the designer module).
 */
export function useLibraryTags({
  backendURL,
  moduleId,
  excludeSystem = false,
  refreshToken = 0,
}: UseLibraryTagsArgs): UseLibraryTagsResult {
  const [tags, setTags] = useState<LibraryTagStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTick, setLocalTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    setLocalTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    if (!backendURL) return;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const url = new URL(
      `${backendURL}/api/modules/${moduleId}/tags`.replace(/\/+$/, ""),
    );
    if (excludeSystem) {
      url.searchParams.set("excludeSystem", "true");
    }

    setLoading(true);
    setError(null);
    fetch(url.toString(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json() as Promise<unknown>;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setTags(parseTags(body));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Failed to load tags";
        setError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [backendURL, moduleId, excludeSystem, refreshToken, localTick]);

  const byName = useMemo(() => {
    const map = new Map<string, LibraryTagStat>();
    for (const stat of tags) {
      map.set(stat.tag, stat);
    }
    return map;
  }, [tags]);

  return { tags, byName, loading, error, refresh };
}
