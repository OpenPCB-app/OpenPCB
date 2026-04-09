import { useEffect, useMemo, useState, type ReactElement } from "react";

interface ComponentLibraryPart {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  footprintId: string;
  tags: string[];
}

interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
}

export function ComponentLibrarySpace({
  moduleId,
  namespace,
  backendURL,
}: ModuleSpaceProps): ReactElement {
  const [query, setQuery] = useState("");
  const [parts, setParts] = useState<ComponentLibraryPart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchUrl = useMemo(() => {
    if (!backendURL) {
      return null;
    }
    const url = new URL(`${backendURL}/api/modules/component-library/parts`);
    if (query.trim().length > 0) {
      url.searchParams.set("q", query.trim());
    }
    url.searchParams.set("limit", "50");
    return url.toString();
  }, [backendURL, query]);

  useEffect(() => {
    if (!searchUrl) {
      setParts([]);
      setError("Backend URL unavailable");
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
          data?: { parts?: ComponentLibraryPart[] };
        };
        setParts(payload.data?.parts ?? []);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load parts");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void run();

    return () => controller.abort();
  }, [searchUrl]);

  return (
    <div className="h-full w-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Component Library
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {moduleId} · {namespace}
            </p>
          </div>

          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search parts"
            className="w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Parts</h2>
          {loading && (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Loading...</p>
          )}
          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {!loading && !error && parts.length === 0 && (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No parts found.</p>
          )}

          {!loading && !error && parts.length > 0 && (
            <ul className="mt-3 space-y-2">
              {parts.map((part) => (
                <li
                  key={part.id}
                  className="rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                      {part.name}
                    </p>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{part.id}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    {part.description}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    symbol: {part.symbolId} · footprint: {part.footprintId}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
