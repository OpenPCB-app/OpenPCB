import { useEffect, useState } from "react";
import type { LibraryFacets } from "../../../../sdks/library";

const EMPTY_FACETS: LibraryFacets = {
  source: [],
  family: [],
  package: [],
  mount: [],
  other: [],
  total: 0,
};

interface UseLibraryFacetsOptions {
  backendURL?: string | null;
  moduleId: string;
  query: string;
  /** Pre-sorted comma-joined active filter list (caller memoises). */
  tagsKey: string;
}

interface UseLibraryFacetsResult {
  facets: LibraryFacets;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches `/api/modules/{moduleId}/facets` for the current query + active
 * filter set. Counts are intersection-aware so the sidebar can show useful
 * numbers next to each option as filters get added or removed.
 */
export function useLibraryFacets({
  backendURL,
  moduleId,
  query,
  tagsKey,
}: UseLibraryFacetsOptions): UseLibraryFacetsResult {
  const [facets, setFacets] = useState<LibraryFacets>(EMPTY_FACETS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backendURL) {
      setFacets(EMPTY_FACETS);
      setError("Backend URL unavailable");
      return;
    }
    const url = new URL(`${backendURL}/api/modules/${moduleId}/facets`);
    if (query.trim().length > 0) url.searchParams.set("q", query.trim());
    if (tagsKey.length > 0) url.searchParams.set("tags", tagsKey);

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url.toString(), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Facets request failed (${response.status})`);
        }
        const payload = (await response.json()) as {
          data?: { facets?: LibraryFacets };
        };
        if (!payload.data?.facets) {
          throw new Error("Facets response missing data.facets");
        }
        setFacets(payload.data.facets);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load facets");
        setFacets(EMPTY_FACETS);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [backendURL, moduleId, query, tagsKey]);

  return { facets, loading, error };
}
