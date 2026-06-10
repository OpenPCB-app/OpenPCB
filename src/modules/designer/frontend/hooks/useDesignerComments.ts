import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommentAnchor,
  DesignerCommentCommandEnvelope,
  DesignerCommentSurface,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
} from "../../../../sdks";
import { createDesignerApi } from "../api";

const COMMENT_SESSION_ID = "designer-comment-session";

export function useDesignerComments(params: {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  surface: DesignerCommentSurface;
  cloudHeaders?: () => {
    "x-cloud-bearer"?: string;
    "x-cloud-api-url"?: string;
  };
}) {
  const api = useMemo(
    () =>
      createDesignerApi({
        backendURL: params.backendURL,
        moduleId: params.moduleId,
        cloudHeaders: params.cloudHeaders,
      }),
    [params.backendURL, params.moduleId, params.cloudHeaders],
  );
  const [threads, setThreads] = useState<DesignerCommentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? null,
    [activeThreadId, threads],
  );

  const refresh = useCallback(async () => {
    if (!params.designId) {
      setThreads([]);
      setActiveThreadId(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await api.listCommentThreads(params.designId, params.surface);
      setThreads(next);
      setActiveThreadId((current) =>
        current && next.some((thread) => thread.id === current) ? current : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [api, params.designId, params.surface]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadThread = useCallback(
    async (threadId: string) => {
      if (!params.designId) return null;
      const full = await api.getCommentThread(params.designId, threadId);
      setThreads((current) =>
        current.map((thread) => (thread.id === threadId ? full : thread)),
      );
      setActiveThreadId(threadId);
      return full;
    },
    [api, params.designId],
  );

  const dispatch = useCallback(
    async (threadId: string, baseRevision: number | null, command: DesignerCommentCommandEnvelope["command"]) => {
      if (!params.designId) throw new Error("No design selected");
      const envelope: DesignerCommentCommandEnvelope = {
        commandId: crypto.randomUUID(),
        sessionId: COMMENT_SESSION_ID,
        aggregateId: threadId,
        baseRevision,
        issuedAt: Date.now(),
        command,
      };
      const result = await api.dispatchCommentCommand(params.designId, envelope);
      if (!result.ok) throw new Error(result.detail);
      setThreads((current) => {
        const exists = current.some((thread) => thread.id === result.thread.id);
        if (!exists) return [...current, result.thread];
        return current.map((thread) =>
          thread.id === result.thread.id ? result.thread : thread,
        );
      });
      return result.thread;
    },
    [api, params.designId],
  );

  const createThread = useCallback(
    async (anchor: DesignerCommentAnchor | null, body: string) => {
      const threadId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      const thread = await dispatch(threadId, null, {
        type: "create_thread",
        threadId,
        messageId,
        surface: params.surface,
        anchor,
        body,
      });
      setActiveThreadId(thread.id);
      setCommentMode(false);
      return thread;
    },
    [dispatch, params.surface],
  );

  const addMessage = useCallback(
    async (thread: DesignerCommentThread, body: string) => {
      const next = await dispatch(thread.id, thread.revision, {
        type: "add_message",
        threadId: thread.id,
        messageId: crypto.randomUUID(),
        body,
      });
      await loadThread(next.id);
      return next;
    },
    [dispatch, loadThread],
  );

  const setStatus = useCallback(
    async (thread: DesignerCommentThread, status: DesignerCommentThreadStatus) => {
      return dispatch(thread.id, thread.revision, {
        type: "set_thread_status",
        threadId: thread.id,
        status,
      });
    },
    [dispatch],
  );

  const setTodoStatus = useCallback(
    async (thread: DesignerCommentThread, todoStatus: DesignerCommentTodoStatus) => {
      return dispatch(thread.id, thread.revision, {
        type: "set_thread_todo_status",
        threadId: thread.id,
        todoStatus,
      });
    },
    [dispatch],
  );

  return {
    threads,
    activeThread,
    activeThreadId,
    commentMode,
    loading,
    error,
    refresh,
    loadThread,
    createThread,
    addMessage,
    setStatus,
    setTodoStatus,
    setActiveThreadId,
    setCommentMode,
  };
}
