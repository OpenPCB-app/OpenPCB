import { useState, useCallback, useRef, useEffect } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";
import { customFetch } from "@/../../src-ts/shared/sdk/mutator";
import type { MentionEntity, MentionSearchResponse } from "@shared/types";

interface UseMentionsOptions {
  workspaceId: string;
  chatId?: string;  // Optional for new chats
  limit?: number;
}

interface UseMentionsReturn {
  suggestions: MentionEntity[];
  isLoading: boolean;
  error: string | null;
  search: (query: string) => Promise<void>;
  clear: () => void;
}

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
}

export function useMentions(options: UseMentionsOptions): UseMentionsReturn {
  const { isReady } = useBackendURL();
  const [suggestions, setSuggestions] = useState<MentionEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track current request to cancel stale ones
  const requestIdRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      requestIdRef.current = -1; // Invalidate any pending requests
    };
  }, []);

  const search = useCallback(
    async (query: string) => {
      // Wait for backend to be ready
      if (!isReady) {
        setError("Backend not ready");
        return;
      }

      // Cancel any previous request
      const currentRequestId = ++requestIdRef.current;

      setIsLoading(true);
      setError(null);

      try {
        const response = await customFetch<ApiResponse<MentionSearchResponse>>(
          "/api/mentions/search",
          {
            method: "POST",
            body: JSON.stringify({
              query,
              workspaceId: options.workspaceId,
              ...(options.chatId && { chatId: options.chatId }),  // Only include if present
              limit: options.limit ?? 10,
            }),
          },
        );

        // Check if this request is still relevant
        if (requestIdRef.current !== currentRequestId) {
          return; // Stale request, ignore
        }

        if (response.ok && response.data) {
          setSuggestions(response.data.results);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        // Only set error if this request is still relevant
        if (requestIdRef.current === currentRequestId) {
          setError(err instanceof Error ? err.message : "Search failed");
          setSuggestions([]);
        }
      } finally {
        // Only update loading if this request is still relevant
        if (requestIdRef.current === currentRequestId) {
          setIsLoading(false);
        }
      }
    },
    [isReady, options.workspaceId, options.chatId, options.limit],
  );

  const clear = useCallback(() => {
    requestIdRef.current++; // Cancel any pending request
    setSuggestions([]);
    setError(null);
  }, []);

  return { suggestions, isLoading, error, search, clear };
}
