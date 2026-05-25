import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  ArrowUp,
  MessageSquarePlus,
  MoreHorizontal,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import type {
  AssistantChat,
  AssistantMessage,
  AssistantMessagesPage,
  AssistantPromptPreset,
  AssistantPromptPresetId,
  AssistantProviderConfig,
  AssistantProviderModel,
  AssistantSettings,
  AssistantToolEventDto,
  AssistantWriteProposalDto,
  SubmitAssistantMessageResult,
} from "../../../sdks/assistant";
import type { Task, TaskEvent } from "../../../sdks/tasks";
import { MessageCard } from "./components/MessageCard";
import { ProviderCapabilityBadge } from "./components/ProviderCapabilityBadge";
import { PromptPresetPicker } from "./components/PromptPresetPicker";
import { useAssistantStream } from "./hooks/useAssistantStream";
import { useScrollAnchor, isNearBottom } from "./hooks/useScrollAnchor";
import type { ActiveRunState, ActiveRunStatus } from "./components/AssistantRunStatusCard";

function headers(): HeadersInit {
  return { "content-type": "application/json" };
}

function isUsableChatId(chatId: string | null | undefined): chatId is string {
  return (
    typeof chatId === "string" &&
    chatId.trim().length > 0 &&
    chatId !== "undefined" &&
    chatId !== "null"
  );
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ detail: response.statusText }))) as {
      detail?: string;
      error?: string;
      title?: string;
    };
    throw new Error(
      body.detail ?? body.error ?? body.title ?? `HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export function AssistantSpace({
  backendURL,
  moduleId,
  params,
}: ModuleSpaceProps): ReactElement {
  const base = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/${moduleId}` : null),
    [backendURL, moduleId],
  );
  const tasksBase = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/tasks` : null),
    [backendURL],
  );

  const [chats, setChats] = useState<AssistantChat[]>([]);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<AssistantToolEventDto[]>([]);
  const [writeProposals, setWriteProposals] = useState<AssistantWriteProposalDto[]>([]);
  const [providers, setProviders] = useState<AssistantProviderConfig[]>([]);
  const [models, setModels] = useState<AssistantProviderModel[]>([]);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [presets, setPresets] = useState<AssistantPromptPreset[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [promptPresetId, setPromptPresetId] =
    useState<AssistantPromptPresetId>("strict-grounded");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [activeRunsByChat, setActiveRunsByChat] = useState<Record<string, ActiveRunState>>({});
  const [messagesPage, setMessagesPage] = useState({
    oldestCursor: null as string | null,
    hasMore: false,
    loadingOlder: false,
    initialLoadedChatId: null as string | null,
  });
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    chatId: string;
    x: number;
    y: number;
  } | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const routeChatId = params?.chatId ?? null;
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const scroll = useScrollAnchor();

  const selectedProvider =
    providers.find((provider) => provider.id === providerId) ?? null;
  const filteredChats = chats.filter((chat) =>
    `${chat.title} ${chat.model}`.toLowerCase().includes(query.toLowerCase()),
  );
  const hasPendingAssistantMessage = messages.some(
    (message) =>
      message.role === "assistant" && message.content.trim().length === 0,
  );
  const selectedRun = selectedChatId ? activeRunsByChat[selectedChatId] : undefined;

  const toolEventsByMessage = useMemo(() => {
    const map = new Map<string, AssistantToolEventDto[]>();
    for (const event of toolEvents) {
      if (!event.messageId) continue;
      const arr = map.get(event.messageId) ?? [];
      arr.push(event);
      map.set(event.messageId, arr);
    }
    return map;
  }, [toolEvents]);

  const mergeToolEvents = useCallback((incoming: AssistantToolEventDto[]) => {
    setToolEvents((prev) => {
      const map = new Map(prev.map((event) => [event.id, event]));
      for (const event of incoming) map.set(event.id, event);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const updateRun = useCallback(
    (chatId: string, patch: Partial<ActiveRunState>) => {
      setActiveRunsByChat((prev) => {
        const current = prev[chatId];
        if (!current) return prev;
        return {
          ...prev,
          [chatId]: {
            ...current,
            ...patch,
            lastEventAt: new Date().toISOString(),
          },
        };
      });
    },
    [],
  );

  const refreshChats = useCallback(async () => {
    if (!base) return;
    const data = await api<AssistantChat[]>(`${base}/chats`);
    setChats(data);
    setSelectedChatId((current) => {
      const routeChat = routeChatId && data.some((chat) => chat.id === routeChatId)
        ? routeChatId
        : null;
      const next = routeChat ?? (isUsableChatId(current) && data.some((chat) => chat.id === current)
        ? current
        : (data[0]?.id ?? null));
      activeChatIdRef.current = next;
      return next;
    });
  }, [base, routeChatId]);

  const refreshMessages = useCallback(
    async (chatId: string): Promise<AssistantMessage[]> => {
      if (!base) return [];
      const [page, proposals] = await Promise.all([
        api<AssistantMessagesPage>(`${base}/chats/${chatId}/messages?limit=50`),
        api<AssistantWriteProposalDto[]>(
          `${base}/chats/${chatId}/write-proposals`,
        ).catch(() => [] as AssistantWriteProposalDto[]),
      ]);
      const messageIds = page.items.map((message) => message.id);
      const events = messageIds.length
        ? await api<AssistantToolEventDto[]>(
            `${base}/chats/${chatId}/tool-events?messageIds=${encodeURIComponent(messageIds.join(","))}`,
          ).catch(() => [] as AssistantToolEventDto[])
        : [];
      setMessages(page.items);
      setToolEvents(events);
      setWriteProposals(proposals);
      setMessagesPage({
        oldestCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadingOlder: false,
        initialLoadedChatId: chatId,
      });
      requestAnimationFrame(scroll.scrollToBottom);
      return page.items;
    },
    [base, scroll.scrollToBottom],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!base || !selectedChatId || !messagesPage.hasMore || messagesPage.loadingOlder || !messagesPage.oldestCursor) return;
    setMessagesPage((prev) => ({ ...prev, loadingOlder: true }));
    scroll.captureBeforePrepend();
    try {
      const page = await api<AssistantMessagesPage>(
        `${base}/chats/${selectedChatId}/messages?limit=50&before=${encodeURIComponent(messagesPage.oldestCursor)}`,
      );
      const messageIds = page.items.map((message) => message.id);
      if (messageIds.length > 0) {
        const events = await api<AssistantToolEventDto[]>(
          `${base}/chats/${selectedChatId}/tool-events?messageIds=${encodeURIComponent(messageIds.join(","))}`,
        ).catch(() => [] as AssistantToolEventDto[]);
        mergeToolEvents(events);
      }
      setMessages((prev) => [...page.items, ...prev]);
      setMessagesPage({
        oldestCursor: page.nextCursor,
        hasMore: page.hasMore,
        loadingOlder: false,
        initialLoadedChatId: selectedChatId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessagesPage((prev) => ({ ...prev, loadingOlder: false }));
    }
  }, [base, mergeToolEvents, messagesPage.hasMore, messagesPage.loadingOlder, messagesPage.oldestCursor, scroll, selectedChatId]);

  const refreshConfig = useCallback(async () => {
    if (!base) return;
    const [nextSettings, nextProviders, nextPresets] = await Promise.all([
      api<AssistantSettings>(`${base}/settings`),
      api<AssistantProviderConfig[]>(`${base}/providers`),
      api<AssistantPromptPreset[]>(`${base}/prompt-presets`).catch(
        () => [] as AssistantPromptPreset[],
      ),
    ]);
    setSettings(nextSettings);
    setProviders(nextProviders);
    setPresets(nextPresets);
    setPromptPresetId(nextSettings.defaultPromptPresetId);
    const defaultProvider =
      nextProviders.find(
        (provider) => provider.id === nextSettings.defaultProviderId,
      ) ?? nextProviders[0];
    if (defaultProvider) {
      setProviderId(defaultProvider.id);
      setModel(defaultProvider.defaultModel);
    }
  }, [base]);

  const taskStage = useCallback((task: Task | TaskEvent): { status: ActiveRunStatus; stage: string; error: string | null } => {
    const status = "status" in task ? task.status : undefined;
    switch (status) {
      case "queued":
      case "pending":
        return { status: "queued", stage: "Assistant is queued…", error: null };
      case "running":
        return { status: "running", stage: "Assistant is working…", error: null };
      case "streaming":
        return { status: "streaming", stage: "Writing response…", error: null };
      case "completed":
        return { status: "completed", stage: "Completed", error: null };
      case "failed":
        return { status: "failed", stage: "Assistant stopped before completing.", error: "error" in task ? task.error?.message ?? null : null };
      case "cancelled":
        return { status: "cancelled", stage: "Assistant task cancelled.", error: null };
      case "paused":
        return { status: "paused", stage: "Assistant paused before completing.", error: "error" in task ? task.error?.message ?? null : null };
      default:
        return { status: "running", stage: "Assistant is working…", error: null };
    }
  }, []);

  // Typed SSE consumer
  const stream = useAssistantStream({
    backendUrl: backendURL,
    onChunkText: (ctx, delta) => {
      const near = scroll.scrollRef.current ? isNearBottom(scroll.scrollRef.current) : true;
      setMessages((prev) => {
        const next = prev.map((message) =>
          message.id === ctx.assistantMessageId
            ? { ...message, content: message.content + delta }
            : message,
        );
        return next;
      });
      updateRun(ctx.chatId, { status: "streaming", currentStage: "Writing response…" });
      if (near) requestAnimationFrame(scroll.scrollToBottom);
      else setShowNewMessagesPill(true);
    },
    onTaskEvent: (ctx, event: TaskEvent) => {
      const mapped = taskStage(event);
      updateRun(ctx.chatId, {
        status: mapped.status,
        currentStage: mapped.stage,
        lastError: mapped.error,
      });
    },
    onAiEvent: (ctx, event) => {
      // Re-fetch tool events for the active chat so cards update live.
      if (!base) return;
      if (event.type === "run.tool.requested") {
        updateRun(ctx.chatId, {
          status: "tooling",
          currentStage: "Using OpenPCB tools…",
          activeTools: [
            ...(activeRunsByChat[ctx.chatId]?.activeTools ?? []).filter(
              (tool) => tool.callId !== event.data.toolCallId,
            ),
            { callId: event.data.toolCallId, name: event.data.toolName, status: "requested" },
          ],
        });
      } else if (event.type === "run.tool.running" || event.type === "run.tool.succeeded" || event.type === "run.tool.failed") {
        updateRun(ctx.chatId, {
          status: "tooling",
          currentStage: "Using OpenPCB tools…",
          activeTools: (activeRunsByChat[ctx.chatId]?.activeTools ?? []).map((tool) =>
            tool.callId === event.data.toolCallId
              ? { ...tool, status: event.type.replace("run.tool.", "") }
              : tool,
          ),
        });
      } else if (event.type === "run.completed") {
        updateRun(ctx.chatId, { status: "finalizing", currentStage: "Finalizing answer…" });
      } else if (event.type === "run.failed") {
        updateRun(ctx.chatId, { status: "failed", currentStage: "Assistant stopped before completing.", lastError: event.data.errorMessage });
      }
      void api<AssistantToolEventDto[]>(`${base}/chats/${ctx.chatId}/tool-events`)
        .then(mergeToolEvents)
        .catch(() => undefined);
      void api<AssistantWriteProposalDto[]>(
        `${base}/chats/${ctx.chatId}/write-proposals`,
      )
        .then(setWriteProposals)
        .catch(() => undefined);
    },
    onTerminal: (ctx, status, message) => {
      setLoading(false);
      if (status === "completed") {
        setActiveRunsByChat((prev) => {
          const next = { ...prev };
          delete next[ctx.chatId];
          return next;
        });
      } else {
        updateRun(ctx.chatId, {
          status: status === "cancelled" ? "cancelled" : "failed",
          currentStage: status === "cancelled" ? "Assistant task cancelled." : "Assistant stopped before completing.",
          lastError: message ?? null,
        });
      }
      if (activeChatIdRef.current === ctx.chatId) void refreshMessages(ctx.chatId);
      void refreshChats();
    },
  });
  const openStream = stream.open;

  const restoreActiveTask = useCallback(
    async (chatId: string, pageItems: AssistantMessage[]) => {
      if (!tasksBase) return;
      const latestAssistant = [...pageItems]
        .reverse()
        .find((message) => message.role === "assistant" && message.taskId);
      if (!latestAssistant?.taskId) return;
      const task = await api<Task>(`${tasksBase}/tasks/${latestAssistant.taskId}`).catch(
        () => null,
      );
      if (!task || task.status === "completed") return;
      const mapped = taskStage(task);
      setActiveRunsByChat((prev) => ({
        ...prev,
        [chatId]: {
          chatId,
          taskId: task.id,
          assistantMessageId: latestAssistant.id,
          status: mapped.status,
          currentStage: mapped.stage,
          activeTools: [],
          lastError: mapped.error,
          userMessageContent: "",
          startedAt: task.startedAt ?? task.createdAt,
          lastEventAt: new Date().toISOString(),
        },
      }));
      if (!["failed", "cancelled", "paused"].includes(task.status)) {
        openStream({ chatId, taskId: task.id, assistantMessageId: latestAssistant.id });
      }
    },
    [openStream, taskStage, tasksBase],
  );

  useEffect(() => {
    void Promise.all([refreshConfig(), refreshChats()]).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [refreshChats, refreshConfig]);

  useEffect(() => {
    activeChatIdRef.current = selectedChatId;
    const chat = chats.find((entry) => entry.id === selectedChatId);
    if (chat) {
      setProviderId(chat.providerConfigId);
      setModel(chat.model);
      setPromptPresetId(chat.promptPresetId);
      void refreshMessages(chat.id).then((items) => restoreActiveTask(chat.id, items));
    }
  }, [chats, refreshMessages, restoreActiveTask, selectedChatId]);

  useEffect(() => {
    if (!base || !providerId) return;
    void api<AssistantProviderModel[]>(`${base}/providers/${providerId}/models`)
      .then(setModels)
      .catch(() => setModels([]));
  }, [base, providerId]);

  useEffect(() => {
    if (models.length === 0) return;
    const firstModel = models[0];
    if (firstModel && !models.some((entry) => entry.modelId === model))
      setModel(firstModel.modelId);
  }, [model, models]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    const root = scroll.scrollRef.current;
    const target = topSentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadOlderMessages();
      },
      { root, threshold: 1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadOlderMessages, scroll.scrollRef]);

  useEffect(() => {
    const root = scroll.scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      if (isNearBottom(root)) setShowNewMessagesPill(false);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, [scroll.scrollRef]);

  useLayoutEffect(() => {
    if (messagesPage.initialLoadedChatId === selectedChatId) {
      scroll.restoreAfterPrepend();
    }
  }, [messages.length, messagesPage.initialLoadedChatId, scroll, selectedChatId]);

  const createChat = useCallback(async (): Promise<AssistantChat | null> => {
    if (!base) return null;
    const chat = await api<AssistantChat>(`${base}/chats`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        providerConfigId: providerId || settings?.defaultProviderId,
        model,
        promptPresetId,
      }),
    });
    activeChatIdRef.current = chat.id;
    setChats((prev) => [chat, ...prev]);
    setSelectedChatId(chat.id);
    setMessages([]);
    setToolEvents([]);
    setWriteProposals([]);
    return chat;
  }, [base, model, promptPresetId, providerId, settings?.defaultProviderId]);

  const deleteChat = useCallback(
    async (chatId: string) => {
      if (!base) return;
      const chat = chats.find((entry) => entry.id === chatId);
      if (!window.confirm(`Delete "${chat?.title ?? "chat"}"?`)) return;
      await api<{ ok: true }>(`${base}/chats/${chatId}`, { method: "DELETE" });
      setContextMenu(null);
      await refreshChats();
      if (selectedChatId === chatId) {
        setMessages([]);
        setToolEvents([]);
        setWriteProposals([]);
      }
    },
    [base, chats, refreshChats, selectedChatId],
  );

  const deleteSelectedChats = useCallback(async () => {
    if (!base || selectedChatIds.size === 0) return;
    const chatIds = [...selectedChatIds];
    if (!window.confirm(`Delete ${chatIds.length} selected chat${chatIds.length === 1 ? "" : "s"}?`)) return;
    await api<{ ok: true; deleted: number }>(`${base}/chats/bulk-delete`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ chatIds }),
    });
    setContextMenu(null);
    setSelectedChatIds(new Set());
    await refreshChats();
    if (selectedChatId && selectedChatIds.has(selectedChatId)) {
      setMessages([]);
      setToolEvents([]);
      setWriteProposals([]);
    }
  }, [base, refreshChats, selectedChatId, selectedChatIds]);

  const renameChat = useCallback(
    async (chatId: string) => {
      if (!base) return;
      const chat = chats.find((entry) => entry.id === chatId);
      const title = window.prompt("Rename chat", chat?.title ?? "");
      if (title === null) return;
      const normalized = title.trim();
      if (!normalized) return;
      const updated = await api<AssistantChat>(`${base}/chats/${chatId}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ title: normalized }),
      });
      setContextMenu(null);
      setChats((prev) =>
        prev.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    },
    [base, chats],
  );

  const ensureActiveChat = useCallback(async (): Promise<string> => {
    if (isUsableChatId(activeChatIdRef.current)) return activeChatIdRef.current;
    const chat = await createChat();
    if (!isUsableChatId(chat?.id))
      throw new Error("Unable to create chat before sending message");
    return chat.id;
  }, [createChat]);

  const submit = async (event?: FormEvent, contentOverride?: string) => {
    event?.preventDefault();
    const submittedContent = (contentOverride ?? input).trim();
    if (!base || !submittedContent) return;
    setLoading(true);
    setError(null);
    try {
      const chatId = await ensureActiveChat();
      const result = await api<SubmitAssistantMessageResult>(
        `${base}/chats/${chatId}/messages`,
        {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            content: submittedContent,
            providerConfigId: providerId,
            model,
            promptPresetId,
          }),
        },
      );
      setSelectedChatId(result.chat.id);
      activeChatIdRef.current = result.chat.id;
      setInput("");
      setActiveRunsByChat((prev) => ({
        ...prev,
        [result.chat.id]: {
          chatId: result.chat.id,
          taskId: result.taskId,
          assistantMessageId: result.assistantMessage.id,
          status: "queued",
          currentStage: "Assistant is queued…",
          activeTools: [],
          lastError: null,
          userMessageContent: submittedContent,
          startedAt: new Date().toISOString(),
          lastEventAt: new Date().toISOString(),
        },
      }));
      await refreshMessages(result.chat.id);
      requestAnimationFrame(scroll.scrollToBottom);
      openStream({
        chatId: result.chat.id,
        taskId: result.taskId,
        assistantMessageId: result.assistantMessage.id,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const stopRun = useCallback(
    async (run: ActiveRunState) => {
      if (!tasksBase) return;
      await api<{ ok: true }>(`${tasksBase}/tasks/${run.taskId}/cancel`, {
        method: "POST",
      });
      updateRun(run.chatId, {
        status: "cancelled",
        currentStage: "Assistant task cancelled.",
      });
    },
    [tasksBase, updateRun],
  );

  const retryRunAsNew = useCallback(
    async (run: ActiveRunState) => {
      if (!run.userMessageContent.trim()) return;
      setSelectedChatId(run.chatId);
      activeChatIdRef.current = run.chatId;
      await submit(undefined, run.userMessageContent);
    },
    [submit],
  );

  const chatOnly = Boolean(
    selectedProvider?.capabilities &&
    !selectedProvider.capabilities.toolCalling,
  );

  return (
    <div className="flex h-full min-h-0 bg-slate-950 text-slate-100">
      <aside className="flex w-80 min-w-0 flex-col border-r border-slate-800 bg-slate-900/80">
        <div className="border-b border-slate-800 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold">Assistant</h1>
              <p className="text-xs text-slate-400">
                PCB-aware workspace copilot
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                void createChat().catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="rounded-xl bg-violet-600 p-2 text-white shadow-lg shadow-violet-950/40 hover:bg-violet-500"
              aria-label="New chat"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-400">
            <Search className="h-4 w-4" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
          </div>
          {selectedChatIds.size > 0 ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300">
              <span>{selectedChatIds.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedChatIds(new Set())}
                  className="text-slate-400 hover:text-slate-100"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void deleteSelectedChats().catch((err: unknown) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    )
                  }
                  className="rounded bg-red-950/60 px-2 py-1 font-semibold text-red-200 hover:bg-red-900/70"
                >
                  Delete selected
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-auto p-3">
          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                event.preventDefault();
                setContextMenu({
                  chatId: chat.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              className={`group flex w-full flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors ${
                selectedChatId === chat.id
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <input
                  type="checkbox"
                  checked={selectedChatIds.has(chat.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setSelectedChatIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(chat.id);
                      else next.delete(chat.id);
                      return next;
                    });
                  }}
                  onClick={(event) => event.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-600 bg-slate-950"
                  aria-label={`Select ${chat.title}`}
                />
                <button
                  type="button"
                  onClick={() => setSelectedChatId(chat.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  {activeRunsByChat[chat.id] ? (
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400" />
                  ) : null}
                  <div className="truncate text-sm font-medium">{chat.title}</div>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setContextMenu({ chatId: chat.id, x: event.clientX, y: event.clientY });
                  }}
                  className="rounded p-1 text-slate-600 opacity-0 transition-opacity hover:bg-slate-700 hover:text-slate-200 group-hover:opacity-100"
                  aria-label={`Chat actions for ${chat.title}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedChatId(chat.id)}
                className="truncate text-left text-xs opacity-60"
              >
                {chat.model}
              </button>
            </div>
          ))}
          {filteredChats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-4 text-center text-sm text-slate-500">
              No chats yet.
            </div>
          ) : null}
        </div>
        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
            <Settings className="h-4 w-4" />
            Configure providers in global Settings → Assistant.
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {chats.find((chat) => chat.id === selectedChatId)?.title ??
                "New chat"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PromptPresetPicker
              presets={presets}
              value={promptPresetId}
              onChange={setPromptPresetId}
            />
            <div className="flex h-8 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 shadow-sm transition-colors hover:border-slate-700 focus-within:border-slate-700">
              <select
                value={providerId}
                onChange={(event) => {
                  const provider = providers.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setProviderId(event.target.value);
                  if (provider) setModel(provider.defaultModel);
                }}
                className="max-w-[120px] cursor-pointer truncate bg-transparent text-xs text-slate-300 outline-none hover:text-white"
              >
                {providers
                  .filter((provider) => provider.enabled)
                  .map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
              </select>
              <span className="text-slate-600">/</span>
              {models.length > 0 ? (
                <select
                  value={
                    models.some((entry) => entry.modelId === model)
                      ? model
                      : (models[0]?.modelId ?? "")
                  }
                  onChange={(event) => setModel(event.target.value)}
                  className="max-w-[200px] cursor-pointer truncate bg-transparent text-xs text-slate-300 outline-none hover:text-white"
                >
                  {models.map((entry) => (
                    <option key={entry.modelId} value={entry.modelId}>
                      {entry.displayName ?? entry.modelId}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  className="max-w-[200px] bg-transparent text-xs text-slate-300 outline-none"
                />
              )}
            </div>
            <ProviderCapabilityBadge provider={selectedProvider} />
          </div>
        </div>

        <div ref={scroll.scrollRef} className="relative min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-4xl pb-8 pt-4">
            <div ref={topSentinelRef} className="h-px" />
            {messagesPage.loadingOlder ? (
              <div className="py-2 text-center text-xs text-slate-500">Loading older messages…</div>
            ) : null}
            {chatOnly ? (
              <div className="mx-4 mb-3 rounded-xl border border-amber-900/60 bg-amber-950/20 p-3 text-xs text-amber-200">
                This provider is running without grounded OpenPCB tools. Answers
                will not use library or designer data.
              </div>
            ) : null}
            {error ? (
              <div className="mx-4 mb-4 rounded-xl border border-red-900/70 bg-red-950/30 p-4 text-sm text-red-200">
                {error}
              </div>
            ) : null}
            {messages.length === 0 ? (
              <div className="px-4">
                <EmptyState />
              </div>
            ) : (
              (() => {
                const visible = messages.filter(
                  (message) =>
                    message.role !== "tool" &&
                    message.metadata?.ai?.internal !== true,
                );
                const lastAssistantIdx = (() => {
                  for (let i = visible.length - 1; i >= 0; i--) {
                    if (visible[i]!.role === "assistant") return i;
                  }
                  return -1;
                })();
                return visible.map((message, idx) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    toolEvents={toolEventsByMessage.get(message.id) ?? []}
                    assistantBaseUrl={base}
                    writeProposals={writeProposals}
                    onProposalChanged={() => {
                      if (selectedChatId) void refreshMessages(selectedChatId);
                    }}
                    runState={
                      selectedRun?.assistantMessageId === message.id
                        ? selectedRun
                        : null
                    }
                    onStopRun={(run) => void stopRun(run).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
                    onRetryRun={(run) => void retryRunAsNew(run).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}
                    loading={
                      loading &&
                      idx === lastAssistantIdx &&
                      message.role === "assistant"
                    }
                  />
                ));
              })()
            )}
            {loading && messages.length === 0 ? (
              <MessageCard
                message={{
                  id: "loading",
                  chatId: selectedChatId ?? "",
                  role: "assistant",
                  content: "",
                  toolCallId: null,
                  toolCallsJson: null,
                  toolName: null,
                  taskId: null,
                  metadata: null,
                  createdAt: "",
                  updatedAt: "",
                }}
                loading
                assistantBaseUrl={base}
              />
            ) : null}
          </div>
          {showNewMessagesPill ? (
            <button
              type="button"
              onClick={() => {
                scroll.scrollToBottom();
                setShowNewMessagesPill(false);
              }}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-violet-800 bg-violet-950 px-3 py-1 text-xs text-violet-100 shadow-lg"
            >
              ↓ New messages
            </button>
          ) : null}
        </div>

        <div className="border-t border-slate-800/50 bg-slate-950 p-4">
          <form
            onSubmit={(event) => void submit(event)}
            className="mx-auto max-w-4xl"
          >
            <div className="relative flex items-end rounded-xl border border-slate-700 bg-slate-900 shadow-sm transition-all focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500/50">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleComposerKey}
                placeholder="Ask about your PCB…"
                rows={1}
                className="max-h-64 min-h-[56px] w-full resize-none bg-transparent py-4 pl-4 pr-14 text-sm leading-relaxed outline-none placeholder:text-slate-500"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="absolute bottom-2.5 right-3 flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-500 disabled:bg-slate-800 disabled:text-slate-500"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 text-center text-[10px] text-slate-500">
              Assistant can make mistakes. Verify critical design decisions.
            </div>
          </form>
        </div>
      </main>
      {contextMenu ? (
        <div
          className="fixed z-50 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() =>
              void renameChat(contextMenu.chatId).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
          >
            Rename chat
          </button>
          <button
            type="button"
            onClick={() =>
              void deleteChat(contextMenu.chatId).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }
            className="rounded-lg px-3 py-2 text-sm text-red-300 hover:bg-red-950/40"
          >
            Delete chat
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyState(): ReactElement {
  return (
    <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
      <Sparkles className="mx-auto h-8 w-8 text-violet-300" />
      <h2 className="mt-4 text-lg font-semibold">
        Start a PCB-focused conversation
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Try: <em>"Find a 3.3V regulator for 500mA"</em>
      </p>
    </div>
  );
}
