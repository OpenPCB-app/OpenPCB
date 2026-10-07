import {
  ChevronDown,
  ExternalLink,
  MessageSquarePlus,
  Wrench,
  X,
} from "lucide-react";
import {
  type ReactElement
} from "react";
import { contextBudgetKb } from "./components/chat-format";
import { ChatComposer } from "./components/ChatComposer";
import { ModelSelectorPill } from "./components/ModelSelectorPill";
import type { MentionReference } from "./types/mention";



import type { AssistantChat } from "../../../sdks/assistant";
import { MessageCard } from "./components/MessageCard";
import { ProposalActionsProvider } from "./components/ProposalActions";
import { RunVerification } from "./components/RunVerification";
import { useDesignerConversation, type DesignerConversationProps } from "./hooks/useDesignerConversation";

const QUICK_ACTIONS = [
  "Wire the schematic",
  "Resolve BOM",
  "Run ERC",
  "Suggest improvements",
];
function navigateFromMention(
  mention: MentionReference,
  navigateToModule: (
    moduleId: string,
    designId?: string,
    params?: Record<string, string>,
  ) => void,
): void {
  switch (mention.entityType) {
    case "knowledge-page":
      navigateToModule("knowledge", undefined, { pageId: mention.entityId });
      break;
    case "library-component":
      navigateToModule("library", undefined, { componentId: mention.entityId });
      break;
    case "design":
      navigateToModule("designer", mention.entityId);
      break;
  }
}


export function DesignerChatDock(props: DesignerConversationProps): ReactElement {
  const state = useDesignerConversation(props);
  const { backendURL, designId, onClose, onOpenFull, onDesignChanged, selectedChatId, setSelectedChatId, selectedChat, chats, menuOpen, setMenuOpen, navigateToModule, createDesignChat, submit, renameChat, deleteChat, assistantBase, providers, providerId, setProviderId, model, setModel, models, refreshChatModels, presets, promptPresetId, setPromptPresetId, selectedProvider, toolCount, input, setInput, loading, canSend, error, setError, scroll, messages, toolEventsByMessage, writeProposals, selectedRun, stopRun, refreshMessages, settings, verification, chat } = state;
  if (!designId) {
    return (
      <EmptyDock
        onClose={onClose}
        message="Open or create a design to use Designer Chat."
      />
    );
  }

  return (
    <ProposalActionsProvider value={state.proposalActions}><aside className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      {/* Compact 2-row header (was 4 rows of chrome). */}
      <div className="shrink-0 border-b border-slate-200 p-2.5 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex w-full items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1 text-left text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            >
              <span className="truncate">
                {selectedChat?.title ?? "No chat yet"}
                {chats.length > 1 ? (
                  <span className="ml-1 text-[10px] text-slate-500">
                    · {chats.length} chats
                  </span>
                ) : null}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
            {menuOpen ? (
              <ThreadMenu
                chats={chats}
                selectedChatId={selectedChatId}
                onSelect={(id) => {
                  setSelectedChatId(id);
                  setMenuOpen(false);
                }}
                onNew={() =>
                  void createDesignChat().catch(cause => setError(String(cause))).finally(() => setMenuOpen(false))
                }
                onRename={(id) =>
                  void renameChat(id)
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                    .finally(() => setMenuOpen(false))
                }
                onDelete={(id) =>
                  void deleteChat(id)
                    .catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                    .finally(() => setMenuOpen(false))
                }
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void createDesignChat().catch(cause => setError(String(cause)))}
            className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
            title="New design chat"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => selectedChatId && onOpenFull(selectedChatId)}
            disabled={!selectedChatId}
            className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-800 dark:hover:bg-slate-900"
            title="Open in Assistant view"
            aria-label="Open in Assistant view"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-800 dark:hover:bg-slate-900"
            title="Close chat"
            aria-label="Close chat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-2">
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
            align="left"
          />
          {toolCount !== null ? (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-control border border-slate-200 px-1.5 py-1 text-[10px] text-slate-500 dark:border-slate-700"
              title={`${toolCount} grounded tools`}
            >
              <Wrench className="h-3 w-3 text-status-success" />
              {toolCount}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-[10px] text-slate-500">
            {relativeTime(
              selectedChat?.lastMessageAt ?? selectedChat?.updatedAt ?? null,
            )}
          </span>
        </div>
      </div>
      <div
        ref={scroll.scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        {error ? (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        ) : null}
        <RunVerification event={verification} truncated={chat.truncated} finishReason={chat.finishReason} />
        {messages.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">
            Ask about the active design, components, nets, ERC, or PCB layout.
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
                assistantBaseUrl={assistantBase}
                backendURL={backendURL}
                writeProposals={writeProposals}
                onProposalChanged={(change) => {
                  if (selectedChatId) void refreshMessages(selectedChatId);
                  onDesignChanged(change);
                }}
                runState={
                  selectedRun?.assistantMessageId === message.id
                    ? selectedRun
                    : null
                }
                onRetryRun={() => void state.continueRun()}
                onStopRun={(run) =>
                  void stopRun(run).catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
                }
                onSendPrompt={
                  !canSend
                    ? undefined
                    : (prompt) => void submit(undefined, prompt)
                }
                onMentionClick={(mention) =>
                  navigateFromMention(mention, navigateToModule)
                }
                loading={
                  loading &&
                  idx === lastAssistantIdx &&
                  message.role === "assistant"
                }
                compact
              />
            ));
          })()
        )}
      </div>
      <div className="shrink-0 border-t border-slate-200 p-2.5 dark:border-slate-800">
        <ChatComposer
          value={input}
          onChange={setInput}
          onSubmit={() => void submit()}
          onStop={
            selectedRun
              ? () =>
                void stopRun(selectedRun).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              : undefined
          }
          busy={loading}
          disabled={!canSend && !loading}
          placeholder="Ask about this design…"
          toolCount={toolCount ?? undefined}
          contextBudgetKb={contextBudgetKb(settings?.contextSizePreference)}
          quickActions={QUICK_ACTIONS}
          backendURL={backendURL}
          workspaceId="default"
          chatId={selectedChatId ?? undefined}
          compact
        />
      </div>
    </aside></ProposalActionsProvider>
  );
}

function EmptyDock({
  onClose,
  message,
}: {
  onClose(): void;
  message: string;
}): ReactElement {
  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-hidden border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 p-3 dark:border-slate-800">
        <div className="text-sm font-semibold">Chat</div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">
        {message}
      </div>
    </aside>
  );
}

function ThreadMenu({
  chats,
  selectedChatId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  chats: AssistantChat[];
  selectedChatId: string | null;
  onSelect(id: string): void;
  onNew(): void;
  onRename(id: string): void;
  onDelete(id: string): void;
}): ReactElement {
  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto rounded border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-950">
      <button
        type="button"
        onClick={onNew}
        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-900"
      >
        New chat for this design
      </button>
      {chats.map((chat) => (
        <div
          key={chat.id}
          className={`rounded px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-900 ${chat.id === selectedChatId ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200" : ""}`}
        >
          <button
            type="button"
            onClick={() => onSelect(chat.id)}
            className="w-full text-left"
          >
            <div className="truncate">{chat.title}</div>
            <div className="truncate text-[10px] text-slate-500">
              {chat.model}
            </div>
          </button>
          <div className="mt-1 flex gap-2 text-[10px]">
            <button
              type="button"
              onClick={() => onRename(chat.id)}
              className="text-slate-500 hover:text-violet-600"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => onDelete(chat.id)}
              className="text-red-500 hover:text-red-600"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "new";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
