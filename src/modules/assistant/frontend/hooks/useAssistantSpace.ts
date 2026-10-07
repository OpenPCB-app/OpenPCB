import { confirmDialog, promptDialog } from "../../../../shared/frontend/ui/dialog-host-store";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ModuleSpaceProps } from "../../../../core/contracts/modules/frontend-entry";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";
import type { AssistantChat } from "../../../../sdks/assistant";
import { projectChat } from "../agentkit-projections";
import { useChatUserState } from "../components/useChatUserState";
import { useAssistantConversation } from "./useAssistantConversation";
import { useConversationScroll } from "./useConversationScroll";

export function linkedDesign(chat: AssistantChat | undefined) {
  const metadata = chat?.metadata;
  return typeof metadata?.designId === "string" ? { id: metadata.designId, name: typeof metadata.designName === "string" ? metadata.designName : metadata.designId } : null;
}
type Conversation = ReturnType<typeof useAssistantConversation>;
function useSpaceChatActions(conversation: Conversation, chats: AssistantChat[], selectedChatId: string | null, setSelectedChatId: (id: string | null) => void, selectedChatIds: Set<string>, setSelectedChatIds: (ids: Set<string>) => void, setContextMenu: (menu: null) => void) {
  const { cache, messages, setError } = conversation;
  const selectedChat = chats.find(chat => chat.id === selectedChatId) ?? null;
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleCommitting, setTitleCommitting] = useState(false);
  const renameChat = async (id: string) => {
    const title = await promptDialog({ title: "Rename chat", defaultValue: chats.find(chat => chat.id === id)?.title ?? "" });
    if (title?.trim()) await cache.renameChat(id, title.trim()); setContextMenu(null);
  };
  const deleteChat = async (id: string) => {
    if (!await confirmDialog({ title: `Delete "${chats.find(chat => chat.id === id)?.title ?? "chat"}"?`, confirmLabel: "Delete", tone: "danger" })) return;
    await cache.deleteChat(id); if (selectedChatId === id) setSelectedChatId(null); setContextMenu(null);
  };
  const deleteSelectedChats = async () => {
    if (!await confirmDialog({ title: `Delete ${selectedChatIds.size} selected chats?`, confirmLabel: "Delete", tone: "danger" })) return;
    for (const id of selectedChatIds) await cache.deleteChat(id);
    if (selectedChatId && selectedChatIds.has(selectedChatId)) setSelectedChatId(null); setSelectedChatIds(new Set());
  };
  const beginRename = () => { if (selectedChat) { setTitleDraft(selectedChat.title); setEditingTitle(true); } };
  const commitTitle = async () => {
    if (titleCommitting || !selectedChatId) return;
    const title = titleDraft.trim();
    if (!title || title === selectedChat?.title) { setEditingTitle(false); return; }
    setTitleCommitting(true);
    try { await cache.renameChat(selectedChatId, title); setEditingTitle(false); }
    catch (cause) { setError(String(cause)); } finally { setTitleCommitting(false); }
  };
  const exportMarkdown = () => {
    if (!selectedChat) return;
    const lines = [`# ${selectedChat.title}`, "", ...messages.filter(message => message.role !== "tool" && !message.metadata?.ai?.internal && message.content.trim()).flatMap(message => [`**${message.role === "user" ? "You" : "Assistant"}:**`, "", message.content, ""])];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${selectedChat.title.replace(/[^\w.-]+/g, "_") || "chat"}.md`; link.click(); URL.revokeObjectURL(url);
  };
  return { editingTitle, setEditingTitle, titleDraft, setTitleDraft, titleCommitting, beginRename, commitTitle, exportMarkdown, renameChat, deleteChat, deleteSelectedChats };
}

function useSpaceChatCreation(conversation: Conversation, selectedChatId: string | null, setSelectedChatId: (id: string | null) => void, setEditingTitle: (editing: boolean) => void) {
  const { cache, input, setError } = conversation;
  const [pendingPrompt, setPendingPrompt] = useState<{ chatId: string; content: string } | null>(null);
  const creating = useRef<Promise<void> | null>(null);
  const createChat = async () => {
    const chat = await cache.createChat({ ...(cache.settings && cache.appSettings ? { providerId: conversation.providerId, model: conversation.model, promptPresetId: conversation.promptPresetId } : {}) });
    cache.moveDraft("new", chat.id);
    setSelectedChatId(chat.id); setEditingTitle(false); return chat;
  };
  const submit = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    if (selectedChatId) return conversation.submit(undefined, override);
    if (creating.current || !conversation.readyToSend) return;
    const content = (override ?? input).trim();
    if (!content) return;
    creating.current = createChat().then(chat => setPendingPrompt({ chatId: chat.id, content })).catch(cause => setError(String(cause))).finally(() => { creating.current = null; });
    await creating.current;
  };
  useEffect(() => {
    if (!pendingPrompt || pendingPrompt.chatId !== selectedChatId || !conversation.canSend) return;
    setPendingPrompt(null); void conversation.submit(undefined, pendingPrompt.content);
  }, [pendingPrompt, selectedChatId, conversation.canSend]);
  return { createChat, submit };
}

export function useAssistantSpace({ backendURL, params }: ModuleSpaceProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(params?.chatId ?? null);
  const conversation = useAssistantConversation(selectedChatId);
  const { cache, messages } = conversation;
  const chats = useMemo(() => cache.chats.map(projectChat), [cache.chats]);
  const [query, setQuery] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<"all" | "pinned" | "linked" | "archived">("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  const userState = useChatUserState();
  const navigateToModule = useNavigationStore(state => state.navigateToModule);
  const viewport = useConversationScroll(selectedChatId, messages.map(message => `${message.id}:${message.content}`).join("|"));
  const selectedChat = chats.find(chat => chat.id === selectedChatId) ?? null;
  useEffect(() => { if (params?.chatId) setSelectedChatId(params.chatId); }, [params?.chatId]);
  useEffect(() => { if (!selectedChatId && chats.length) setSelectedChatId(chats[0]!.id); }, [chats, selectedChatId]);
  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);
  const actions = useSpaceChatActions(conversation, chats, selectedChatId, setSelectedChatId, selectedChatIds, setSelectedChatIds, setContextMenu);
  const creation = useSpaceChatCreation(conversation, selectedChatId, setSelectedChatId, actions.setEditingTitle);
  const chatCounts = {
    all: chats.filter(chat => !userState.isArchived(chat.id)).length, pinned: chats.filter(chat => !userState.isArchived(chat.id) && userState.isPinned(chat.id)).length,
    linked: chats.filter(chat => !userState.isArchived(chat.id) && linkedDesign(chat)).length, archived: chats.filter(chat => userState.isArchived(chat.id)).length
  };
  const filteredChats = chats.filter(chat => (filter === "archived" ? userState.isArchived(chat.id) : !userState.isArchived(chat.id)) && (filter !== "pinned" || userState.isPinned(chat.id)) && (filter !== "linked" || linkedDesign(chat)) && chat.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(userState.isPinned(b.id)) - Number(userState.isPinned(a.id)) || b.updatedAt.localeCompare(a.updatedAt));
  return {
    ...conversation, ...viewport, backendURL, base: cache.base, chats, selectedChatId, setSelectedChatId, selectedChat, selectedLinked: linkedDesign(selectedChat ?? undefined),
    query, setQuery, selectedChatIds, setSelectedChatIds, filter, setFilter, sidebarOpen, setSidebarOpen, contextMenu, setContextMenu, userState, navigateToModule,
    ...actions, ...creation,
    chatCounts, filteredChats, activeRunsByChat: Object.fromEntries(cache.chats.map(chat => [chat.id, chat.activeRunId])),
    canSend: selectedChatId ? conversation.canSend : conversation.readyToSend, stopRun: async (_run?: unknown) => conversation.stopRun(), continueRun: async (_run?: unknown) => conversation.continueRun(), refreshMessages: async (_chatId?: string) => conversation.refreshMessages()
  };
}
