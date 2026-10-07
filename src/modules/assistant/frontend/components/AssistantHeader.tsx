import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import {
  Archive,
  Download,
  Link2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftOpen,
  Pencil,
  Trash2,
  Wrench
} from "lucide-react";
import {
  type ReactElement
} from "react";
import { ModelSelectorPill } from "./ModelSelectorPill";

import { type useAssistantSpace } from "../hooks/useAssistantSpace";

export function AssistantHeader({ state }: { state: ReturnType<typeof useAssistantSpace> }): ReactElement {
  const { selectedChatId, selectedChat, selectedLinked, sidebarOpen, setSidebarOpen, userState, navigateToModule, editingTitle, setEditingTitle, titleDraft, setTitleDraft, titleCommitting, beginRename, commitTitle, exportMarkdown, deleteChat, createChat, providers, providerId, setProviderId, model, setModel, models, refreshChatModels, presets, promptPresetId, setPromptPresetId, selectedProvider, chatOnly, toolCount, input, setError, messages } = state;
  return (<>
    <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-surface-panel px-6 dark:border-border dark:bg-surface-panel/95">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!sidebarOpen ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="Show chats"
              title="Show chats"
              className="rounded-control border border-border p-1.5 text-text-secondary hover:bg-surface-hover dark:border-border dark:text-text-secondary dark:hover:bg-surface-panel"
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
              className="rounded-control border border-border p-1.5 text-text-secondary hover:bg-surface-hover dark:border-border dark:text-text-secondary dark:hover:bg-surface-panel"
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <div className="mx-1 h-5 w-px bg-surface-hover dark:bg-surface-panel" />
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
            className="min-w-0 flex-1 rounded border border-border bg-surface-panel px-2 py-1 text-sm font-medium text-text outline-none focus-visible:border-selection disabled:opacity-60 dark:border-border dark:bg-surface-panel dark:text-text"
          />
        ) : (
          <button
            type="button"
            onClick={beginRename}
            disabled={!selectedChat}
            className="group flex min-w-0 items-center gap-1.5 text-left"
            title="Rename chat"
          >
            <span className="truncate text-sm font-medium text-text dark:text-text">
              {selectedChat?.title ?? "New chat"}
            </span>
            {selectedChat ? (
              <Pencil className="h-3 w-3 shrink-0 text-text-secondary opacity-0 group-hover:opacity-100 dark:text-text-secondary" />
            ) : null}
          </button>
        )}
        {selectedLinked ? (
          <button
            type="button"
            onClick={() => navigateToModule("designer", selectedLinked.id)}
            className="inline-flex shrink-0 items-center gap-1 rounded-control border border-border bg-surface-panel px-2 py-1 text-[11px] text-accent-text hover:bg-surface-hover dark:border-border dark:bg-surface-panel dark:hover:bg-surface-panel"
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
        {chatOnly ? (
          <span
            className="inline-flex items-center gap-1 rounded-control border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-secondary dark:border-border dark:bg-surface-panel dark:text-text-secondary"
            title="Tools are disabled for this provider — answers are not grounded"
          >
            <Wrench className="h-3 w-3 text-text-secondary" />
            <span>tools off</span>
          </span>
        ) : toolCount !== null ? (
          <span
            className="inline-flex items-center gap-1 rounded-control border border-border bg-surface-panel px-2 py-1 text-[11px] text-text-secondary dark:border-border dark:bg-surface-panel dark:text-text-secondary"
            title={`${toolCount} grounded tools available`}
          >
            <Wrench className="h-3 w-3 text-status-success" />
            {toolCount}
            <span className="text-text-secondary">tools</span>
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
              className="rounded-control border border-border p-1.5 text-text-secondary hover:bg-surface-hover disabled:opacity-40 dark:border-border dark:text-text-secondary dark:hover:bg-surface-panel"
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

  </>);
}
