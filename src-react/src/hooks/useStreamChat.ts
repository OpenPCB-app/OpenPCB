import { useState, useRef, useCallback, useEffect } from "react";
import type { ChatStatus, UIMessage, FileUIPart } from "ai";
import type { ProviderId } from "@shared/types";
import {
  getChatMessages,
  getActiveTask,
  type ActiveTaskInfo,
  getChat,
} from "@/lib/api/chat-api";
import { useBackendURL } from "@/contexts/BackendURLContext";
import type { ModelLoadingState } from "@/stores/model-loading-store";

export type ChatMessage = UIMessage & {
  isError?: boolean;
  branchCount?: number;
  branchIndex?: number;
};
type ToolCallPart = {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args: unknown;
};
type ToolResultPart = {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
};

export interface SubmitMessageRequest {
  chatId: string;
  provider: ProviderId;
  model: string;
  text: string;
  files?: FileUIPart[];
  systemPrompt?: string;
  workspaceId?: string;
  projectId?: string | null;
  spaceId?: string | null;
  toolChoice?: "auto" | "required" | "none";
  allowedTools?: string[];
  activeContext?: {
    workspaceId: string;
    projectId?: string;
    activeTarget?: {
      targetType: string;
      targetId: string;
    };
    selection?: {
      type: "tiptap";
      from: number;
      to: number;
      selectedText?: string;
    };
    knowledgeScope?: {
      rootPageId?: string;
      mentionedPageIds?: string[];
      grantMode?: "exact";
      grantLifetime?: "turn";
    };
  };
}

export interface UseStreamChatReturn {
  messages: ChatMessage[];
  status: ChatStatus;
  error: string | null;
  isLoading: boolean;
  modelLoadingState: ModelLoadingState | null;
  submitMessage: (request: SubmitMessageRequest) => Promise<void>;
  abort: () => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  clearMessages: () => void;
  /** Reset all state (call when switching chats) */
  resetState: () => void;
}

/**
 * Hook to manage AI chat streaming with SSE
 * Handles message state, SSE connection, optimistic UI, and abort capability
 */
