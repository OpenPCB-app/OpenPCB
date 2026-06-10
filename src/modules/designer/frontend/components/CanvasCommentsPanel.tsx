import { useState, type ReactElement } from "react";
import type {
  DesignerCommentSurface,
  DesignerCommentThread,
  DesignerCommentThreadStatus,
  DesignerCommentTodoStatus,
} from "../../../../sdks";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\n/g, "<br />");
  return html;
}

function Markdown({ text }: { text: string }): ReactElement {
  return (
    <div
      className="prose prose-sm max-w-none text-sm text-slate-700 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 dark:prose-invert dark:text-slate-200 dark:prose-code:bg-slate-800"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

function ThreadComposer({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
}): ReactElement {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = body.trim();
        if (!trimmed) return;
        setPending(true);
        void onSubmit(trimmed)
          .then(() => setBody(""))
          .finally(() => setPending(false));
      }}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={4000}
        placeholder={placeholder}
        className="min-h-20 resize-y rounded-md border border-slate-300 bg-white p-2 text-sm text-slate-900 shadow-sm outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
      />
      <button
        type="submit"
        disabled={pending || !body.trim()}
        className="self-start rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? "Posting…" : "Post"}
      </button>
    </form>
  );
}

export function CanvasCommentsPanel({
  surface,
  threads,
  activeThread,
  commentMode,
  loading,
  error,
  onSelectThread,
  onToggleCommentMode,
  onAddMessage,
  onSetStatus,
  onSetTodoStatus,
}: {
  surface: DesignerCommentSurface;
  threads: readonly DesignerCommentThread[];
  activeThread: DesignerCommentThread | null;
  commentMode: boolean;
  loading: boolean;
  error: string | null;
  onSelectThread: (id: string) => void;
  onToggleCommentMode: () => void;
  onAddMessage: (thread: DesignerCommentThread, body: string) => Promise<void>;
  onSetStatus: (
    thread: DesignerCommentThread,
    status: DesignerCommentThreadStatus,
  ) => Promise<void>;
  onSetTodoStatus: (
    thread: DesignerCommentThread,
    status: DesignerCommentTodoStatus,
  ) => Promise<void>;
}): ReactElement {
  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Comments
          </div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            {surface}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleCommentMode}
          className={`rounded-md px-2 py-1 text-xs font-medium ${
            commentMode
              ? "bg-violet-600 text-white"
              : "border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200"
          }`}
        >
          {commentMode ? "Click canvas…" : "Comment"}
        </button>
      </div>
      {error ? <div className="px-3 py-2 text-xs text-rose-600">{error}</div> : null}
      {loading ? <div className="px-3 py-2 text-xs text-slate-500">Loading…</div> : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {threads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500 dark:border-slate-700">
            No canvas comments yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {threads.map((thread, index) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={`rounded-lg border p-2 text-left text-sm ${
                  activeThread?.id === thread.id
                    ? "border-violet-500 bg-violet-50 dark:bg-violet-950/50"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    #{index + 1} {thread.title ?? "Thread"}
                  </span>
                  <span className="text-[10px] text-slate-500">{thread.status}</span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
                  {thread.todoStatus !== "none" ? ` · ${thread.todoStatus}` : ""}
                </div>
              </button>
            ))}
          </div>
        )}

        {activeThread ? (
          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  void onSetStatus(
                    activeThread,
                    activeThread.status === "resolved" ? "open" : "resolved",
                  )
                }
                className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
              >
                {activeThread.status === "resolved" ? "Reopen" : "Resolve"}
              </button>
              <select
                value={activeThread.todoStatus}
                onChange={(event) =>
                  void onSetTodoStatus(
                    activeThread,
                    event.target.value as DesignerCommentTodoStatus,
                  )
                }
                className="rounded-md border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
              >
                <option value="none">No todo</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className="flex flex-col gap-3">
              {(activeThread.messages ?? []).map((message) => (
                <div key={message.id} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900">
                  <div className="mb-1 text-[11px] text-slate-500">
                    {message.createdBy ?? "Local"} · {new Date(message.createdAt).toLocaleString()}
                  </div>
                  {message.body ? <Markdown text={message.body} /> : <em className="text-sm text-slate-500">deleted</em>}
                </div>
              ))}
            </div>
            <div className="mt-3">
              <ThreadComposer
                placeholder="Reply with Markdown…"
                onSubmit={(body) => onAddMessage(activeThread, body)}
              />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
