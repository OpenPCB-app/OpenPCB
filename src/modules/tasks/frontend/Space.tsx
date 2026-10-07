import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import { useNavigationStore } from "../../../core/frontend/src/stores/navigation-store";
import { localApiFetch } from "../../../shared/frontend/http/local-api";
import type { TaskRunPage, TaskRunSummary } from "../../../sdks/tasks";

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const detail = body && typeof body === "object" && "detail" in body ? String(body.detail) : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return body as T;
}

export function TasksSpace({ backendURL }: ModuleSpaceProps): ReactElement {
  const [tasks, setTasks] = useState<TaskRunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const pages = useRef(1);
  const activeRequest = useRef<AbortController | null>(null);
  const navigate = useNavigationStore((state) => state.navigateToModule);
  const base = `${backendURL ?? ""}/api/modules/assistant/v1/runs`;

  const refresh = useCallback(async () => {
    if (!backendURL) { setError("Backend is unavailable."); setLoading(false); return; }
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const items: TaskRunSummary[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < pages.current; page++) {
        const query = new URLSearchParams({ limit: "50" });
        if (cursor) query.set("cursor", cursor);
        const result = await readResponse<TaskRunPage>(await localApiFetch(`${base}?${query}`, { signal: controller.signal }));
        items.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (!controller.signal.aborted) { setTasks(items); setNextCursor(cursor); setError(null); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Runs could not be loaded.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [backendURL, base]);

  useEffect(() => {
    pages.current = 1;
    setLoading(true);
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => { clearInterval(timer); activeRequest.current?.abort(); };
  }, [refresh]);

  const lifecycle = async (task: TaskRunSummary, action: "cancel" | "resume") => {
    setBusyRun(task.taskId);
    try {
      await readResponse(await localApiFetch(`${base}/${encodeURIComponent(task.taskId)}/${action}`, { method: "POST" }));
      await refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Run action failed."); }
    finally { setBusyRun(null); }
  };

  return (
    <div className="flex h-full flex-col overflow-auto bg-surface-app p-6 text-text-strong">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tasks</h1>
        <button className="rounded border px-3 py-1 text-sm" onClick={() => { void refresh(); }}>Refresh</button>
      </div>
      <p className="mt-1 text-sm text-text-tertiary">Assistant runs. Stop preserves completed design changes; Continue resumes interrupted work.</p>
      {error ? <div role="alert" className="mt-4 rounded border border-status-danger/30 p-3 text-sm text-status-danger">{error}</div> : null}
      <div className="mt-4 rounded-xl border border-border bg-surface-card">
        {tasks.map((task) => (
          <div key={task.taskId} className="flex items-start justify-between gap-4 border-b px-4 py-3 text-sm last:border-b-0">
            <div className="min-w-0">
              <div className="font-medium">{task.kind === "chat.turn" || task.kind === "openpcb.local-chat-turn" ? "Assistant turn" : task.kind}</div>
              <div className="break-all text-xs text-text-tertiary">{task.taskId} · {task.status} · {new Date(task.enqueuedAt).toLocaleString()}</div>
              {task.error ? <p className="mt-1 text-sm text-status-danger">{task.error}</p> : null}
              {task.chatId ? <button className="mt-1 text-status-info underline" onClick={() => navigate("assistant", undefined, { chatId: task.chatId! })}>Open chat</button> : null}
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
      {nextCursor ? <button className="mt-4 self-start rounded border px-3 py-2 text-sm" onClick={() => { pages.current++; void refresh(); }}>Load more runs</button> : null}
    </div>
  );
}
