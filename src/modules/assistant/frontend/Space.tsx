import {
  Fragment,
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
  Archive,
  ChevronDown,
  Download,
  Link2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  X,
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
import { ModelSelectorPill } from "./components/ModelSelectorPill";
import { ChatComposer } from "./components/ChatComposer";
import { useChatUserState } from "./components/useChatUserState";
import { useNavigationStore } from "../../../core/frontend/src/stores/navigation-store";
import {
  contextBudgetKb,
  dateDividerLabel,
  dayKey,
  relativeTime,
} from "./components/chat-format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";

const QUICK_ACTIONS = [
  "Wire the schematic",
  "Resolve BOM",
  "Run ERC",
  "Suggest improvements",
];

/** Reads a chat's linked design (set on design-scoped chats via metadata). */
function linkedDesign(
  chat: AssistantChat | undefined,
): { id: string; name: string } | null {
  const meta = chat?.metadata as
    | { designId?: unknown; designName?: unknown }
    | null
    | undefined;
  if (meta && typeof meta.designId === "string") {
    return {
      id: meta.designId,
      name:
        typeof meta.designName === "string" ? meta.designName : meta.designId,
    };
  }
  return null;
}
import { useAssistantStream } from "./hooks/useAssistantStream";
import { useScrollAnchor, isNearBottom } from "./hooks/useScrollAnchor";
import type {
  ActiveRunState,
  ActiveRunStatus,
} from "./components/AssistantRunStatusCard";

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
  const [writeProposals, setWriteProposals] = useState<
    AssistantWriteProposalDto[]
  >([]);
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
  const [activeRunsByChat, setActiveRunsByChat] = useState<
    Record<string, ActiveRunState>
  >({});
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
  const [filter, setFilter] = useState<
    "all" | "pinned" | "linked" | "archived"
  >("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleCommitting, setTitleCommitting] = useState(false);
  const userState = useChatUserState();
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);
  const activeChatIdRef = useRef<string | null>(null);
  const routeChatId = params?.chatId ?? null;
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const scroll = useScrollAnchor();

  const selectedProvider =
    providers.find((provider) => provider.id === providerId) ?? null;
  const chatCounts = useMemo(() => {
    const active = chats.filter((c) => !userState.isArchived(c.id));
    return {
      all: active.length,
      pinned: active.filter((c) => userState.isPinned(c.id)).length,
      linked: active.filter((c) => linkedDesign(c)).length,
      archived: chats.filter((c) => userState.isArchived(c.id)).length,
    };
  }, [chats, userState]);

  const filteredChats = useMemo(() => {
    const q = query.toLowerCase();
    return chats
      .filter((chat) => {
        const archived = userState.isArchived(chat.id);
        if (filter === "archived") {
          if (!archived) return false;
        } else if (archived) {
          return false;
        } else if (filter === "pinned" && !userState.isPinned(chat.id)) {
          return false;
        } else if (filter === "linked" && !linkedDesign(chat)) {
          return false;
        }
        return q ? chat.title.toLowerCase().includes(q) : true;
      })
      .sort((a, b) => {
        const pa = userState.isPinned(a.id) ? 1 : 0;
        const pb = userState.isPinned(b.id) ? 1 : 0;
        if (pa !== pb) return pb - pa;
        return (b.lastMessageAt ?? b.updatedAt).localeCompare(
          a.lastMessageAt ?? a.updatedAt,
        );
      });
  }, [chats, query, filter, userState]);

  const selectedChat = chats.find((c) => c.id === selectedChatId) ?? null;
  const selectedLinked = linkedDesign(selectedChat ?? undefined);

  useEffect(() => {
    if (!base) return;
    void api<unknown[]>(`${base}/tools`)
      .then((tools) => setToolCount(Array.isArray(tools) ? tools.length : null))
      .catch(() => setToolCount(null));
  }, [base]);
  const hasPendingAssistantMessage = messages.some(
    (message) =>
      message.role === "assistant" && message.content.trim().length === 0,
  );
  const selectedRun = selectedChatId
    ? activeRunsByChat[selectedChatId]
    : undefined;

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
      return [...map.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
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
      const routeChat =
        routeChatId && data.some((chat) => chat.id === routeChatId)
          ? routeChatId
          : null;
      const next =
        routeChat ??
        (isUsableChatId(current) && data.some((chat) => chat.id === current)
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
      // Drop stale results: the user may have switched chats while these requests
      // were in flight — applying them would clobber the now-active chat's view.
      if (activeChatIdRef.current !== chatId) return page.items;
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
    if (
      !base ||
      !selectedChatId ||
      !messagesPage.hasMore ||
      messagesPage.loadingOlder ||
      !messagesPage.oldestCursor
    )
      return;
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
  }, [
    base,
    mergeToolEvents,
    messagesPage.hasMore,
    messagesPage.loadingOlder,
    messagesPage.oldestCursor,
    scroll,
    selectedChatId,
  ]);

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

  const taskStage = useCallback(
    (
      task: Task | TaskEvent,
    ): { status: ActiveRunStatus; stage: string; error: string | null } => {
      const status = "status" in task ? task.status : undefined;
      switch (status) {
        case "queued":
        case "pending":
          return {
            status: "queued",
            stage: "Assistant is queued…",
            error: null,
          };
        case "running":
          return {
            status: "running",
            stage: "Assistant is working…",
            error: null,
          };
        case "streaming":
          return {
            status: "streaming",
            stage: "Writing response…",
            error: null,
          };
        case "completed":
          return { status: "completed", stage: "Completed", error: null };
        case "failed":
          return {
            status: "failed",
            stage: "Assistant stopped before completing.",
            error: "error" in task ? (task.error?.message ?? null) : null,
          };
        case "cancelled":
          return {
            status: "cancelled",
            stage: "Assistant task cancelled.",
            error: null,
          };
        case "paused":
          return {
            status: "paused",
            stage: "Assistant paused before completing.",
            error: "error" in task ? (task.error?.message ?? null) : null,
          };
        default:
          return {
            status: "running",
            stage: "Assistant is working…",
            error: null,
          };
      }
    },
    [],
  );

  // Typed SSE consumer
  const stream = useAssistantStream({
    backendUrl: backendURL,
    onChunkText: (ctx, delta) => {
      const near = scroll.scrollRef.current
        ? isNearBottom(scroll.scrollRef.current)
        : true;
      setMessages((prev) => {
        const next = prev.map((message) =>
          message.id === ctx.assistantMessageId
            ? { ...message, content: message.content + delta }
            : message,
        );
        return next;
      });
      updateRun(ctx.chatId, {
        status: "streaming",
        currentStage: "Writing response…",
      });
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
            {
              callId: event.data.toolCallId,
              name: event.data.toolName,
              status: "requested",
            },
          ],
        });
      } else if (
        event.type === "run.tool.running" ||
        event.type === "run.tool.succeeded" ||
        event.type === "run.tool.failed"
      ) {
        updateRun(ctx.chatId, {
          status: "tooling",
          currentStage: "Using OpenPCB tools…",
          activeTools: (activeRunsByChat[ctx.chatId]?.activeTools ?? []).map(
            (tool) =>
              tool.callId === event.data.toolCallId
                ? { ...tool, status: event.type.replace("run.tool.", "") }
                : tool,
          ),
        });
      } else if (event.type === "run.completed") {
        updateRun(ctx.chatId, {
          status: "finalizing",
          currentStage: "Finalizing answer…",
        });
      } else if (event.type === "run.warning") {
        if (event.data.code === "empty_response") {
          updateRun(ctx.chatId, { emptyResponse: true });
        }
      } else if (event.type === "run.failed") {
        updateRun(ctx.chatId, {
          status: "failed",
          currentStage: "Assistant stopped before completing.",
          lastError: event.data.errorMessage,
        });
      }
      void api<AssistantToolEventDto[]>(
        `${base}/chats/${ctx.chatId}/tool-events`,
      )
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
          const current = prev[ctx.chatId];
          // A run that completed with no visible answer keeps a retry card instead of
          // vanishing into a blank bubble (mirrors the cancelled/failed affordance).
          if (current?.emptyResponse) {
            return {
              ...prev,
              [ctx.chatId]: {
                ...current,
                status: "failed",
                currentStage: "No answer returned.",
                lastError: "The model returned no answer — Retry.",
              },
            };
          }
          const next = { ...prev };
          delete next[ctx.chatId];
          return next;
        });
      } else {
        updateRun(ctx.chatId, {
          status:
            status === "cancelled"
              ? "cancelled"
              : status === "disconnected"
                ? "disconnected"
                : "failed",
          currentStage:
            status === "cancelled"
              ? "Assistant task cancelled."
              : status === "disconnected"
                ? "Connection lost before completing."
                : "Assistant stopped before completing.",
          lastError: message ?? null,
        });
      }
      if (activeChatIdRef.current === ctx.chatId)
        void refreshMessages(ctx.chatId);
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
      const task = await api<Task>(
        `${tasksBase}/tasks/${latestAssistant.taskId}`,
      ).catch(() => null);
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
        openStream({
          chatId,
          taskId: task.id,
          assistantMessageId: latestAssistant.id,
        });
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
      void refreshMessages(chat.id).then((items) =>
        restoreActiveTask(chat.id, items),
      );
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

  // Heal a chat pinned to a disabled/removed provider (e.g. an old chat on
  // OpenAI before a key was added). The picker only lists enabled providers, so
  // a controlled <select> with no matching option would silently keep the stale
  // id and every send would fail with "Provider disabled". Fall back to the
  // default (or first) enabled provider.
  useEffect(() => {
    if (providers.length === 0) return;
    const current = providers.find((entry) => entry.id === providerId);
    if (current?.enabled) return;
    const fallback =
      providers.find(
        (entry) => entry.id === settings?.defaultProviderId && entry.enabled,
      ) ?? providers.find((entry) => entry.enabled);
    if (fallback && fallback.id !== providerId) {
      setProviderId(fallback.id);
      setModel(fallback.defaultModel);
    }
  }, [providers, providerId, settings?.defaultProviderId]);

  const refreshChatModels = useCallback(async () => {
    if (!base || !providerId) return;
    const next = await api<AssistantProviderModel[]>(
      `${base}/providers/${providerId}/models/refresh`,
      { method: "POST", headers: headers() },
    );
    setModels(next);
  }, [base, providerId]);

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
        if (entries.some((entry) => entry.isIntersecting))
          void loadOlderMessages();
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
  }, [
    messages.length,
    messagesPage.initialLoadedChatId,
    scroll,
    selectedChatId,
  ]);

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
    if (
      !window.confirm(
        `Delete ${chatIds.length} selected chat${chatIds.length === 1 ? "" : "s"}?`,
      )
    )
      return;
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

  const beginRename = () => {
    if (!selectedChat) return;
    setTitleDraft(selectedChat.title);
    setEditingTitle(true);
  };
  const commitTitle = async () => {
    if (titleCommitting) return;
    const next = titleDraft.trim();
    if (!base || !selectedChatId || !next || next === selectedChat?.title) {
      setEditingTitle(false);
      return;
    }
    setTitleCommitting(true);
    try {
      const updated = await api<AssistantChat>(
        `${base}/chats/${selectedChatId}`,
        {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ title: next }),
        },
      );
      setChats((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      setEditingTitle(false);
    } catch (err) {
      // Keep edit mode open with the draft intact so the user can retry.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTitleCommitting(false);
    }
  };

  const exportMarkdown = () => {
    if (!selectedChat) return;
    const lines = [`# ${selectedChat.title}`, ""];
    for (const m of messages) {
      if (m.role === "tool" || m.metadata?.ai?.internal) continue;
      const body = (m.content ?? "").trim();
      if (!body) continue;
      const who =
        m.role === "user"
          ? "You"
          : m.role === "assistant"
            ? "Assistant"
            : "System";
      lines.push(`**${who}:**`, "", body, "");
    }
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedChat.title.replace(/[^\w.-]+/g, "_") || "chat"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {sidebarOpen ? (
        <aside className="flex w-80 min-w-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/80">
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Chats</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  aria-label="Collapse sidebar"
                  className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void createChat().catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400">
              <Search className="h-3.5 w-3.5" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search chats"
                name="assistant-chat-search"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {(
                [
                  { key: "all", label: "All", count: chatCounts.all },
                  {
                    key: "pinned",
                    label: "Pinned",
                    count: chatCounts.pinned,
                    icon: <Pin className="h-3 w-3" />,
                  },
                  {
                    key: "linked",
                    label: "Linked",
                    count: chatCounts.linked,
                    icon: <Link2 className="h-3 w-3" />,
                  },
                  {
                    key: "archived",
                    label: "Archived",
                    count: chatCounts.archived,
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] ${
                    filter === f.key
                      ? "bg-accent-soft text-accent-text"
                      : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {"icon" in f ? f.icon : null}
                  {f.label}
                  <span
                    className={
                      filter === f.key ? "text-accent-text" : "text-slate-500"
                    }
                  >
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
            {selectedChatIds.size > 0 ? (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <span>{selectedChatIds.size} selected</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedChatIds(new Set())}
                    className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void deleteSelectedChats().catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : String(err),
                        ),
                      )
                    }
                    className="rounded bg-red-100 px-2 py-1 font-semibold text-red-700 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/70"
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
                role="button"
                tabIndex={0}
                aria-label={`Open chat ${chat.title}`}
                aria-current={selectedChatId === chat.id}
                onClick={() => setSelectedChatId(chat.id)}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedChatId(chat.id);
                  }
                }}
                onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
                  event.preventDefault();
                  setContextMenu({
                    chatId: chat.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                className={`group flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selectedChatId === chat.id
                    ? "border-violet-600 bg-violet-50 text-slate-900 dark:border-violet-400 dark:bg-violet-500/10 dark:text-slate-100"
                    : "border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-200"
                } ${userState.isArchived(chat.id) ? "opacity-60" : ""}`}
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
                    className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-950"
                    aria-label={`Select ${chat.title}`}
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    {activeRunsByChat[chat.id] ? (
                      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400" />
                    ) : null}
                    <div className="truncate text-sm font-medium">
                      {chat.title}
                    </div>
                  </div>
                  {userState.isPinned(chat.id) ? (
                    <Pin className="h-3 w-3 shrink-0 text-amber-400" />
                  ) : null}
                  {userState.isArchived(chat.id) ? (
                    <Archive className="h-3 w-3 shrink-0 text-slate-500" />
                  ) : null}
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setContextMenu({
                        chatId: chat.id,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                    className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    aria-label={`Chat actions for ${chat.title}`}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
                {linkedDesign(chat) ? (
                  <span className="inline-flex w-fit max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-accent-text dark:bg-slate-800">
                    <Link2 className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{linkedDesign(chat)!.name}</span>
                  </span>
                ) : null}
                <div
                  className="flex items-center gap-1.5 text-left text-[11px] text-slate-500"
                  title={chat.model}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
                  {relativeTime(chat.lastMessageAt ?? chat.updatedAt)}
                </div>
              </div>
            ))}
            {filteredChats.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-800">
                No chats yet.
              </div>
            ) : null}
          </div>
          <div className="border-t border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-center gap-2 text-xs">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-200">
                {model}
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">
                {selectedProvider?.kind === "lmstudio" ||
                selectedProvider?.kind === "omlx"
                  ? "Local"
                  : (selectedProvider?.label ?? "Cloud")}
              </span>
            </div>
          </div>
        </aside>
      ) : null}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {!sidebarOpen ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Show chats"
                  title="Show chats"
                  className="rounded-control border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void createChat().catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                  aria-label="New chat"
                  title="New chat"
                  className="rounded-control border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
                <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-800" />
              </div>
            ) : null}
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                disabled={titleCommitting}
                aria-label="Chat title"
                aria-busy={titleCommitting}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitTitle()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitTitle();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900 outline-none focus-visible:border-violet-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            ) : (
              <button
                type="button"
                onClick={beginRename}
                disabled={!selectedChat}
                className="group flex min-w-0 items-center gap-1.5 text-left"
                title="Rename chat"
              >
                <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {selectedChat?.title ?? "New chat"}
                </span>
                {selectedChat ? (
                  <Pencil className="h-3 w-3 shrink-0 text-slate-400 opacity-0 group-hover:opacity-100 dark:text-slate-600" />
                ) : null}
              </button>
            )}
            {selectedLinked ? (
              <button
                type="button"
                onClick={() => navigateToModule("designer", selectedLinked.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-control border border-slate-300 bg-white px-2 py-1 text-[11px] text-accent-text hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                title="Open linked design"
              >
                <Link2 className="h-3 w-3" />
                <span className="max-w-[140px] truncate">
                  {selectedLinked.name}
                </span>
              </button>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {toolCount !== null ? (
              <span
                className="inline-flex items-center gap-1 rounded-control border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                title={`${toolCount} grounded tools available`}
              >
                <Wrench className="h-3 w-3 text-status-success" />
                {toolCount}
                <span className="text-slate-500">tools</span>
              </span>
            ) : null}
            <ModelSelectorPill
              providers={providers}
              providerId={providerId}
              onProviderChange={setProviderId}
              model={model}
              onModelChange={setModel}
              models={models}
              onRefreshModels={() =>
                void refreshChatModels().catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              presets={presets}
              promptPresetId={promptPresetId}
              onPresetChange={setPromptPresetId}
              selectedProvider={selectedProvider}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Chat actions"
                  disabled={!selectedChat}
                  className="rounded-control border border-slate-300 p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => beginRename()}>
                  <Pencil className="h-3.5 w-3.5" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    exportMarkdown();
                  }}
                  disabled={!selectedChat || messages.length === 0}
                >
                  <Download className="h-3.5 w-3.5" /> Export markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    if (selectedChatId) userState.toggleArchive(selectedChatId);
                  }}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {selectedChatId && userState.isArchived(selectedChatId)
                    ? "Unarchive"
                    : "Archive"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={(e) => {
                    e.preventDefault();
                    if (selectedChatId)
                      void deleteChat(selectedChatId).catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : String(err),
                        ),
                      );
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div
          ref={scroll.scrollRef}
          className="relative min-h-0 flex-1 overflow-auto"
        >
          <div className="mx-auto max-w-5xl pb-48 pt-4">
            <div ref={topSentinelRef} className="h-px" />
            {messagesPage.loadingOlder ? (
              <div className="py-2 text-center text-xs text-slate-500">
                Loading older messages…
              </div>
            ) : null}
            {chatOnly ? (
              <div className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                This provider is running without grounded OpenPCB tools. Answers
                will not use library or designer data.
              </div>
            ) : null}
            {error ? (
              <div
                role="alert"
                aria-live="assertive"
                className="mx-4 mb-4 flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
              >
                <span className="min-w-0 flex-1 break-words">{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  aria-label="Dismiss error"
                  className="shrink-0 rounded p-0.5 text-red-500 hover:bg-red-100 hover:text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 dark:text-red-300 dark:hover:bg-red-900/40 dark:hover:text-red-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            {messages.length === 0 ? (
              <div className="px-4">
                <EmptyState onPrompt={setInput} />
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
                return visible.map((message, idx) => {
                  const prev = idx > 0 ? visible[idx - 1] : null;
                  const showDivider =
                    Boolean(message.createdAt) &&
                    (!prev ||
                      dayKey(prev.createdAt) !== dayKey(message.createdAt));
                  return (
                    <Fragment key={message.id}>
                      {showDivider ? (
                        <div className="my-3 flex items-center gap-3 px-4 text-[10px] uppercase tracking-wider text-slate-500">
                          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                          {dateDividerLabel(message.createdAt)}
                          <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                        </div>
                      ) : null}
                      <MessageCard
                        message={message}
                        toolEvents={toolEventsByMessage.get(message.id) ?? []}
                        assistantBaseUrl={base}
                        backendURL={backendURL}
                        writeProposals={writeProposals}
                        onProposalChanged={() => {
                          if (selectedChatId)
                            void refreshMessages(selectedChatId);
                        }}
                        runState={
                          selectedRun?.assistantMessageId === message.id
                            ? selectedRun
                            : null
                        }
                        onStopRun={(run) =>
                          void stopRun(run).catch((err: unknown) =>
                            setError(
                              err instanceof Error ? err.message : String(err),
                            ),
                          )
                        }
                        onRetryRun={(run) =>
                          void retryRunAsNew(run).catch((err: unknown) =>
                            setError(
                              err instanceof Error ? err.message : String(err),
                            ),
                          )
                        }
                        onSendPrompt={
                          selectedRun || loading
                            ? undefined
                            : (prompt) => void submit(undefined, prompt)
                        }
                        loading={
                          loading &&
                          idx === lastAssistantIdx &&
                          message.role === "assistant"
                        }
                      />
                    </Fragment>
                  );
                });
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
                backendURL={backendURL}
              />
            ) : null}
          </div>
        </div>

        {/* Floating composer — overlays the chat (ChatGPT-style) instead of a
            fixed bottom bar. A gradient fade lets messages scroll under it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col">
          <div className="h-20 bg-gradient-to-t from-slate-50 to-transparent dark:from-slate-950" />
          <div className="bg-slate-50 px-4 pb-4 dark:bg-slate-950">
            <div className="pointer-events-auto mx-auto w-full max-w-5xl">
              {showNewMessagesPill ? (
                <div className="mb-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      scroll.scrollToBottom();
                      setShowNewMessagesPill(false);
                    }}
                    className="rounded-full border border-violet-300 bg-violet-100 px-3 py-1 text-xs text-violet-700 shadow-lg dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100"
                  >
                    ↓ New messages
                  </button>
                </div>
              ) : null}
              <div className="rounded-xl shadow-xl shadow-slate-900/5 dark:shadow-black/40">
                <ChatComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={() => void submit()}
                  onStop={
                    selectedRun
                      ? () =>
                          void stopRun(selectedRun).catch((err: unknown) =>
                            setError(
                              err instanceof Error ? err.message : String(err),
                            ),
                          )
                      : undefined
                  }
                  busy={loading}
                  toolCount={toolCount ?? undefined}
                  contextBudgetKb={contextBudgetKb(
                    settings?.contextSizePreference,
                  )}
                  quickActions={QUICK_ACTIONS}
                />
              </div>
              <div className="mt-1.5 text-center text-[10px] text-slate-500">
                Assistant can make mistakes. Verify critical design decisions.
              </div>
            </div>
          </div>
        </div>
      </main>
      {contextMenu ? (
        <div
          className="fixed z-50 rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() =>
              void renameChat(contextMenu.chatId).catch((err: unknown) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
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
            className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            Delete chat
          </button>
        </div>
      ) : null}
    </div>
  );
}

const STARTER_PROMPTS = [
  "Find a 3.3V regulator for 500mA",
  "Sketch a power supply for me",
  "Resolve the BOM for this design",
  "Run ERC and explain any issues",
];

function EmptyState({
  onPrompt,
}: {
  onPrompt: (prompt: string) => void;
}): ReactElement {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900/40">
      <Sparkles className="mx-auto h-8 w-8 text-violet-500 dark:text-violet-300" />
      <h2 className="mt-4 text-lg font-semibold">
        Start a PCB-focused conversation
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Ask about components, nets, ERC, or PCB layout — or try one of these:
      </p>
      <div className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="rounded-pill border border-slate-300 px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-violet-400 hover:bg-violet-500/10 hover:text-violet-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-violet-500/50 dark:hover:text-violet-200"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}
