import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import { useNavigationStore } from "../../../core/frontend/src/stores/navigation-store";
import { localApiFetch } from "../../../shared/frontend/http/local-api";
import type { TaskRunPage, TaskRunSummary } from "../../../sdks/tasks";
import type { AssistantUnavailable as Unavailable } from "../../../sdks/assistant/availability";
import {
  AssistantUnavailable,
  assistantUnavailableFromProblem,
} from "../../../shared/frontend/assistant/AssistantUnavailable";

const MALFORMED = "The run monitor returned a malformed response.";

function problemMessage(body: unknown, status: number): string {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  for (const key of ["detail", "title"]) {
    const text = value[key];
    if (typeof text === "string" && text.trim()) return text;
  }
  return `Request failed (${status})`;
}

/** The assistant degraded at boot; its run routes carry the same reason the Assistant space shows. */
class AssistantUnavailableFailure extends Error {
  constructor(readonly availability: Unavailable) { super(availability.message); }
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { if (response.ok) throw new Error(MALFORMED); }
  if (!response.ok) {
    const unavailable = assistantUnavailableFromProblem(body);
    if (unavailable) throw new AssistantUnavailableFailure(unavailable);
    throw new Error(problemMessage(body, response.status));
  }
  return body;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// Rows render server fields directly, so anything not shaped like a run must fail here, not in React.
function readRun(value: unknown): TaskRunSummary {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!item || typeof item.taskId !== "string" || typeof item.status !== "string") throw new Error(MALFORMED);
  return {
    taskId: item.taskId, kind: String(item.kind ?? ""), scopeId: String(item.scopeId ?? ""),
    status: item.status as TaskRunSummary["status"], enqueuedAt: String(item.enqueuedAt ?? ""),
    startedAt: optionalText(item.startedAt), finishedAt: optionalText(item.finishedAt),
    attemptCount: typeof item.attemptCount === "number" ? item.attemptCount : 0,
    error: item.error == null ? undefined : typeof item.error === "string" ? item.error : JSON.stringify(item.error),
    chatId: optionalText(item.chatId) ?? null, designId: optionalText(item.designId) ?? null,
  };
}

function readPage(body: unknown): TaskRunPage {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : null;
  if (!value || !Array.isArray(value.items) || (value.nextCursor !== null && typeof value.nextCursor !== "string")) {
    throw new Error(MALFORMED);
  }
  return { items: value.items.map(readRun), nextCursor: value.nextCursor };
}

function withoutDuplicates(head: TaskRunSummary[], tail: TaskRunSummary[]): TaskRunSummary[] {
  const seen = new Set(head.map((task) => task.taskId));
  return [...head, ...tail.filter((task) => !seen.has(task.taskId))];
}

type RefreshMode = "poll" | "full" | "more";

