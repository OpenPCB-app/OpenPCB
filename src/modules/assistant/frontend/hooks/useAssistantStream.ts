import { useCallback, useEffect, useRef, useState } from "react";
import type { AiRunEvent } from "@openpcb/ai-core";
import type { Task, TaskEvent } from "../../../../sdks/tasks";

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
  onChunkText?: (ctx: StreamContext, delta: string) => void;
  onAiEvent?: (ctx: StreamContext, event: AiRunEvent) => void;
  onTaskEvent?: (ctx: StreamContext, event: TaskEvent) => void;
  onTerminal?: (
    ctx: StreamContext,
    status: Exclude<StreamStatus, "idle" | "streaming">,
    message?: string | null,
  ) => void;
}

export interface StreamContext {
  chatId: string;
  taskId: string;
  assistantMessageId: string;
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
  const { backendUrl, onChunkText, onAiEvent, onTaskEvent, onTerminal } = options;
  const [state, setState] = useState<AssistantStreamState>({
    status: "idle",
    events: [],
    lastError: null,
  });
  const streamRef = useRef<EventSource | null>(null);
  const handlersRef = useRef({ onChunkText, onAiEvent, onTaskEvent, onTerminal });
  handlersRef.current = { onChunkText, onAiEvent, onTaskEvent, onTerminal };
  const retryTimersRef = useRef<number[]>([]);

  const close = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    retryTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    retryTimersRef.current = [];
  }, []);

  const open = useCallback(
    (ctx: StreamContext, attempt = 0) => {
      if (!backendUrl) return;
      if (attempt === 0) close();
      const stream = new EventSource(
        `${backendUrl}/api/modules/tasks/tasks/${ctx.taskId}/stream`,
      );
      streamRef.current = stream;
      if (attempt === 0)
        setState({ status: "streaming", events: [], lastError: null });

      const finish = (
        status: Exclude<StreamStatus, "idle" | "streaming">,
        message: string | null = null,
      ) => {
        setState((prev) => ({ ...prev, status, lastError: message }));
        handlersRef.current.onTerminal?.(ctx, status, message);
        close();
      };

      const checkAndMaybeReconnect = async () => {
        try {
          const response = await fetch(
            `${backendUrl}/api/modules/tasks/tasks/${ctx.taskId}`,
          );
          const task = (await response.json()) as Task;
          const status = task.status;
          if (status === "completed") return finish("completed");
          if (status === "failed") return finish("failed", task.error?.message ?? "Task failed");
          if (status === "cancelled") return finish("cancelled");
          if (attempt >= 2) {
            setState((prev) => ({ ...prev, status: "failed", lastError: "Stream disconnected" }));
            handlersRef.current.onTerminal?.(ctx, "failed", "Stream disconnected");
            return;
          }
          const delays = [500, 1000, 2000];
          const timer = window.setTimeout(() => open(ctx, attempt + 1), delays[attempt]);
          retryTimersRef.current.push(timer);
        } catch {
          if (attempt >= 2) return finish("failed", "Stream error");
          const delays = [500, 1000, 2000];
          const timer = window.setTimeout(() => open(ctx, attempt + 1), delays[attempt]);
          retryTimersRef.current.push(timer);
        }
      };

      const handleTaskEvent = (event: MessageEvent<string>) => {
        try {
          const payload = JSON.parse(event.data) as TaskEvent;
          handlersRef.current.onTaskEvent?.(ctx, payload);
        } catch {
          // ignore malformed task event
        }
      };

      ["task.created", "task.queued", "task.started", "task.streaming", "task.progress"].forEach((type) => {
        stream.addEventListener(type, handleTaskEvent);
      });

      stream.addEventListener("task.chunk", (event) => {
        const messageEvent = event as MessageEvent<string>;
        handleTaskEvent(messageEvent);
        try {
          const payload = JSON.parse(messageEvent.data) as {
            data?: ParsedChunkData;
          };
          const chunk = payload.data;
          if (!chunk) return;
          if (chunk.kind === "text" && typeof chunk.content === "string") {
            handlersRef.current.onChunkText?.(ctx, chunk.content);
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
                handlersRef.current.onAiEvent?.(ctx, parsed._aiEvent);
              }
            } catch {
              // ignore non-AiRunEvent json
            }
          }
        } catch {
          // ignore malformed
        }
      });

      stream.addEventListener("task.completed", (event) => {
        handleTaskEvent(event as MessageEvent<string>);
        finish("completed");
      });
      stream.addEventListener("task.failed", (event) => {
        handleTaskEvent(event as MessageEvent<string>);
        finish("failed", "Task failed");
      });
      stream.addEventListener("task.cancelled", (event) => {
        handleTaskEvent(event as MessageEvent<string>);
        finish("cancelled");
      });
      stream.addEventListener("task.paused", (event) => {
        handleTaskEvent(event as MessageEvent<string>);
        finish("failed", "Task paused");
      });
      stream.onerror = () => {
        stream.close();
        void checkAndMaybeReconnect();
      };
    },
    [backendUrl, close],
  );

  useEffect(() => () => close(), [close]);

  return { state, open, close };
}
