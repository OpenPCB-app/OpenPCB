import { useState, useCallback, useRef, useEffect } from "react";
import {
  searchMessages,
  type SearchResult,
  type SearchOptions,
} from "@/lib/api/search-api";

interface UseSearchOptions extends SearchOptions {
  debounceMs?: number;
}

interface UseSearchReturn {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  isLoading: boolean;
  error: Error | null;
  search: (query: string) => Promise<void>;
  clear: () => void;
}

export function useSearch(options: UseSearchOptions = {}): UseSearchReturn {
  const { debounceMs = 300, ...searchOptions } = options;

  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (searchQuery: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
      }

      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setResults([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      abortRef.current = new AbortController();

      try {
        const messages = await searchMessages(trimmed, {
          ...searchOptions,
          signal: abortRef.current.signal,
        });
        setResults(messages);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError(err as Error);
          setResults([]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [searchOptions.workspaceId, searchOptions.chatId, searchOptions.limit],
  );

  const setQuery = useCallback(
    (newQuery: string) => {
      setQueryState(newQuery);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        search(newQuery);
      }, debounceMs);
    },
    [debounceMs, search],
  );

  const clear = useCallback(() => {
    setQueryState("");
    setResults([]);
    setError(null);
    setIsLoading(false);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return {
    query,
    setQuery,
    results,
    isLoading,
    error,
    search,
    clear,
  };
}
