import { confirmDialog, promptDialog } from "../../../../shared/frontend/ui/dialog-host-store";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";
import { projectChat } from "../agentkit-projections";
import { assistantRequest, jsonRequest } from "../client";
import { useAssistantConversation } from "./useAssistantConversation";
import { useConversationScroll } from "./useConversationScroll";

export interface DesignerConversationProps {
  backendURL: string | null | undefined;
  designId: string | null;
  designName: string | null;
  designRevision: number | null;
  onClose(): void;
  onOpenFull(chatId: string): void;
  onDesignChanged(change?: { kind: "applied" | "rejected" | "tool"; designId?: string; revision?: number }): void;
}
function designerChatActions(cache: ReturnType<typeof useAssistantConversation>["cache"], chats: ReturnType<typeof projectChat>[], selectedChatId: string | null, setSelectedChatId: (id: string | null) => void) {
  const renameChat = async (id: string) => {
    const title = await promptDialog({ title: "Rename chat", defaultValue: chats.find(chat => chat.id === id)?.title ?? "" });
    if (title?.trim()) await cache.renameChat(id, title.trim());
  };
  const deleteChat = async (id: string) => {
    if (!await confirmDialog({ title: `Delete "${chats.find(chat => chat.id === id)?.title ?? "chat"}"?`, confirmLabel: "Delete", tone: "danger" })) return;
    await cache.deleteChat(id); if (selectedChatId === id) setSelectedChatId(null);
  };
  return { renameChat, deleteChat };
}

export function useDesignerConversation(props: DesignerConversationProps) {
  const { designId, designName, onDesignChanged } = props;
  const [selection, setSelection] = useState<{ designId: string | null; chatId: string | null }>({ designId, chatId: null });
  const selectedChatId = selection.designId === designId ? selection.chatId : null;
  const setSelectedChatId = (chatId: string | null) => setSelection({ designId, chatId });
  const conversation = useAssistantConversation(selectedChatId, `design:${designId ?? "none"}`, onDesignChanged);
  const { cache, messages, setError } = conversation;
  const chats = useMemo(() => cache.chats.filter(chat => chat.metadata.designId === designId).map(projectChat), [cache.chats, designId]);
  const selectedChat = chats.find(chat => chat.id === selectedChatId) ?? null;
  const [bindingInProgress, setBindingInProgress] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<{ designId: string; chatId: string; content: string } | null>(null);
  const creating = useRef<Promise<void> | null>(null);
  const navigateToModule = useNavigationStore(state => state.navigateToModule);
  const viewport = useConversationScroll(selectedChatId, messages.map(message => `${message.id}:${message.content}`).join("|"));
  useEffect(() => { if (!selectedChatId && chats[0]) setSelectedChatId(chats[0].id); }, [chats, designId, selectedChatId]);
  const createDesignChat = async () => {
    if (!designId) throw new Error("Open a design before chatting.");
    setBindingInProgress(true);
    try {
      const chat = await cache.createChat({ designName, ...(cache.settings && cache.appSettings ? { providerId: conversation.providerId, model: conversation.model, promptPresetId: conversation.promptPresetId } : {}) });
      try { await assistantRequest(cache.base, `/v1/chats/${encodeURIComponent(chat.id)}/context-bindings`, jsonRequest("POST", { designId })); }
      catch (cause) { await cache.deleteChat(chat.id); throw cause; }
      cache.moveDraft(`design:${designId}`, chat.id);
      setSelectedChatId(chat.id); await cache.reloadChats(); return chat;
    } finally { setBindingInProgress(false); }
  };
  const submit = async (event?: FormEvent, override?: string) => {
    event?.preventDefault();
    if (bindingInProgress) return;
    if (selectedChatId) return conversation.submit(undefined, override);
    if (!designId || creating.current || !conversation.readyToSend) return;
    const content = (override ?? conversation.input).trim();
    if (!content) return;
    creating.current = createDesignChat().then(chat => setPendingPrompt({ designId, chatId: chat.id, content })).catch(cause => setError(String(cause))).finally(() => { creating.current = null; });
    await creating.current;
  };
  useEffect(() => {
    if (!pendingPrompt || pendingPrompt.designId !== designId || pendingPrompt.chatId !== selectedChatId || !conversation.canSend) return;
    setPendingPrompt(null); void conversation.submit(undefined, pendingPrompt.content);
  }, [pendingPrompt, designId, selectedChatId, conversation.canSend]);
  const actions = designerChatActions(cache, chats, selectedChatId, setSelectedChatId);
  return {
    ...conversation, ...viewport, ...props, selectedChatId, setSelectedChatId, selectedChat, chats, menuOpen, setMenuOpen, navigateToModule, createDesignChat, submit, ...actions,
    assistantBase: cache.base, canSend: !bindingInProgress && (selectedChatId ? conversation.canSend : conversation.readyToSend),
    stopRun: async (_run?: unknown) => conversation.stopRun(), refreshMessages: async (_chatId?: string) => conversation.refreshMessages()
  };
}
