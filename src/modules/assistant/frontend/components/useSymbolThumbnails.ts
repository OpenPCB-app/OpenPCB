import { useEffect, useState } from "react";

interface ComponentDetailResponse {
  ok?: boolean;
  data?: { detail?: { symbol?: { id?: string | null } | null } | null } | null;
}

/**
 * Resolve `componentId → symbolId` for placement-proposal thumbnails.
 *
 * Placement DTOs only carry `componentId`, but the symbol preview endpoint
 * (`/symbols/:symbolId/preview.svg`) needs the symbolId — so we fetch the
 * (immutable-cached) component-detail endpoint once per *unique* component.
 * Returns a map keyed by componentId; value is the symbolId, or `null` once a
 * lookup has resolved with no symbol (so callers can fall back to an icon).
 */
export function useSymbolThumbnails(
  componentIds: string[],
  backendURL: string | null | undefined,
): Map<string, string | null> {
  const [map, setMap] = useState<Map<string, string | null>>(() => new Map());
  // Stable dependency: re-run only when the unique id set actually changes.
  const idsKey = [...new Set(componentIds)].sort().join(",");

  useEffect(() => {
    if (!backendURL) return;
    const ids = idsKey ? idsKey.split(",") : [];
    const missing = ids.filter((id) => !map.has(id));
    if (missing.length === 0) return;

    const controller = new AbortController();
    let cancelled = false;

    void Promise.all(
      missing.map(async (id): Promise<[string, string | null]> => {
        try {
          const res = await fetch(
            `${backendURL}/api/modules/library/components/${encodeURIComponent(id)}/detail`,
            { signal: controller.signal },
          );
          if (!res.ok) return [id, null];
          const payload = (await res.json()) as ComponentDetailResponse;
          return [id, payload.data?.detail?.symbol?.id ?? null];
        } catch {
          return [id, null];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setMap((prev) => {
        const next = new Map(prev);
        for (const [id, symbolId] of entries) next.set(id, symbolId);
        return next;
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // `map` is intentionally omitted: idsKey is the only trigger, and reading a
    // stale map only risks a harmless duplicate fetch — never a refetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendURL, idsKey]);

  return map;
}