export function useStreamChat(): UseStreamChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("ready");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [modelLoadingState, setModelLoadingState] =
    useState<ModelLoadingState | null>(null);

  const { backendURL } = useBackendURL();
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const lastSeqRef = useRef<number>(-1);
  const reconnectAttemptsRef = useRef<number>(0);
  const userAbortRef = useRef(false);
  const recoverFromInterruptedStreamRef = useRef<
    ((chatId: string) => Promise<void>) | null
  >(null);

  const resetStreamTracking = useCallback(() => {
    activeChatIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    lastSeqRef.current = -1;
    reconnectAttemptsRef.current = 0;
    userAbortRef.current = false;
  }, []);

  const ensureAssistantMessage = useCallback((messageId?: string) => {
    const nextId =
      messageId || activeAssistantMessageIdRef.current || crypto.randomUUID();
    activeAssistantMessageIdRef.current = nextId;
    setMessages((prev) => {
      if (prev.some((msg) => msg.id === nextId)) {
        return prev;
      }
      return [
        ...prev,
        {
          id: nextId,
          role: "assistant",
          parts: [],
        },
      ];
    });
    return nextId;
  }, []);

  const appendAssistantText = useCallback((delta: string, seq?: number) => {
    if (typeof seq === "number") {
      if (seq <= lastSeqRef.current) {
        return;
      }
      lastSeqRef.current = seq;
    } else {
      lastSeqRef.current = lastSeqRef.current + 1;
    }

    const targetId = activeAssistantMessageIdRef.current || crypto.randomUUID();
    activeAssistantMessageIdRef.current = targetId;

    setMessages((prev) => {
      const index = prev.findIndex((msg) => msg.id === targetId);
      if (index === -1) {
        return [
          ...prev,
          {
            id: targetId,
            role: "assistant",
            parts: [{ type: "text", text: delta }],
          },
        ];
      }

      const updated = [...prev];
      const lastMsg = updated[index];
      if (!lastMsg || lastMsg.role !== "assistant") return prev;

      const newMsg = { ...lastMsg, parts: [...lastMsg.parts] };
      const textPartIndex = newMsg.parts.findIndex((p) => p.type === "text");
      if (textPartIndex !== -1) {
        const existingPart = newMsg.parts[textPartIndex];
        if (existingPart && existingPart.type === "text") {
          newMsg.parts[textPartIndex] = {
            ...existingPart,
            type: "text",
            text: existingPart.text + delta,
          };
        }
      } else {
        newMsg.parts.push({ type: "text", text: delta });
      }

      updated[index] = newMsg;
      return updated;
    });
  }, []);

  const appendAssistantReasoning = useCallback((delta: string) => {
    const targetId = activeAssistantMessageIdRef.current || crypto.randomUUID();
    activeAssistantMessageIdRef.current = targetId;

    setMessages((prev) => {
      const index = prev.findIndex((msg) => msg.id === targetId);
      if (index === -1) {
        return [
          ...prev,
          {
            id: targetId,
            role: "assistant",
            parts: [{ type: "reasoning", text: delta }],
          },
        ];
      }

      const updated = [...prev];
      const lastMsg = updated[index];
      if (!lastMsg || lastMsg.role !== "assistant") return prev;

      const newMsg = { ...lastMsg, parts: [...lastMsg.parts] };
      const reasoningPartIndex = newMsg.parts.findIndex(
        (p) => p.type === "reasoning",
      );
      if (reasoningPartIndex !== -1) {
        const existingPart = newMsg.parts[reasoningPartIndex];
        if (existingPart && existingPart.type === "reasoning") {
          newMsg.parts[reasoningPartIndex] = {
            ...existingPart,
            type: "reasoning",
            text: existingPart.text + delta,
          };
        }
      } else {
        newMsg.parts.push({ type: "reasoning", text: delta });
      }

      updated[index] = newMsg;
      return updated;
    });
  }, []);

  const appendAssistantPart = useCallback((part: UIMessage["parts"][number]) => {
    const targetId = activeAssistantMessageIdRef.current || crypto.randomUUID();
    activeAssistantMessageIdRef.current = targetId;

    setMessages((prev) => {
      const index = prev.findIndex((msg) => msg.id === targetId);
      if (index === -1) {
        return [
          ...prev,
          {
            id: targetId,
            role: "assistant",
            parts: [part],
          },
        ];
      }

      const updated = [...prev];
      const lastMsg = updated[index];
      if (!lastMsg || lastMsg.role !== "assistant") return prev;

      const newMsg = { ...lastMsg, parts: [...lastMsg.parts, part] };
      updated[index] = newMsg;
      return updated;
    });
  }, []);

  const setAssistantErrorMessage = useCallback((errorMessage: string) => {
    setMessages((prev) => {
      const targetId = activeAssistantMessageIdRef.current;
      const index = targetId
        ? prev.findIndex((msg) => msg.id === targetId)
        : -1;

      if (index !== -1) {
        const updated = [...prev];
        const lastMsg = updated[index]!;
        const errorMsg: ChatMessage = {
          ...lastMsg,
          id: lastMsg.id,
          role: lastMsg.role,
          parts: [{ type: "text" as const, text: errorMessage }],
          isError: true,
        };
        return [
          ...updated.slice(0, index),
          errorMsg,
          ...updated.slice(index + 1),
        ];
      }

      const newErrorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: errorMessage }],
        isError: true,
      };
      return [...prev, newErrorMsg];
    });
  }, []);

  const refreshMessages = useCallback(async (chatId: string) => {
    const msgs = await getChatMessages(chatId);
    setMessages(msgs as UIMessage[]);
  }, []);

  const consumeSseStream = useCallback(
    async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const decoder = new TextDecoder();
      let buffer = "";
      let didComplete = false;
      let modelLoadError = false;
      let shouldStop = false;

      while (!shouldStop) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let data: any;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }

          switch (data.event) {
            case "ping":
              break;

            case "start": {
              if (data.chatId) {
                activeChatIdRef.current = data.chatId;
              }
              if (data.taskId) {
                setTaskId(data.taskId);
              }
              if (data.messageId) {
                ensureAssistantMessage(data.messageId);
              } else {
                ensureAssistantMessage();
              }
              if (!data.replay) {
                setModelLoadingState(null);
              }
              setStatus("streaming");
              break;
            }

            case "replay-start": {
              if (data.taskId) {
                setTaskId(data.taskId);
              }
              setStatus("streaming");
              break;
            }

            case "in-progress": {
              setStatus("streaming");
              break;
            }

            case "task-started": {
              setStatus("streaming");
              break;
            }

            case "model-loading": {
              const state: ModelLoadingState = {
                status: data.status,
                modelName: data.modelName,
                modelSize: data.modelSize,
                vramUsed: data.vramUsed,
                error: data.error,
              };
              setModelLoadingState(state);
              if (data.status === "error") {
                modelLoadError = true;
                setStatus("ready");
                setTaskId(null);
                setAssistantErrorMessage(data.error || "Model loading failed");
                didComplete = true;
                shouldStop = true;
              }
              break;
            }

            case "token":
              if (typeof data.delta === "string") {
                appendAssistantText(data.delta, data.seq);
              }
              break;

            case "reasoning":
              if (typeof data.delta === "string") {
                appendAssistantReasoning(data.delta);
              }
              break;

            case "tool_call": {
              const toolCall = data.toolCall ?? {};
              const toolCallId =
                typeof toolCall.id === "string"
                  ? toolCall.id
                  : typeof data.toolCallId === "string"
                    ? data.toolCallId
                    : null;
              const toolName =
                typeof toolCall.name === "string"
                  ? toolCall.name
                  : typeof data.name === "string"
                    ? data.name
                    : null;
              const toolArgs = toolCall.args ?? data.args;

              if (toolCallId && toolName) {
                const part: ToolCallPart = {
                  type: "tool-call",
                  toolCallId,
                  toolName,
                  args: toolArgs,
                };
                appendAssistantPart(part as unknown as UIMessage["parts"][number]);
              }
              break;
            }

            case "tool_result": {
              const toolName =
                typeof data.toolName === "string" ? data.toolName : null;
              if (typeof data.toolCallId === "string" && typeof toolName === "string") {
                const part: ToolResultPart = {
                  type: "tool-result",
                  toolCallId: data.toolCallId,
                  toolName,
                  result: data.result,
                  isError: Boolean(data.isError),
                };
                appendAssistantPart(part as unknown as UIMessage["parts"][number]);
              }
              break;
            }

            case "done":
              setStatus("ready");
              setTaskId(null);
              setModelLoadingState(null);
              didComplete = true;
              shouldStop = true;
              break;

            case "cancelled": {
              if (data.partial && typeof data.partial === "string") {
                appendAssistantText(data.partial);
              }
              setStatus("ready");
              setTaskId(null);
              didComplete = true;
              shouldStop = true;
              break;
            }

            case "error":
              setStatus("ready");
              setTaskId(null);
              setModelLoadingState(null);
              didComplete = true;
              shouldStop = true;
              setAssistantErrorMessage(data.message || "Stream error");
              break;
          }

          if (shouldStop) break;
        }
      }

      return { didComplete, modelLoadError };
    },
    [
      appendAssistantReasoning,
      appendAssistantText,
      ensureAssistantMessage,
      setAssistantErrorMessage,
    ],
  );

  async function recoverFromInterruptedStream(chatId: string): Promise<void> {
    if (!backendURL) {
      return;
    }

    if (reconnectAttemptsRef.current >= 1) {
      return;
    }

    reconnectAttemptsRef.current += 1;

    try {
      const activeTask = await getActiveTask(chatId);
      if (activeTask) {
        await connectReplayStream(activeTask, false);
        return;
      }

      await refreshMessages(chatId);
    } catch (err) {
      console.warn("[useStreamChat] Failed to recover stream:", err);
    } finally {
      setStatus("ready");
      setTaskId(null);
      setModelLoadingState(null);
    }
  }

  useEffect(() => {
    recoverFromInterruptedStreamRef.current = recoverFromInterruptedStream;
  });

  const connectReplayStream = useCallback(
    async (taskInfo: ActiveTaskInfo, allowRecovery = true) => {
      if (!backendURL) {
        setError("Backend URL not available");
        return;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      userAbortRef.current = false;

      if (taskInfo.assistantMessageId) {
        activeAssistantMessageIdRef.current = taskInfo.assistantMessageId;
      }

      if (taskInfo.waitReason === "model_loading") {
        setModelLoadingState({
          status: "loading",
          modelName: taskInfo.model,
        });
      } else {
        setModelLoadingState(null);
      }

      setTaskId(taskInfo.taskId);
      setStatus("streaming");

      try {
        const response = await fetch(
          `${backendURL}/api/stream/replay/${taskInfo.taskId}?mode=full`,
          { signal: abortController.signal },
        );

        if (!response.ok || !response.body) {
          throw new Error(`Replay failed: ${response.statusText}`);
        }

        const { didComplete, modelLoadError } = await consumeSseStream(
          response.body.getReader(),
        );

        if (
          !didComplete &&
          !modelLoadError &&
          allowRecovery &&
          !userAbortRef.current
        ) {
          const chatId = activeChatIdRef.current;
          if (chatId) {
            await recoverFromInterruptedStreamRef.current?.(chatId);
          }
        }

        if (!modelLoadError && didComplete) {
          setModelLoadingState(null);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("ready");
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Replay failed";
        setAssistantErrorMessage(errorMessage);
        setStatus("ready");
        setTaskId(null);

        if (allowRecovery && !userAbortRef.current) {
          const chatId = activeChatIdRef.current;
          if (chatId) {
            await recoverFromInterruptedStreamRef.current?.(chatId);
          }
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [backendURL, consumeSseStream, setAssistantErrorMessage],
  );

  /**
   * Load existing messages for a chat
   * Also checks for active tasks and reconnects if needed
   */
  const loadMessages = useCallback(
    async (chatId: string) => {
      setIsLoading(true);
      setError(null);
      activeChatIdRef.current = chatId;
      try {
        // First check if there's an active task for this chat
        const activeTask = await getActiveTask(chatId);

        // Load messages first
        await refreshMessages(chatId);

        if (activeTask) {
          console.log(
            `[useStreamChat] Active task found: ${activeTask.taskId}, status: ${activeTask.status}`,
          );
          reconnectAttemptsRef.current = 0;

          if (activeTask.assistantMessageId) {
            activeAssistantMessageIdRef.current = activeTask.assistantMessageId;
          }

          if (activeTask.waitReason === "model_loading" && activeTask.resumeEligible) {
            setModelLoadingState({
              status: "loading",
              modelName: activeTask.model,
            });
          }

          if (activeTask.resumeEligible) {
            await connectReplayStream(activeTask, true);
            return;
          }
        }

        setModelLoadingState(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load messages",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [connectReplayStream, refreshMessages],
  );

  /**
   * Clear all messages
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setStatus("ready");
    resetStreamTracking();
  }, [resetStreamTracking]);

  /**
   * Reset all state (call when switching chats)
   * Aborts any in-progress stream and clears all state
   */
  const resetState = useCallback(() => {
    // Abort any in-progress stream
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    resetStreamTracking();

    // Clear all state
    setMessages([]);
    setStatus("ready");
    setError(null);
    setIsLoading(false);
    setTaskId(null);
    setModelLoadingState(null);
  }, [resetStreamTracking]);

  /**
   * Submit a new message and stream the response
   */
  const submitMessage = useCallback(
    async (request: SubmitMessageRequest) => {
      if (!backendURL) {
        setError("Backend URL not available");
        return;
      }

      setModelLoadingState(null);

      const uploadAttachments = async (files: FileUIPart[] | undefined) => {
        if (!files || files.length === 0) return [] as FileUIPart[];

        let workspaceId = request.workspaceId;
        let projectId = request.projectId;
        let spaceId = request.spaceId;

        if (!workspaceId) {
          try {
            const meta = await getChat(request.chatId);
            workspaceId = meta.workspaceId;
            projectId = projectId ?? meta.projectId ?? undefined;
          } catch (err) {
            throw new Error("Failed to load chat context for file upload");
          }
        }

        const uploadedParts: FileUIPart[] = [];

        for (const part of files) {
          if (part.type !== "file" || !part.url) {
            uploadedParts.push(part);
            continue;
          }

          const blob = await fetch(part.url).then((r) => r.blob());
          const form = new FormData();
          form.append(
            "file",
            new File([blob], part.filename || "upload", {
              type: part.mediaType || blob.type || "application/octet-stream",
            }),
          );
          if (workspaceId) form.append("workspaceId", workspaceId);
          if (projectId) form.append("projectId", projectId);
          if (spaceId) form.append("spaceId", spaceId);

          const resp = await fetch(`${backendURL}/api/files`, {
            method: "POST",
            body: form,
          });
          if (!resp.ok) {
            const msg = await resp.text();
            throw new Error(`File upload failed: ${msg}`);
          }
          const json = await resp.json();
          const fileId = json.data?.file?.id ?? json.file?.id ?? json.id;
          const mime = json.data?.file?.mimeType ?? part.mediaType;
          const filename = json.data?.file?.originalName ?? part.filename;

          uploadedParts.push({
            type: "file",
            url: fileId,
            mediaType: mime,
            filename,
          });
        }

        return uploadedParts;
      };

      let uploadedFiles: FileUIPart[] = [];
      try {
        uploadedFiles = await uploadAttachments(request.files);
      } catch (uploadErr) {
        setError(uploadErr instanceof Error ? uploadErr.message : "Upload failed");
        return;
      }

      // 1. Add user message immediately (optimistic UI)
      const userMessage: UIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: request.text }, ...uploadedFiles],
      };
      setMessages((prev) => [...prev, userMessage]);
      setStatus("submitted");
      setError(null);

      // 2. Start SSE stream
      setStatus("streaming");
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      let modelLoadError = false;
      activeChatIdRef.current = request.chatId;
      activeAssistantMessageIdRef.current = null;
      lastSeqRef.current = -1;
      reconnectAttemptsRef.current = 0;
      userAbortRef.current = false;

      try {
        const streamPayload = {
          chatId: request.chatId,
          provider: request.provider,
          model: request.model,
          text: request.text,
          files: uploadedFiles,
          systemPrompt: request.systemPrompt,
          ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
          ...(request.allowedTools ? { allowedTools: request.allowedTools } : {}),
          ...(request.activeContext ? { activeContext: request.activeContext } : {}),
        };

        const response = await fetch(`${backendURL}/api/stream/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(streamPayload),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Stream failed: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("Stream failed: empty response body");
        }

        const result = await consumeSseStream(response.body.getReader());
        modelLoadError = result.modelLoadError;

        if (
          !result.didComplete &&
          !result.modelLoadError &&
          !userAbortRef.current
        ) {
          await recoverFromInterruptedStreamRef.current?.(request.chatId);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("ready");
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        // We don't set global error anymore, we display it as a message
        setError(null);
        setStatus("ready"); // Reset status so user can try again
        if (!modelLoadError) {
          setModelLoadingState(null); // Clear model loading state on non-load errors
        }
        setAssistantErrorMessage(errorMessage);

        if (!modelLoadError && !userAbortRef.current) {
          await recoverFromInterruptedStreamRef.current?.(request.chatId);
        }
      } finally {
        abortControllerRef.current = null;
      }
    },
    [backendURL, consumeSseStream, setAssistantErrorMessage],
  );

  /**
   * Abort the current stream
   */
  const abort = useCallback(async () => {
    if (!taskId) return;

    userAbortRef.current = true;
    abortControllerRef.current?.abort();

    try {
      if (backendURL) {
        await fetch(`${backendURL}/api/stream/abort/${taskId}`, {
          method: "POST",
        });
      }
    } catch (err) {
      console.error("Failed to abort stream:", err);
    }

    setStatus("ready");
    setTaskId(null);
    setModelLoadingState(null);
  }, [taskId, backendURL]);

  return {
    messages,
    status,
    error,
    isLoading,
    modelLoadingState,
    submitMessage,
    abort,
    loadMessages,
    clearMessages,
    resetState,
  };
}
