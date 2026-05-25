import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ArrowUp, ExternalLink, MessageSquarePlus, MoreHorizontal, X } from "lucide-react";
import type {
  AssistantChat,
  AssistantMessage,
  AssistantMessagesPage,
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
import type { ActiveRunState, ActiveRunStatus } from "./components/AssistantRunStatusCard";
import { useAssistantStream } from "./hooks/useAssistantStream";
import { isNearBottom, useScrollAnchor } from "./hooks/useScrollAnchor";

interface DesignerChatDockProps {
  backendURL: string | null | undefined;
  designId: string | null;
  designName: string | null;
  designRevision: number | null;
  onClose(): void;
  onOpenFull(chatId: string): void;
  onDesignChanged(change?: {
    kind: "applied" | "rejected" | "tool";
    designId?: string;
    revision?: number;
  }): void;
}

function headers(): HeadersInit {
  return { "content-type": "application/json" };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
      error?: string;
      title?: string;
    };
    throw new Error(body.detail ?? body.error ?? body.title ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function taskStage(task: Task | TaskEvent): {
  status: ActiveRunStatus;
  stage: string;
  error: string | null;
} {
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
    case "cancelled":
      return { status: "cancelled", stage: "Assistant task cancelled.", error: null };
    case "failed":
      return { status: "failed", stage: "Assistant stopped before completing.", error: "error" in task ? task.error?.message ?? null : null };
    default:
      return { status: "running", stage: "Assistant is working…", error: null };
  }
}

export function DesignerChatDock({
  backendURL,
  designId,
  designName,
  designRevision,
  onClose,
  onOpenFull,
  onDesignChanged,
}: DesignerChatDockProps): ReactElement {
  const assistantBase = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/assistant` : null),
    [backendURL],
  );
  const tasksBase = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/tasks` : null),
    [backendURL],
  );
  const [chats, setChats] = useState<AssistantChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toolEvents, setToolEvents] = useState<AssistantToolEventDto[]>([]);
  const [writeProposals, setWriteProposals] = useState<AssistantWriteProposalDto[]>([]);
  const [providers, setProviders] = useState<AssistantProviderConfig[]>([]);
  const [models, setModels] = useState<AssistantProviderModel[]>([]);
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [providerId, setProviderId] = useState("openai");
  const [model, setModel] = useState("gpt-4o-mini");
  const [promptPresetId, setPromptPresetId] = useState<AssistantPromptPresetId>("strict-grounded");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [activeRunsByChat, setActiveRunsByChat] = useState<Record<string, ActiveRunState>>({});
  const [messagesPage, setMessagesPage] = useState({
    oldestCursor: null as string | null,
    hasMore: false,
    loadingOlder: false,
    initialLoadedChatId: null as string | null,
  });
  const activeChatIdRef = useRef<string | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const scroll = useScrollAnchor();

  const selectedRun = selectedChatId ? activeRunsByChat[selectedChatId] : undefined;
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const toolEventsByMessage = useMemo(() => {
    const map = new Map<string, AssistantToolEventDto[]>();
    for (const event of toolEvents) {
      if (!event.messageId) continue;
      const list = map.get(event.messageId) ?? [];
      list.push(event);
      map.set(event.messageId, list);
    }
    return map;
  }, [toolEvents]);

  const updateRun = useCallback((chatId: string, patch: Partial<ActiveRunState>) => {
    setActiveRunsByChat((prev) => {
      const current = prev[chatId];
      if (!current) return prev;
      return { ...prev, [chatId]: { ...current, ...patch, lastEventAt: new Date().toISOString() } };
    });
  }, []);

  const mergeToolEvents = useCallback((incoming: AssistantToolEventDto[]) => {
    setToolEvents((prev) => {
      const map = new Map(prev.map((event) => [event.id, event]));
      for (const event of incoming) map.set(event.id, event);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const refreshConfig = useCallback(async () => {
    if (!assistantBase) return;
    const [nextSettings, nextProviders] = await Promise.all([
      api<AssistantSettings>(`${assistantBase}/settings`),
      api<AssistantProviderConfig[]>(`${assistantBase}/providers`),
    ]);
    setSettings(nextSettings);
    setProviders(nextProviders);
    setPromptPresetId(nextSettings.defaultPromptPresetId);
    const provider = nextProviders.find((entry) => entry.id === nextSettings.defaultProviderId) ?? nextProviders[0];
    if (provider) {
      setProviderId(provider.id);
      setModel(provider.defaultModel);
    }
  }, [assistantBase]);

  const refreshDesignChats = useCallback(async () => {
    if (!assistantBase || !designId) return;
    const data = await api<AssistantChat[]>(`${assistantBase}/design-chats?designId=${encodeURIComponent(designId)}`);
    setChats(data);
    setSelectedChatId((current) => {
      const next = current && data.some((chat) => chat.id === current) ? current : data[0]?.id ?? null;
      activeChatIdRef.current = next;
      return next;
    });
  }, [assistantBase, designId]);

  const createDesignChat = useCallback(async () => {
    if (!assistantBase || !designId) return null;
    const chat = await api<AssistantChat>(`${assistantBase}/design-chats`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ designId, providerConfigId: providerId, model, promptPresetId }),
    });
    setChats((prev) => [chat, ...prev]);
    setSelectedChatId(chat.id);
    activeChatIdRef.current = chat.id;
    setMessages([]);
    setToolEvents([]);
    setWriteProposals([]);
    return chat;
  }, [assistantBase, designId, model, promptPresetId, providerId]);

  const ensureDesignChat = useCallback(async () => {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const chat = await createDesignChat();
    if (!chat) throw new Error("Open a design before chatting");
    return chat.id;
  }, [createDesignChat]);

  const refreshMessages = useCallback(async (chatId: string) => {
    if (!assistantBase) return [] as AssistantMessage[];
    const [page, proposals] = await Promise.all([
      api<AssistantMessagesPage>(`${assistantBase}/chats/${chatId}/messages?limit=50`),
      api<AssistantWriteProposalDto[]>(`${assistantBase}/chats/${chatId}/write-proposals`).catch(() => []),
    ]);
    const ids = page.items.map((message) => message.id);
    const events = ids.length
      ? await api<AssistantToolEventDto[]>(`${assistantBase}/chats/${chatId}/tool-events?messageIds=${encodeURIComponent(ids.join(","))}`).catch(() => [])
      : [];
    setMessages(page.items);
    setToolEvents(events);
    setWriteProposals(proposals);
    setMessagesPage({ oldestCursor: page.nextCursor, hasMore: page.hasMore, loadingOlder: false, initialLoadedChatId: chatId });
    requestAnimationFrame(scroll.scrollToBottom);
    return page.items;
  }, [assistantBase, scroll.scrollToBottom]);

  const stream = useAssistantStream({
    backendUrl: backendURL,
    onChunkText: (ctx, delta) => {
      const near = scroll.scrollRef.current ? isNearBottom(scroll.scrollRef.current) : true;
      setMessages((prev) => prev.map((message) => message.id === ctx.assistantMessageId ? { ...message, content: message.content + delta } : message));
      updateRun(ctx.chatId, { status: "streaming", currentStage: "Writing response…" });
      if (near) requestAnimationFrame(scroll.scrollToBottom);
    },
    onTaskEvent: (ctx, event) => {
      const mapped = taskStage(event);
      updateRun(ctx.chatId, { status: mapped.status, currentStage: mapped.stage, lastError: mapped.error });
    },
    onAiEvent: (ctx) => {
      if (!assistantBase) return;
      updateRun(ctx.chatId, { status: "tooling", currentStage: "Using OpenPCB tools…" });
      void api<AssistantToolEventDto[]>(`${assistantBase}/chats/${ctx.chatId}/tool-events`).then(mergeToolEvents).catch(() => undefined);
      void api<AssistantWriteProposalDto[]>(`${assistantBase}/chats/${ctx.chatId}/write-proposals`).then(setWriteProposals).catch(() => undefined);
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
        updateRun(ctx.chatId, { status: status === "cancelled" ? "cancelled" : "failed", currentStage: message ?? "Assistant stopped before completing." });
      }
      if (activeChatIdRef.current === ctx.chatId) void refreshMessages(ctx.chatId);
      void refreshDesignChats();
    },
  });
  const openStream = stream.open;

  const restoreActiveTask = useCallback(async (chatId: string, items: AssistantMessage[]) => {
    if (!tasksBase) return;
    const latest = [...items].reverse().find((message) => message.role === "assistant" && message.taskId);
    if (!latest?.taskId) return;
    const task = await api<Task>(`${tasksBase}/tasks/${latest.taskId}`).catch(() => null);
    if (!task || task.status === "completed") return;
    const mapped = taskStage(task);
    setActiveRunsByChat((prev) => ({
      ...prev,
      [chatId]: { chatId, taskId: task.id, assistantMessageId: latest.id, status: mapped.status, currentStage: mapped.stage, activeTools: [], lastError: mapped.error, userMessageContent: "", startedAt: task.startedAt ?? task.createdAt, lastEventAt: new Date().toISOString() },
    }));
    if (!["failed", "cancelled", "paused"].includes(task.status)) openStream({ chatId, taskId: task.id, assistantMessageId: latest.id });
  }, [openStream, tasksBase]);

  useEffect(() => {
    void refreshConfig().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [refreshConfig]);

  useEffect(() => {
    setMessages([]);
    setToolEvents([]);
    setWriteProposals([]);
    setSelectedChatId(null);
    activeChatIdRef.current = null;
    if (designId) void refreshDesignChats().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [designId, refreshDesignChats]);

  useEffect(() => {
    if (!selectedChatId) return;
    activeChatIdRef.current = selectedChatId;
    const chat = chats.find((entry) => entry.id === selectedChatId);
    if (chat) {
      setProviderId(chat.providerConfigId);
      setModel(chat.model);
      setPromptPresetId(chat.promptPresetId);
    }
    void refreshMessages(selectedChatId).then((items) => restoreActiveTask(selectedChatId, items));
  }, [chats, refreshMessages, restoreActiveTask, selectedChatId]);

  useEffect(() => {
    if (!assistantBase || !providerId) return;
    void api<AssistantProviderModel[]>(`${assistantBase}/providers/${providerId}/models`).then(setModels).catch(() => setModels([]));
  }, [assistantBase, providerId]);

  useEffect(() => {
    const root = scroll.scrollRef.current;
    const target = topSentinelRef.current;
    if (!root || !target || !assistantBase || !selectedChatId) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || !messagesPage.hasMore || messagesPage.loadingOlder || !messagesPage.oldestCursor) return;
      setMessagesPage((prev) => ({ ...prev, loadingOlder: true }));
      scroll.captureBeforePrepend();
      void api<AssistantMessagesPage>(`${assistantBase}/chats/${selectedChatId}/messages?limit=50&before=${encodeURIComponent(messagesPage.oldestCursor)}`)
        .then((page) => {
          const ids = page.items.map((message) => message.id);
          if (ids.length > 0) {
            void api<AssistantToolEventDto[]>(`${assistantBase}/chats/${selectedChatId}/tool-events?messageIds=${encodeURIComponent(ids.join(","))}`)
              .then(mergeToolEvents)
              .catch(() => undefined);
          }
          setMessages((prev) => [...page.items, ...prev]);
          setMessagesPage({ oldestCursor: page.nextCursor, hasMore: page.hasMore, loadingOlder: false, initialLoadedChatId: selectedChatId });
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, { root, threshold: 1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, [assistantBase, mergeToolEvents, messagesPage.hasMore, messagesPage.loadingOlder, messagesPage.oldestCursor, scroll, selectedChatId]);

  useLayoutEffect(() => {
    if (messagesPage.initialLoadedChatId === selectedChatId) scroll.restoreAfterPrepend();
  }, [messages.length, messagesPage.initialLoadedChatId, scroll, selectedChatId]);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = input.trim();
    if (!assistantBase || !content || !designId) return;
    setLoading(true);
    setError(null);
    try {
      const chatId = await ensureDesignChat();
      const result = await api<SubmitAssistantMessageResult>(`${assistantBase}/chats/${chatId}/messages`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ content, providerConfigId: providerId, model, promptPresetId }),
      });
      setInput("");
      setSelectedChatId(result.chat.id);
      activeChatIdRef.current = result.chat.id;
      setActiveRunsByChat((prev) => ({
        ...prev,
        [result.chat.id]: { chatId: result.chat.id, taskId: result.taskId, assistantMessageId: result.assistantMessage.id, status: "queued", currentStage: "Assistant is queued…", activeTools: [], lastError: null, userMessageContent: content, startedAt: new Date().toISOString(), lastEventAt: new Date().toISOString() },
      }));
      await refreshMessages(result.chat.id);
      openStream({ chatId: result.chat.id, taskId: result.taskId, assistantMessageId: result.assistantMessage.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const stopRun = useCallback(async (run: ActiveRunState) => {
    if (!tasksBase) return;
    await api<{ ok: true }>(`${tasksBase}/tasks/${run.taskId}/cancel`, { method: "POST" });
    updateRun(run.chatId, { status: "cancelled", currentStage: "Assistant task cancelled." });
  }, [tasksBase, updateRun]);

  const renameChat = useCallback(async (chatId: string) => {
    if (!assistantBase) return;
    const chat = chats.find((entry) => entry.id === chatId);
    const title = window.prompt("Rename chat", chat?.title ?? "");
    if (title === null) return;
    const normalized = title.trim();
    if (!normalized) return;
    const updated = await api<AssistantChat>(`${assistantBase}/chats/${chatId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ title: normalized }),
    });
    setChats((prev) => prev.map((entry) => entry.id === updated.id ? updated : entry));
  }, [assistantBase, chats]);

  const deleteChat = useCallback(async (chatId: string) => {
    if (!assistantBase) return;
    const chat = chats.find((entry) => entry.id === chatId);
    if (!window.confirm(`Delete "${chat?.title ?? "chat"}"?`)) return;
    await api<{ ok: true }>(`${assistantBase}/chats/${chatId}`, { method: "DELETE" });
    if (selectedChatId === chatId) {
      setMessages([]);
      setToolEvents([]);
      setWriteProposals([]);
      setSelectedChatId(null);
      activeChatIdRef.current = null;
    }
    await refreshDesignChats();
  }, [assistantBase, chats, refreshDesignChats, selectedChatId]);

  if (!designId) {
    return <EmptyDock onClose={onClose} message="Open or create a design to use Designer Chat." />;
  }

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">Chat</div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{designName ?? designId} · rev {designRevision ?? "—"}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => selectedChatId && onOpenFull(selectedChatId)} disabled={!selectedChatId} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-800 dark:hover:bg-slate-900" title="Open in Assistant"><ExternalLink className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onClose} className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900" title="Close chat"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <div className="mt-3 flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <button type="button" onClick={() => setMenuOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-left text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
              <span className="truncate">{chats.find((chat) => chat.id === selectedChatId)?.title ?? "No chat yet"}</span>
              <MoreHorizontal className="h-3.5 w-3.5 shrink-0" />
            </button>
            {menuOpen ? <ThreadMenu chats={chats} selectedChatId={selectedChatId} onSelect={(id) => { setSelectedChatId(id); setMenuOpen(false); }} onNew={() => void createDesignChat().finally(() => setMenuOpen(false))} onRename={(id) => void renameChat(id).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setMenuOpen(false))} onDelete={(id) => void deleteChat(id).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setMenuOpen(false))} /> : null}
          </div>
          <button type="button" onClick={() => void createDesignChat()} className="rounded border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900" title="New design chat"><MessageSquarePlus className="h-4 w-4" /></button>
        </div>
        <div className="relative mt-2 min-w-0">
          <button type="button" onClick={() => setModelMenuOpen((value) => !value)} className="block w-full truncate rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-900">
            {selectedProvider?.label ?? providerId} / {model}
          </button>
          {modelMenuOpen ? <ModelMenu providers={providers} models={models} providerId={providerId} model={model} onProvider={setProviderId} onModel={setModel} onClose={() => setModelMenuOpen(false)} /> : null}
        </div>
      </div>
      <div ref={scroll.scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div ref={topSentinelRef} className="h-px" />
        {messagesPage.loadingOlder ? <div className="p-2 text-center text-xs text-slate-500">Loading older messages…</div> : null}
        {error ? <div className="m-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{error}</div> : null}
        {messages.length === 0 ? <div className="p-4 text-sm text-slate-500">Ask about the active design, components, nets, ERC, or PCB layout.</div> : (() => {
          const visible = messages.filter((message) => message.role !== "tool" && message.metadata?.ai?.internal !== true);
          const lastAssistantIdx = (() => {
            for (let i = visible.length - 1; i >= 0; i--) {
              if (visible[i]!.role === "assistant") return i;
            }
            return -1;
          })();
          return visible.map((message, idx) => (
            <MessageCard key={message.id} message={message} toolEvents={toolEventsByMessage.get(message.id) ?? []} assistantBaseUrl={assistantBase} writeProposals={writeProposals} onProposalChanged={(change) => { if (selectedChatId) void refreshMessages(selectedChatId); onDesignChanged(change); }} runState={selectedRun?.assistantMessageId === message.id ? selectedRun : null} onStopRun={(run) => void stopRun(run).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))} loading={loading && idx === lastAssistantIdx && message.role === "assistant"} compact />
          ));
        })()}
      </div>
      <form onSubmit={(event) => void submit(event)} className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="relative rounded-xl border border-slate-300 bg-white focus-within:border-violet-500 dark:border-slate-700 dark:bg-slate-900">
          <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} rows={2} placeholder="Ask about this design…" className="max-h-32 min-h-12 w-full resize-none bg-transparent px-3 py-2 pr-10 text-sm outline-none placeholder:text-slate-400" />
          <button type="submit" disabled={loading || !input.trim()} className="absolute bottom-2 right-2 rounded bg-violet-600 p-1.5 text-white hover:bg-violet-500 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-800"><ArrowUp className="h-3.5 w-3.5" /></button>
        </div>
        <div className="mt-1 text-center text-[10px] text-slate-400">AI can make mistakes. Verify design changes.</div>
      </form>
    </aside>
  );
}

function EmptyDock({ onClose, message }: { onClose(): void; message: string }): ReactElement {
  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="text-sm font-semibold">Chat</div>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-900"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">{message}</div>
    </aside>
  );
}

function ThreadMenu({ chats, selectedChatId, onSelect, onNew, onRename, onDelete }: { chats: AssistantChat[]; selectedChatId: string | null; onSelect(id: string): void; onNew(): void; onRename(id: string): void; onDelete(id: string): void; }): ReactElement {
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <button type="button" onClick={onNew} className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-900">New chat for this design</button>
      {chats.map((chat) => <div key={chat.id} className={`rounded px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-900 ${chat.id === selectedChatId ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200" : ""}`}><button type="button" onClick={() => onSelect(chat.id)} className="w-full text-left"><div className="truncate">{chat.title}</div><div className="truncate text-[10px] text-slate-500">{chat.model}</div></button><div className="mt-1 flex gap-2 text-[10px]"><button type="button" onClick={() => onRename(chat.id)} className="text-slate-500 hover:text-violet-600">Rename</button><button type="button" onClick={() => onDelete(chat.id)} className="text-red-500 hover:text-red-600">Delete</button></div></div>)}
    </div>
  );
}

function ModelMenu({ providers, models, providerId, model, onProvider, onModel, onClose }: { providers: AssistantProviderConfig[]; models: AssistantProviderModel[]; providerId: string; model: string; onProvider(id: string): void; onModel(id: string): void; onClose(): void; }): ReactElement {
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 min-w-64 rounded border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <label className="block text-[10px] uppercase text-slate-500">Provider</label>
      <select value={providerId} onChange={(event) => onProvider(event.target.value)} className="mt-1 w-full rounded border border-slate-200 bg-transparent p-1 text-xs dark:border-slate-800">
        {providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select>
      <label className="mt-2 block text-[10px] uppercase text-slate-500">Model</label>
      {models.length > 0 ? <select value={models.some((entry) => entry.modelId === model) ? model : models[0]?.modelId ?? ""} onChange={(event) => onModel(event.target.value)} className="mt-1 w-full rounded border border-slate-200 bg-transparent p-1 text-xs dark:border-slate-800">{models.map((entry) => <option key={entry.modelId} value={entry.modelId}>{entry.displayName ?? entry.modelId}</option>)}</select> : <input value={model} onChange={(event) => onModel(event.target.value)} className="mt-1 w-full rounded border border-slate-200 bg-transparent p-1 text-xs dark:border-slate-800" />}
      <button type="button" onClick={onClose} className="mt-2 w-full rounded bg-slate-100 py-1 text-xs hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800">Done</button>
    </div>
  );
}
