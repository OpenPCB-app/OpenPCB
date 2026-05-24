import { useCallback, useEffect, useRef, useState } from "react";
import type { AiRunEvent } from "@openpcb/ai-core";

export type StreamStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export interface AssistantStreamState {
  status: StreamStatus;
  events: AiRunEvent[];
  lastError: string | null;
}

interface UseAssistantStreamOptions {
  backendUrl: string | null | undefined;
  onChunkText?: (delta: string) => void;
  onAiEvent?: (event: AiRunEvent) => void;
  onTerminal?: (status: Exclude<StreamStatus, "idle" | "streaming">) => void;
}

interface ParsedChunkData {
  content?: string;
  kind?: "text" | "log" | "json" | "binary-ref";
}

/**
 * Typed SSE consumer for assistant task streams. Parses kind:'json' chunks as
 * AiRunEvent envelopes ({_aiEvent: ...}) and dispatches them via onAiEvent.
 * Text deltas (kind:'text') fire onChunkText.
 */
export function useAssistantStream(options: UseAssistantStreamOptions) {
  const { backendUrl, onChunkText, onAiEvent, onTerminal } = options;
  const [state, setState] = useState<AssistantStreamState>({
    status: "idle",
    events: [],
    lastError: null,
  });
  const streamRef = useRef<EventSource | null>(null);
  const handlersRef = useRef({ onChunkText, onAiEvent, onTerminal });
  handlersRef.current = { onChunkText, onAiEvent, onTerminal };

  const close = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
  }, []);

  const open = useCallback(
    (taskId: string) => {
      if (!backendUrl) return;
      close();
      const stream = new EventSource(
        `${backendUrl}/api/modules/tasks/tasks/${taskId}/stream`,
      );
      streamRef.current = stream;
      setState({ status: "streaming", events: [], lastError: null });

      const finish = (
        status: Exclude<StreamStatus, "idle" | "streaming">,
        message: string | null = null,
      ) => {
        setState((prev) => ({ ...prev, status, lastError: message }));
        handlersRef.current.onTerminal?.(status);
        close();
      };

      stream.addEventListener("task.chunk", (event) => {
        const messageEvent = event as MessageEvent<string>;
        try {
          const payload = JSON.parse(messageEvent.data) as {
            data?: ParsedChunkData;
          };
          const chunk = payload.data;
          if (!chunk) return;
          if (chunk.kind === "text" && typeof chunk.content === "string") {
            handlersRef.current.onChunkText?.(chunk.content);
            return;
          }
          if (chunk.kind === "json" && typeof chunk.content === "string") {
            try {
              const parsed = JSON.parse(chunk.content) as {
                _aiEvent?: AiRunEvent;
              };
              if (parsed._aiEvent) {
                setState((prev) => ({
                  ...prev,
                  events: [...prev.events, parsed._aiEvent!],
                }));
                handlersRef.current.onAiEvent?.(parsed._aiEvent);
              }
            } catch {
              // ignore non-AiRunEvent json
            }
          }
        } catch {
          // ignore malformed
        }
      });

      stream.addEventListener("task.completed", () => finish("completed"));
      stream.addEventListener("task.failed", (event) =>
        finish("failed", (event as MessageEvent<string>).data ?? "Task failed"),
      );
      stream.addEventListener("task.cancelled", () => finish("cancelled"));
      stream.addEventListener("task.paused", () => finish("cancelled"));
      stream.onerror = () => finish("failed", "Stream error");
    },
    [backendUrl, close],
  );

  useEffect(() => () => close(), [close]);

  return { state, open, close };
}
