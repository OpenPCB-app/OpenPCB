import {
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ArrowUp, Square, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMentions } from "../hooks/useMentions";
import { MentionAutocomplete } from "./MentionAutocomplete";
import { createMentionSyntax } from "../lib/mention-utils";
import type { MentionEntity } from "../types/mention";

/** Max grown height in px — matches the textarea's `max-h-48` (12rem) cap. */
const MAX_TEXTAREA_PX = 192;

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** Called when the user stops an in-progress generation. */
  onStop?: () => void;
  /** Streaming / running — swaps Send for Stop and disables submit. */
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Enabled tool count for the footer indicator. */
  toolCount?: number;
  /** Context-size budget in KB (from the chat's context-size preference). */
  contextBudgetKb?: number;
  /** Quick-action prompts surfaced via the `/` popover. */
  quickActions?: string[];
  /** Denser layout for the narrow docked panel. */
  compact?: boolean;
  /** Backend URL for mention search. */
  backendURL?: string | null;
  /** Workspace ID for mention search. */
  workspaceId?: string;
  /** Chat ID for mention search context. */
  chatId?: string;
}

/**
 * Rich composer card shared by the standalone Assistant view and the docked
 * panel: `/`-command popover, auto-growing multiline input, send/stop, and a
 * footer with tool count + context budget + keyboard hints.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  busy = false,
  disabled = false,
  placeholder = "Ask about your PCB, or describe what to build…",
  toolCount,
  contextBudgetKb = 64,
  quickActions = [],
  compact = false,
  backendURL,
  workspaceId,
  chatId,
}: ChatComposerProps): ReactElement {
  const [slashOpen, setSlashOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mentionsEnabled = Boolean(workspaceId);
  const { suggestions, isLoading: mentionLoading, search: searchMentions, clear: clearMentions } =
    useMentions({
      backendURL: backendURL ?? null,
      workspaceId: workspaceId ?? "default",
      chatId,
      limit: 8,
    });

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
      }
    };
  }, []);

  const detectMentionTrigger = useCallback(
    (text: string, cursorPos: number) => {
      if (!mentionsEnabled) return null;

      const textBeforeCursor = text.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex === -1) return null;

      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;

      const queryText = textBeforeCursor.slice(atIndex + 1);
      if (/\s/.test(queryText)) return null;

      return { triggerPos: atIndex, query: queryText };
    },
    [mentionsEnabled],
  );

  const handleMentionSelect = useCallback(
    (entity: MentionEntity) => {
      if (mentionTriggerPos === null) return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      const mentionSyntax = `${createMentionSyntax(entity.entityType, entity.id, entity.displayText)} `;
      const before = value.slice(0, mentionTriggerPos);
      const after = value.slice(textarea.selectionStart);
      const next = before + mentionSyntax + after;

      onChange(next);
      setMentionOpen(false);
      setMentionTriggerPos(null);
      clearMentions();

      requestAnimationFrame(() => {
        const newCursorPos = before.length + mentionSyntax.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      });
    },
    [mentionTriggerPos, value, onChange, clearMentions],
  );

  const handleChange = (next: string) => {
    onChange(next);
    setSlashOpen(next.trim() === "/" && quickActions.length > 0);

    const textarea = textareaRef.current;
    if (!textarea || !mentionsEnabled) return;

    const cursorPos = textarea.selectionStart;
    const trigger = detectMentionTrigger(next, cursorPos);

    if (trigger) {
      setMentionOpen(true);
      setMentionTriggerPos(trigger.triggerPos);
      setMentionIndex(0);

      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
      }
      mentionSearchTimeoutRef.current = setTimeout(() => {
        void searchMentions(trigger.query);
      }, 150);
    } else {
      setMentionOpen(false);
      setMentionTriggerPos(null);
      clearMentions();
    }
  };

  const handleKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setSlashOpen(false);
      if (mentionOpen) {
        setMentionOpen(false);
        setMentionTriggerPos(null);
        clearMentions();
        return;
      }
    }

    if (mentionOpen && suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        handleMentionSelect(suggestions[mentionIndex]!);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!busy && value.trim()) {
        setSlashOpen(false);
        setMentionOpen(false);
        setMentionTriggerPos(null);
        clearMentions();
        onSubmit();
      }
    }
  };

  const pickQuickAction = (prompt: string) => {
    onChange(prompt);
    setSlashOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div className="relative">
      <MentionAutocomplete
        suggestions={suggestions}
        isLoading={mentionLoading}
        isOpen={mentionOpen}
        selectedIndex={mentionIndex}
        onSelect={handleMentionSelect}
        onClose={() => {
          setMentionOpen(false);
          setMentionTriggerPos(null);
          clearMentions();
        }}
        anchorRef={textareaRef as React.RefObject<HTMLElement>}
      />
      {slashOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-400">
            Quick actions
          </div>
          {quickActions.map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => pickQuickAction(action)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="font-mono text-[10px] text-accent-text">/</span>
              {action}
            </button>
          ))}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-violet-400 dark:border-violet-500/20 dark:bg-slate-900 dark:focus-within:border-violet-500/50">
        {/* Top meta: slash + mention hints */}
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-3 py-1 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-black/10">
          <span className="inline-flex items-center gap-1">
            Type
            <span className="rounded bg-slate-200 px-1 font-mono text-slate-500 dark:bg-slate-800">
              /
            </span>
            for commands
          </span>
          {mentionsEnabled ? (
            <span className="inline-flex items-center gap-1">
              Type
              <span className="rounded bg-slate-200 px-1 font-mono text-slate-500 dark:bg-slate-800">
                @
              </span>
              to reference docs, components, or designs
            </span>
          ) : null}
        </div>

        {/* Input row */}
        <div className="flex items-end gap-2 px-2.5 py-2">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled}
            rows={compact ? 2 : 1}
            placeholder={placeholder}
            className={cn(
              "max-h-48 min-h-0 w-full resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100",
              compact ? "py-1" : "py-1.5",
            )}
          />
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop generating"
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => value.trim() && onSubmit()}
              disabled={disabled || !value.trim()}
              aria-label="Send"
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Footer meta: tools · context budget · shortcuts */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-3 py-1 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-black/10">
          <div className="flex min-w-0 items-center gap-2">
            {typeof toolCount === "number" ? (
              <span className="inline-flex items-center gap-1">
                <Wrench className="h-3 w-3 text-status-success" />
                {toolCount} tools
              </span>
            ) : null}
            <span className="text-slate-300 dark:text-slate-600">·</span>
            <span
              className="inline-flex items-center gap-1.5"
              title="Context budget for grounded tool data"
            >
              <span className="relative inline-block h-1 w-8 rounded-pill bg-slate-200 dark:bg-slate-700">
                <span className="absolute left-0 top-0 h-full w-1/4 rounded-pill bg-status-success" />
              </span>
              {contextBudgetKb}k context
            </span>
          </div>
          {!compact ? (
            <div className="flex shrink-0 items-center gap-2">
              <span>
                <kbd className="rounded bg-slate-200 px-1 font-mono dark:bg-slate-800">
                  ⏎
                </kbd>{" "}
                send
              </span>
              <span>
                <kbd className="rounded bg-slate-200 px-1 font-mono dark:bg-slate-800">
                  ⇧⏎
                </kbd>{" "}
                newline
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