export function TasksSpace({ backendURL }: ModuleSpaceProps): ReactElement {
  const [tasks, setTasks] = useState<TaskRunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailable | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const pages = useRef(1);
  const cursor = useRef<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const signal = useRef<AbortSignal | null>(null);
  const navigate = useNavigationStore((state) => state.navigateToModule);
  const base = `${backendURL ?? ""}/api/modules/assistant/v1/runs`;

  const fetchPage = useCallback(async (after: string | null, abort: AbortSignal) => {
    const query = new URLSearchParams({ limit: "50" });
    if (after) query.set("cursor", after);
    return readPage(await readResponse(await localApiFetch(`${base}?${query}`, { signal: abort })));
  }, [base]);

  const load = useCallback(async (mode: RefreshMode, abort: AbortSignal) => {
    try {
      if (mode === "more") {
        if (!cursor.current) return;
        const next = await fetchPage(cursor.current, abort);
        if (abort.aborted) return;
        pages.current++;
        cursor.current = next.nextCursor;
        setTasks((current) => withoutDuplicates(current, next.items)); setNextCursor(next.nextCursor); setError(null); setUnavailable(null);
        return;
      }
      if (mode === "poll" && pages.current > 1) {
        // Later pages hold older runs; a tick refreshes the head instead of replaying every loaded page.
        const first = await fetchPage(null, abort);
        if (!abort.aborted) { setTasks((current) => withoutDuplicates(first.items, current)); setError(null); setUnavailable(null); }
        return;
      }
      const items: TaskRunSummary[] = [];
      let after: string | null = null;
      for (let page = 0; page < pages.current; page++) {
        const result = await fetchPage(after, abort);
        items.push(...result.items);
        after = result.nextCursor;
        if (!after) break;
      }
      if (!abort.aborted) { cursor.current = after; setTasks(items); setNextCursor(after); setError(null); setUnavailable(null); }
    } catch (failure) {
      if (abort.aborted) return;
      if (failure instanceof AssistantUnavailableFailure) { setUnavailable(failure.availability); setError(null); return; }
      setError(failure instanceof Error ? failure.message : "Runs could not be loaded.");
    } finally { if (!abort.aborted) setLoading(false); }
  }, [fetchPage]);

  // One request chain at a time: a poll tick never aborts or overlaps a slow response;
  // an explicit refresh during one runs once more after it so it sees post-action state.
  const refresh = useCallback((mode: RefreshMode): Promise<void> => {
    const abort = signal.current;
    if (!backendURL || !abort) { setError("Backend is unavailable."); setLoading(false); return Promise.resolve(); }
    if (running.current) {
      if (mode === "full") queued.current = true;
      return running.current;
    }
    let chain!: Promise<void>;
    chain = (async () => {
      let next: RefreshMode = mode;
      try {
        for (;;) {
          queued.current = false;
          await load(next, abort);
          if (!queued.current || abort.aborted) return;
          next = "full";
        }
      } finally { if (running.current === chain) running.current = null; }
    })();
    running.current = chain;
    return chain;
  }, [backendURL, load]);

  useEffect(() => {
    const controller = new AbortController();
    signal.current = controller.signal;
    pages.current = 1;
    setLoading(true);
    void refresh("full");
    const timer = setInterval(() => { if (!running.current) void refresh("poll"); }, 5_000);
    return () => {
      clearInterval(timer); controller.abort();
      signal.current = null; running.current = null; queued.current = false;
    };
  }, [refresh]);

  const loadMore = async () => {
    while (running.current) await running.current;
    await refresh("more");
  };

  const lifecycle = async (task: TaskRunSummary, action: "cancel" | "resume") => {
    setBusyRun(task.taskId);
    try {
      await readResponse(await localApiFetch(`${base}/${encodeURIComponent(task.taskId)}/${action}`, { method: "POST" }));
      await refresh("full");
    } catch (failure) {
      if (failure instanceof AssistantUnavailableFailure) setUnavailable(failure.availability);
      else setError(failure instanceof Error ? failure.message : "Run action failed.");
    }
    finally { setBusyRun(null); }
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-surface-app p-6 text-text-strong">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => { void refresh("full"); }}>Refresh</button>
      </div>
      <p className="mt-1 text-sm text-text-tertiary">Assistant runs. Stop preserves completed design changes; Continue resumes interrupted work.</p>
      {error ? (
        <div className="mt-4 flex items-start justify-between gap-3 rounded border border-status-danger/30 p-3 text-sm text-status-danger">
          <div role="alert">{error}</div>
          <button className="shrink-0 rounded border px-2 py-0.5 text-xs" onClick={() => { setLoading(true); void refresh("full"); }}>Retry</button>
        </div>
      ) : null}
      {unavailable ? <div className="mt-4 flex"><AssistantUnavailable availability={unavailable} compact /></div> : (
      <div className="mt-4 rounded-xl border border-border bg-surface-card">
        {tasks.map((task) => (
          <div key={task.taskId} className="flex items-start justify-between gap-4 border-b px-4 py-3 text-sm last:border-b-0">
            <div className="min-w-0">
              <div className="font-medium">{task.kind === "chat.turn" || task.kind === "openpcb.local-chat-turn" ? "Assistant turn" : task.kind}</div>
              <div className="break-all text-xs text-text-tertiary">{task.taskId} · {task.status} · {new Date(task.enqueuedAt).toLocaleString()}</div>
              {task.error ? <p className="mt-1 text-sm text-status-danger">{task.error}</p> : null}
              <div className="mt-1 flex gap-3">
                {task.chatId ? <button className="text-status-info underline" onClick={() => navigate("assistant", undefined, { chatId: task.chatId! })}>Open chat</button> : null}
                {task.designId ? <button className="text-status-info underline" onClick={() => navigate("designer", task.designId!)}>Open design</button> : null}
              </div>
            </div>
            {["queued", "running", "waiting_approval"].includes(task.status) ? (
              <button disabled={busyRun === task.taskId} className="rounded border px-3 py-1 disabled:opacity-50" onClick={() => { void lifecycle(task, "cancel"); }}>Stop</button>
            ) : task.status === "interrupted" ? (
              <button disabled={busyRun === task.taskId} className="rounded border px-3 py-1 disabled:opacity-50" onClick={() => { void lifecycle(task, "resume"); }}>Continue</button>
            ) : null}
          </div>
        ))}
        {loading ? <div role="status" className="p-4 text-sm text-text-tertiary">Loading runs…</div> : !error && tasks.length === 0 ? <div className="p-4 text-sm text-text-tertiary">No assistant runs yet.</div> : null}
      </div>
      )}
      {nextCursor && !unavailable ? <button className="mt-4 self-start rounded border px-3 py-2 text-sm" onClick={() => { void loadMore(); }}>Load more runs</button> : null}
    </div>
  );
}
