import { useState, useCallback } from "react";
import { useBackendURL } from "@/contexts/BackendURLContext";

export interface EditMessageResponse {
  newMessageId: string;
  chatId: string;
  branchIndex: number;
  taskId: string;
}

export interface ResendMessageResponse {
  taskId: string;
  messageId: string;
  status: string;
}

export interface RegenerateMessageResponse {
  newMessageId: string;
  chatId: string;
  branchIndex: number;
  taskId: string;
}

export interface MessageActionLoadingState {
  editing: boolean;
  resending: boolean;
  regenerating: boolean;
}

export type MessageActionKind = "edit" | "resend" | "regenerate";

export interface UseMessageActionsReturn {
  loading: MessageActionLoadingState;
  isBusy: boolean;
  activeAction: MessageActionKind | null;
  activeMessageId: string | null;
  error: string | null;
  clearError: () => void;
  editMessage: (
    messageId: string,
    content: string,
  ) => Promise<EditMessageResponse>;
  resendMessage: (messageId: string) => Promise<ResendMessageResponse>;
  regenerateMessage: (messageId: string) => Promise<RegenerateMessageResponse>;
}

const INITIAL_LOADING_STATE: MessageActionLoadingState = {
  editing: false,
  resending: false,
  regenerating: false,
};

function sanitizeErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim();
}

async function extractErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const json = (await response.json()) as {
      error?: { message?: string };
    };
    const apiMessage = json?.error?.message;
    if (typeof apiMessage === "string" && apiMessage.trim().length > 0) {
      return sanitizeErrorMessage(apiMessage);
    }
  } catch {
    // Ignore parse errors and fall back.
  }
  return fallback;
}

export function useMessageActions(): UseMessageActionsReturn {
  const [loading, setLoading] = useState<MessageActionLoadingState>(
    INITIAL_LOADING_STATE,
  );
  const [activeAction, setActiveAction] = useState<MessageActionKind | null>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { backendURL, isReady } = useBackendURL();
  const isBusy = activeAction !== null;

  const setActionLoading = useCallback(
    (action: MessageActionKind, value: boolean) => {
      setLoading((prev) => ({
        ...prev,
        editing: action === "edit" ? value : prev.editing,
        resending: action === "resend" ? value : prev.resending,
        regenerating: action === "regenerate" ? value : prev.regenerating,
      }));
    },
    [],
  );

  const beginAction = useCallback(
    (action: MessageActionKind, messageId: string) => {
      if (activeAction && (activeAction !== action || activeMessageId !== messageId)) {
        throw new Error("Another message action is already in progress");
      }
      if (activeAction === action && activeMessageId === messageId) {
        throw new Error("This action is already in progress");
      }

      setError(null);
      setActiveAction(action);
      setActiveMessageId(messageId);
      setActionLoading(action, true);
    },
    [activeAction, activeMessageId, setActionLoading],
  );

  const endAction = useCallback(
    (action: MessageActionKind) => {
      setActionLoading(action, false);
      setActiveAction(null);
      setActiveMessageId(null);
    },
    [setActionLoading],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const editMessage = useCallback(
    async (messageId: string, content: string): Promise<EditMessageResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");
      const trimmed = content.trim();
      if (!trimmed) {
        throw new Error("Message content cannot be empty");
      }

      try {
        beginAction("edit", messageId);
        const res = await fetch(`${backendURL}/api/messages/${messageId}/edit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: trimmed }),
        });

        if (!res.ok) {
          const apiError = await extractErrorMessage(
            res,
            "Failed to edit message",
          );
          throw new Error(apiError);
        }

        const json = (await res.json()) as {
          data?: EditMessageResponse;
        };
        if (!json.data) {
          throw new Error("Invalid response from edit API");
        }
        return json.data;
      } catch (err) {
        const message =
          err instanceof Error ? sanitizeErrorMessage(err.message) : "Failed to edit message";
        setError(message);
        throw new Error(message);
      } finally {
        endAction("edit");
      }
    },
    [backendURL, beginAction, endAction, isReady],
  );

  const resendMessage = useCallback(
    async (messageId: string): Promise<ResendMessageResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        beginAction("resend", messageId);
        const res = await fetch(
          `${backendURL}/api/messages/${messageId}/resend`,
          {
            method: "POST",
          },
        );

        if (!res.ok) {
          const apiError = await extractErrorMessage(
            res,
            "Failed to resend message",
          );
          throw new Error(apiError);
        }

        const json = (await res.json()) as {
          data?: ResendMessageResponse;
        };
        if (!json.data) {
          throw new Error("Invalid response from resend API");
        }
        return json.data;
      } catch (err) {
        const message =
          err instanceof Error
            ? sanitizeErrorMessage(err.message)
            : "Failed to resend message";
        setError(message);
        throw new Error(message);
      } finally {
        endAction("resend");
      }
    },
    [backendURL, beginAction, endAction, isReady],
  );

  const regenerateMessage = useCallback(
    async (messageId: string): Promise<RegenerateMessageResponse> => {
      if (!isReady || !backendURL) throw new Error("Backend not ready");

      try {
        beginAction("regenerate", messageId);
        const res = await fetch(
          `${backendURL}/api/messages/${messageId}/regenerate`,
          {
            method: "POST",
          },
        );

        if (!res.ok) {
          const apiError = await extractErrorMessage(
            res,
            "Failed to regenerate message",
          );
          throw new Error(apiError);
        }

        const json = (await res.json()) as {
          data?: RegenerateMessageResponse;
        };
        if (!json.data) {
          throw new Error("Invalid response from regenerate API");
        }
        return json.data;
      } catch (err) {
        const message =
          err instanceof Error
            ? sanitizeErrorMessage(err.message)
            : "Failed to regenerate message";
        setError(message);
        throw new Error(message);
      } finally {
        endAction("regenerate");
      }
    },
    [backendURL, beginAction, endAction, isReady],
  );

  return {
    loading,
    isBusy,
    activeAction,
    activeMessageId,
    error,
    clearError,
    editMessage,
    resendMessage,
    regenerateMessage,
  };
}
