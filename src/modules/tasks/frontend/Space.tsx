import { useEffect, useState, type ReactElement } from "react";
import type { ModuleSpaceProps } from "../../../core/contracts/modules/frontend-entry";
import type { Task } from "../../../sdks/tasks";

export function TasksSpace({ backendURL, moduleId }: ModuleSpaceProps): ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backendURL) return;
    let cancelled = false;
    fetch(`${backendURL}/api/modules/${moduleId}/tasks?limit=50`)
      .then((response) => response.json())
      .then((data: Task[]) => {
        if (!cancelled) setTasks(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [backendURL, moduleId]);

  return (
    <div className="flex h-full flex-col bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <h1 className="text-xl font-semibold">Tasks</h1>
      <p className="mt-1 text-sm text-slate-500">Runtime monitor for background work.</p>
      {error ? <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {tasks.map((task) => (
          <div key={task.id} className="border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 dark:border-slate-800">
            <div className="font-medium">{task.type}</div>
            <div className="text-xs text-slate-500">{task.id} · {task.status}</div>
          </div>
        ))}
        {tasks.length === 0 ? <div className="p-4 text-sm text-slate-500">No tasks yet.</div> : null}
      </div>
    </div>
  );
}
