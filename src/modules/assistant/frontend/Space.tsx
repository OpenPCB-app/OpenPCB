import {
  Sparkles,
  X
} from "lucide-react";
import {
  Fragment,
  type ReactElement
} from "react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import {
  contextBudgetKb,
  dateDividerLabel,
  dayKey
} from "./components/chat-format";
import { ChatComposer } from "./components/ChatComposer";
import { MessageCard } from "./components/MessageCard";
import type { MentionReference } from "./types/mention";

import { AssistantHeader } from "./components/AssistantHeader";
import { AssistantSidebar } from "./components/AssistantSidebar";
import { ProposalActionsProvider } from "./components/ProposalActions";
import { RunVerification } from "./components/RunVerification";
import { useAssistantSpace } from "./hooks/useAssistantSpace";

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

const QUICK_ACTIONS = [
  "Wire the schematic",
  "Resolve BOM",
  "Run ERC",
  "Suggest improvements",
];


export function AssistantSpace(props: ModuleSpaceProps): ReactElement {
  const state = useAssistantSpace(props);
  const { backendURL, base, selectedChatId, filter, contextMenu, navigateToModule, renameChat, deleteChat, submit, selectedProvider, chatOnly, toolFixBusy, reprobeTools, enableToolsAnyway, toolCount, input, setInput, loading, canSend, error, setError, scroll, showNewMessagesPill, setShowNewMessagesPill, messages, toolEventsByMessage, writeProposals, selectedRun, stopRun, continueRun, refreshMessages, verification, chat, settings } = state;
  return (
    <ProposalActionsProvider value={state.proposalActions}><div className="flex h-full min-h-0 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AssistantSidebar state={state} />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <AssistantHeader state={state} />
        <div
          ref={scroll.scrollRef}
          className="relative min-h-0 flex-1 overflow-auto"
        >
          <div className="mx-auto max-w-5xl pb-48 pt-4">
            {chatOnly ? (
              <div className="mx-4 mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                <div>
                  This provider is running without grounded OpenPCB tools.
                  Answers will not use library or designer data.
                </div>
                {selectedProvider?.capabilities?.warning ? (
                  <div className="mt-1 opacity-80">
                    Probe: {selectedProvider.capabilities.warning}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={reprobeTools}
                    disabled={toolFixBusy}
                    className="rounded-control border border-amber-400 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Re-probe capabilities
                  </button>
                  <button
                    type="button"
                    onClick={enableToolsAnyway}
                    disabled={toolFixBusy}
                    className="rounded-control border border-amber-400 px-2 py-1 font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  >
                    Enable tools anyway
                  </button>
                </div>
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
            <RunVerification event={verification} truncated={chat.truncated} finishReason={chat.finishReason} />
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
                          void continueRun(run).catch((err: unknown) =>
                            setError(
                              err instanceof Error ? err.message : String(err),
                            ),
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
                  disabled={!canSend && !loading}
                  toolCount={chatOnly ? undefined : (toolCount ?? undefined)}
                  contextBudgetKb={contextBudgetKb(
                    settings?.contextSizePreference,
                  )}
                  quickActions={QUICK_ACTIONS}
                  backendURL={backendURL}
                  workspaceId="default"
                  chatId={selectedChatId ?? undefined}
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
    </div></ProposalActionsProvider>
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
