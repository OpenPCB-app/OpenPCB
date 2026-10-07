import {
  Archive,
  Link2,
  MoreHorizontal,
  PanelLeftClose,
  Pin,
  Plus,
  Search
} from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement
} from "react";
import {
  relativeTime
} from "./chat-format";

import { linkedDesign, type useAssistantSpace } from "../hooks/useAssistantSpace";

export function AssistantSidebar({ state }: { state: ReturnType<typeof useAssistantSpace> }): ReactElement {
  const { selectedChatId, setSelectedChatId, query, setQuery, selectedChatIds, setSelectedChatIds, filter, setFilter, sidebarOpen, setSidebarOpen, setContextMenu, userState, deleteSelectedChats, createChat, chatCounts, filteredChats, activeRunsByChat, model, selectedProvider, input, setError, chat } = state;
  return (<>
    {sidebarOpen ? (
      <aside className="flex w-80 min-w-0 flex-col border-r border-border bg-surface-panel dark:border-border dark:bg-surface-panel/80">
        <div className="border-b border-border p-3 dark:border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Chats</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                aria-label="Collapse sidebar"
                className="rounded p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text dark:hover:bg-surface-panel dark:hover:text-text"
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
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-sm text-text-secondary dark:border-border dark:bg-surface-panel dark:text-text-secondary">
            <Search className="h-3.5 w-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search chats"
              name="assistant-chat-search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs text-text outline-none placeholder:text-text-secondary dark:text-text"
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
                className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[10px] ${filter === f.key
                    ? "bg-accent-soft text-accent-text"
                    : "text-text-secondary hover:bg-surface-hover dark:text-text-secondary dark:hover:bg-surface-panel"
                  }`}
              >
                {"icon" in f ? f.icon : null}
                {f.label}
                <span
                  className={
                    filter === f.key ? "text-accent-text" : "text-text-secondary"
                  }
                >
                  {f.count}
                </span>
              </button>
            ))}
          </div>
          {selectedChatIds.size > 0 ? (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-surface-hover px-3 py-2 text-xs text-text dark:border-border dark:bg-surface-panel dark:text-text-secondary">
              <span>{selectedChatIds.size} selected</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedChatIds(new Set())}
                  className="text-text-secondary hover:text-text dark:text-text-secondary dark:hover:text-text"
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
                  className="rounded bg-status-danger-soft px-2 py-1 font-semibold text-status-danger hover:bg-status-danger-soft dark:bg-status-danger-soft/60 dark:text-status-danger dark:hover:bg-status-danger-soft/70"
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
              className={`group flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${selectedChatId === chat.id
                  ? "border-selection bg-surface-selected text-text dark:border-selection dark:bg-primary/10 dark:text-text"
                  : "border-transparent text-text-secondary hover:bg-surface-hover hover:text-text dark:text-text-secondary dark:hover:bg-surface-panel/50 dark:hover:text-text"
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
                  className="h-3.5 w-3.5 shrink-0 rounded border-border bg-surface-panel dark:border-border dark:bg-surface-panel"
                  aria-label={`Select ${chat.title}`}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  {activeRunsByChat[chat.id] ? (
                    <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-surface-selected" />
                  ) : null}
                  <div className="truncate text-sm font-medium">
                    {chat.title}
                  </div>
                </div>
                {userState.isPinned(chat.id) ? (
                  <Pin className="h-3 w-3 shrink-0 text-status-warning" />
                ) : null}
                {userState.isArchived(chat.id) ? (
                  <Archive className="h-3 w-3 shrink-0 text-text-secondary" />
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
                  className="rounded p-1 text-text-secondary opacity-0 transition-opacity hover:bg-surface-hover hover:text-text group-hover:opacity-100 dark:text-text-secondary dark:hover:bg-surface-hover dark:hover:text-text"
                  aria-label={`Chat actions for ${chat.title}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </div>
              {linkedDesign(chat) ? (
                <span className="inline-flex w-fit max-w-full items-center gap-1 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-accent-text dark:bg-surface-panel">
                  <Link2 className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{linkedDesign(chat)!.name}</span>
                </span>
              ) : null}
              <div
                className="flex items-center gap-1.5 text-left text-[11px] text-text-secondary"
                title={chat.model}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
                {relativeTime(chat.lastMessageAt ?? chat.updatedAt)}
              </div>
            </div>
          ))}
          {filteredChats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-text-secondary dark:border-border">
              No chats yet.
            </div>
          ) : null}
        </div>
        <div className="border-t border-border p-3 dark:border-border">
          <div className="flex items-center gap-2 text-xs">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-success" />
            <span className="min-w-0 flex-1 truncate font-medium text-text dark:text-text">
              {model}
            </span>
            <span className="shrink-0 text-[10px] text-text-secondary">
              {selectedProvider?.kind === "lmstudio" ||
                selectedProvider?.kind === "omlx"
                ? "Local"
                : (selectedProvider?.label ?? "Cloud")}
            </span>
          </div>
        </div>
      </aside>
    ) : null}

  </>);
}
