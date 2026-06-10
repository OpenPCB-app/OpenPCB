import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Check,
  CheckCheck,
  ImagePlus,
  MoreHorizontal,
  Send,
  X,
} from "lucide-react";
import type {
  DesignerCommentMessage,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
} from "@sdks/designer";
import { IconButton } from "@shared/frontend/ui/icon-button";
import { Textarea } from "@shared/frontend/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Markdown } from "./comment-markdown";
import {
  displayNameFrom,
  formatRelativeTime,
  initialsFrom,
} from "./comment-format";

const POPUP_WIDTH = 320;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TODO_LABELS: Record<DesignerCommentTodoStatus, string> = {
  none: "No status",
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

export interface CommentThreadPopupProps {
  thread: DesignerCommentThread;
  /** Wrapper-relative screen px of the pin tip. */
  screen: { x: number; y: number };
  rect: { width: number; height: number };
  currentUserEmail: string | null;
  attachmentUrl: (attachmentId: string) => string;
  onClose: () => void;
  onAddMessage: (
    thread: DesignerCommentThread,
    body: string,
    file?: File | null,
  ) => Promise<void>;
  onSetStatus: (
    thread: DesignerCommentThread,
    status: DesignerCommentThreadStatus,
  ) => Promise<void>;
  onSetTodoStatus: (
    thread: DesignerCommentThread,
    todoStatus: DesignerCommentTodoStatus,
  ) => Promise<void>;
  onToggleReaction: (
    thread: DesignerCommentThread,
    messageId: string,
    emoji: string,
  ) => Promise<void>;
}

function Avatar({ name }: { name: string | null }): ReactElement {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-semibold uppercase text-white">
      {initialsFrom(name)}
    </span>
  );
}

function MessageItem({
  message,
  thread,
  attachmentUrl,
  onToggleReaction,
}: {
  message: DesignerCommentMessage;
  thread: DesignerCommentThread;
  attachmentUrl: (attachmentId: string) => string;
  onToggleReaction: CommentThreadPopupProps["onToggleReaction"];
}): ReactElement {
  const thumbs = message.reactions.find((r) => r.emoji === "👍");
  const images = message.attachments.filter((a) => !a.deletedAt);
  return (
    <div className="flex gap-2">
      <Avatar name={message.createdBy} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
            {displayNameFrom(message.createdBy)}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
        {message.body ? (
          <Markdown text={message.body} />
        ) : (
          <em className="text-xs text-slate-400">deleted</em>
        )}
        {images.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {images.map((att) => (
              <a
                key={att.id}
                href={attachmentUrl(att.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
              >
                <img
                  src={attachmentUrl(att.id)}
                  alt={att.fileName}
                  className="h-20 w-auto max-w-[160px] object-cover"
                />
              </a>
            ))}
          </div>
        ) : null}
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => void onToggleReaction(thread, message.id, "👍")}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors",
              thumbs?.reactedByMe
                ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-950/50 dark:text-violet-300"
                : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800",
            )}
          >
            <span>👍</span>
            {thumbs && thumbs.count > 0 ? <span>{thumbs.count}</span> : null}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Floating, pin-anchored comment thread (header · messages · composer). */
export function CommentThreadPopup({
  thread,
  screen,
  rect,
  currentUserEmail: _currentUserEmail,
  attachmentUrl,
  onClose,
  onAddMessage,
  onSetStatus,
  onSetTodoStatus,
  onToggleReaction,
}: CommentThreadPopupProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: screen.x + 16,
    top: Math.max(8, screen.y - 48),
  });
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const resolved = thread.status === "resolved";
  const messages = thread.messages ?? [];

  // Clamp/flip the popup within the canvas rect after measuring.
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? POPUP_WIDTH;
    const h = el?.offsetHeight ?? 240;
    let left = screen.x + 16;
    if (left + w > rect.width - 8) left = screen.x - w - 16;
    left = Math.min(Math.max(left, 8), Math.max(8, rect.width - w - 8));
    let top = screen.y - 48;
    top = Math.min(Math.max(top, 8), Math.max(8, rect.height - h - 8));
    setPos({ left, top });
  }, [screen.x, screen.y, rect.width, rect.height, messages.length]);

  // Esc + click-away close (defer the click-away listener one tick so the
  // opening click doesn't immediately dismiss the popup).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const timer = window.setTimeout(
      () => document.addEventListener("mousedown", onDown),
      0,
    );
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const pickFile = (selected: File | null) => {
    setFileError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type)) {
      setFileError("Only PNG, JPEG, or WebP images.");
      return;
    }
    if (selected.size > MAX_IMAGE_BYTES) {
      setFileError("Image must be 5 MB or smaller.");
      return;
    }
    setFile(selected);
  };

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setPending(true);
    void onAddMessage(thread, trimmed, file)
      .then(() => {
        setBody("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      })
      .finally(() => setPending(false));
  };

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute z-40 flex max-h-[70%] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ left: pos.left, top: pos.top }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <Avatar name={thread.createdBy} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-slate-900 dark:text-slate-100">
            {displayNameFrom(thread.createdBy)}
          </div>
          <div className="text-[10px] text-slate-400">
            {formatRelativeTime(thread.createdAt)}
            {thread.todoStatus !== "none"
              ? ` · ${TODO_LABELS[thread.todoStatus]}`
              : ""}
          </div>
        </div>
        <IconButton
          label={resolved ? "Reopen thread" : "Resolve thread"}
          size="sm"
          onClick={() =>
            void onSetStatus(thread, resolved ? "open" : "resolved")
          }
          className={cn(resolved && "text-green-600 dark:text-green-400")}
        >
          {resolved ? (
            <CheckCheck className="h-4 w-4" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </IconButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="More" size="sm">
              <MoreHorizontal className="h-4 w-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {(Object.keys(TODO_LABELS) as DesignerCommentTodoStatus[]).map(
              (status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => void onSetTodoStatus(thread, status)}
                >
                  {thread.todoStatus === status ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  {TODO_LABELS[status]}
                </DropdownMenuItem>
              ),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => void onSetStatus(thread, "archived")}
            >
              Archive thread
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="Close" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Messages */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="text-xs text-slate-400">No messages yet.</div>
        ) : (
          messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              thread={thread}
              attachmentUrl={attachmentUrl}
              onToggleReaction={onToggleReaction}
            />
          ))
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        {file ? (
          <div className="mb-1.5 flex items-center gap-2 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <ImagePlus className="h-3.5 w-3.5" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button
              type="button"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              onClick={() => pickFile(null)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        {fileError ? (
          <div className="mb-1 text-[11px] text-rose-500">{fileError}</div>
        ) : null}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={4000}
          rows={2}
          placeholder="Reply to thread…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          <IconButton
            label="Attach image"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />
          </IconButton>
          <IconButton
            label="Send"
            size="sm"
            disabled={pending || !body.trim()}
            onClick={submit}
            className="text-violet-600 disabled:opacity-40 dark:text-violet-400"
          >
            <Send className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
