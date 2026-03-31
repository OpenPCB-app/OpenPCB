/**
 * useContentEditor Hook
 *
 * Manages AI-powered content editing with SSE streaming.
 * Handles edit lifecycle: start, stream tokens, apply, rollback, cancel.
 */

import { useState, useCallback, useRef } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";

/**
 * Edit modes supported
 */
export type EditMode = "replace" | "append" | "selection" | "generate";

/**
 * Target reference - identifies content to edit
 */
export interface TargetRef {
  targetType: string;
  targetId: string;
}

/**
 * Selection for selection mode
 */
export interface ContentSelection {
  type: "tiptap";
  from: number;
  to: number;
  selectedText?: string;
}

/**
 * Edit request input
 */
export interface EditContentRequest {
  target: TargetRef;
  mode: EditMode;
  instruction: string;
  selection?: ContentSelection;
  provider: string;
  model: string;
  workspaceId: string;
  projectId?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Edit status
 */
export type EditStatus =
  | "idle"
  | "starting"
  | "streaming"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * SSE event types from content editor
 */
type EditEvent =
  | { event: "start"; editId: string; targetRef: TargetRef; mode: string; snapshotId?: string; lockId?: string }
  | { event: "token"; delta: string }
  | { event: "applied"; appliedAt: number }
  | { event: "done"; editId: string; contentAfter: string; selectionAfter?: string; tokensUsed?: { prompt: number; completion: number; total: number } }
  | { event: "error"; code: string; message: string; retryable: boolean }
  | { event: "cancelled"; rolledBack: boolean; partialContent?: string };

/**
 * Edit result info
 */
export interface EditResult {
  editId: string;
  contentAfter?: string;
  selectionAfter?: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Hook return type
 */
export interface UseContentEditorReturn {
  /** Current edit status */
  status: EditStatus;
  /** Accumulated output text (streamed) */
  streamedText: string;
  /** Error message if failed */
  error: string | null;
  /** Current edit ID */
  editId: string | null;
  /** Result after completion */
  result: EditResult | null;
  /** Start a new edit */
  startEdit: (request: EditContentRequest) => Promise<void>;
  /** Cancel current edit (restores original content) */
  cancel: () => Promise<void>;
  /** Rollback a completed edit */
  rollback: (editId: string) => Promise<boolean>;
  /** Reset state */
  reset: () => void;
  /** Whether an edit is in progress */
  isEditing: boolean;
}

/**
 * Hook for AI-powered content editing
 */
export function useContentEditor(): UseContentEditorReturn {
  const [status, setStatus] = useState<EditStatus>("idle");
  const [streamedText, setStreamedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [result, setResult] = useState<EditResult | null>(null);

  const { backendURL } = useBackendURL();
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentEditIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setStreamedText("");
    setError(null);
    setEditId(null);
    setResult(null);
    currentEditIdRef.current = null;
  }, []);

  /**
   * Parse SSE stream and handle events
   */
  const consumeEditStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let data: EditEvent;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (data.event) {
            case "start":
              setEditId(data.editId);
              currentEditIdRef.current = data.editId;
              setStatus("streaming");
              break;

            case "token":
              if (typeof data.delta === "string") {
                setStreamedText((prev) => prev + data.delta);
              }
              break;

            case "applied":
              setStatus("applying");
              break;

            case "done":
              setStatus("completed");
              setResult({
                editId: data.editId,
                contentAfter: data.contentAfter,
                selectionAfter: data.selectionAfter,
                tokensUsed: data.tokensUsed,
              });
              completed = true;
              break;

            case "error":
              setStatus("failed");
              setError(data.message);
              completed = true;
              break;

            case "cancelled":
              setStatus("cancelled");
              if (data.partialContent) {
                setStreamedText(data.partialContent);
              }
              completed = true;
              break;
          }

          if (completed) break;
        }

        if (completed) break;
      }

      return { completed };
    },
    []
  );

  /**
   * Start an edit operation
   */
  const startEdit = useCallback(
    async (request: EditContentRequest) => {
      if (!backendURL) {
        setError("Backend not available");
        return;
      }

      // Abort any existing edit
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Reset state
      setStatus("starting");
      setStreamedText("");
      setError(null);
      setEditId(null);
      setResult(null);

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch(`${backendURL}/api/content-editor/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Edit failed: ${response.status} ${text}`);
        }

        if (!response.body) {
          throw new Error("Empty response body");
        }

        await consumeEditStream(response.body.getReader());
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("cancelled");
          return;
        }

        const message = err instanceof Error ? err.message : "Edit failed";
        setError(message);
        setStatus("failed");
      } finally {
        abortControllerRef.current = null;
      }
    },
    [backendURL, consumeEditStream]
  );

  /**
   * Cancel the current edit
   */
  const cancel = useCallback(async () => {
    const currentId = currentEditIdRef.current;

    // Abort the fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Call backend to cancel and rollback
    if (backendURL && currentId) {
      try {
        await fetch(`${backendURL}/api/content-editor/cancel/${currentId}`, {
          method: "POST",
        });
      } catch (err) {
        console.error("Failed to cancel edit:", err);
      }
    }

    setStatus("cancelled");
  }, [backendURL]);

  /**
   * Rollback a completed edit
   */
  const rollback = useCallback(
    async (targetEditId: string): Promise<boolean> => {
      if (!backendURL) {
        setError("Backend not available");
        return false;
      }

      try {
        const response = await fetch(
          `${backendURL}/api/content-editor/rollback/${targetEditId}`,
          { method: "POST" }
        );

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Rollback failed: ${response.status} ${text}`);
        }

        // Reset state after rollback
        reset();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Rollback failed";
        setError(message);
        return false;
      }
    },
    [backendURL, reset]
  );

  return {
    status,
    streamedText,
    error,
    editId,
    result,
    startEdit,
    cancel,
    rollback,
    reset,
    isEditing: status === "starting" || status === "streaming" || status === "applying",
  };
}

/**
 * Get list of available content targets from backend
 */
export async function getContentTargets(
  backendURL: string
): Promise<Array<{ targetType: string; label: string; description?: string; supportedModes: EditMode[] }>> {
  const response = await fetch(`${backendURL}/api/content-editor/targets`);
  if (!response.ok) {
    throw new Error(`Failed to fetch targets: ${response.statusText}`);
  }
  const json = await response.json();
  return json.data?.targets ?? [];
}

/**
 * Get edit history for a target
 */
export async function getEditHistory(
  backendURL: string,
  targetType: string,
  targetId: string,
  limit?: number
): Promise<
  Array<{
    editId: string;
    mode: string;
    instruction: string;
    status: string;
    createdAt: string;
  }>
> {
  const params = new URLSearchParams({ targetType, targetId });
  if (limit) params.set("limit", String(limit));

  const response = await fetch(`${backendURL}/api/content-editor/history?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.statusText}`);
  }
  const json = await response.json();
  return json.data?.history ?? [];
}
