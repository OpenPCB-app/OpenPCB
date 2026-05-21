import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useAuth } from "@/cloud/AuthProvider";
import {
  getCloudProjection,
  listPersonalWorkspaceDesigns,
  type CloudDesignSummary,
  type CloudProjection,
} from "@/cloud/queries";

interface CloudDesignBrowserProps {
  open: boolean;
  onClose: () => void;
}

interface ProjectionView {
  designId: string;
  name: string;
  revision: number;
  projection: CloudProjection;
}

export function CloudDesignBrowser({
  open,
  onClose,
}: CloudDesignBrowserProps): ReactElement | null {
  const { enabled, session } = useAuth();
  const [designs, setDesigns] = useState<CloudDesignSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ProjectionView | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !session) return;
    setLoading(true);
    setError(null);
    try {
      const rows = await listPersonalWorkspaceDesigns();
      setDesigns(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [enabled, session]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const onOpenDesign = useCallback(async (d: CloudDesignSummary) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getCloudProjection(d.id);
      setView({
        designId: d.id,
        name: detail.name,
        revision: detail.revision,
        projection: detail.projection,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div className="flex h-full max-h-[80vh] w-full max-w-3xl flex-col rounded-md bg-white shadow-xl dark:bg-slate-900">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-medium">
            {view
              ? `Cloud: ${view.name} (rev ${view.revision})`
              : "Open from Cloud"}
          </h2>
          <button
            type="button"
            onClick={() => {
              if (view) setView(null);
              else onClose();
            }}
            className="rounded-sm px-2 py-1 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {view ? "Back" : "Close"}
          </button>
        </header>

        {error && (
          <div className="border-b border-red-300 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-auto p-4">
          {loading && <div className="text-xs text-slate-500">Loading…</div>}

          {!loading && !view && designs.length === 0 && (
            <div className="text-xs text-slate-500">
              No cloud designs in your personal workspace yet. Use “Link to
              Cloud” on a local design first.
            </div>
          )}

          {!loading && !view && designs.length > 0 && (
            <ul className="space-y-2">
              {designs.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-sm border border-slate-200 px-3 py-2 dark:border-slate-700"
                >
                  <div>
                    <div className="text-sm">{d.name}</div>
                    <div className="text-xs text-slate-500">
                      rev {d.revision} · {d.id}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onOpenDesign(d)}
                    className="rounded-sm border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!loading && view && (
            <ProjectionSummary projection={view.projection} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectionSummary({
  projection,
}: {
  projection: CloudProjection;
}): ReactElement {
  const partCount = Object.keys(projection.parts ?? {}).length;
  const wireCount = Object.keys(projection.wires ?? {}).length;
  const labels = Object.values(projection.labels ?? {});
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded-sm bg-slate-50 px-3 py-2 dark:bg-slate-800">
        <strong>Counts:</strong> {partCount} parts · {wireCount} wires ·{" "}
        {labels.length} labels
      </div>
      {labels.length > 0 && (
        <div>
          <h3 className="mb-1 font-medium">Labels</h3>
          <ul className="space-y-1">
            {labels.map((l) => (
              <li key={l.id} className="text-slate-600 dark:text-slate-300">
                <code>{l.text}</code> at ({l.position.x.toFixed(2)} mm,{" "}
                {l.position.y.toFixed(2)} mm)
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-slate-500">
        Read-only view (Phase A.2). Local-replay integration is Phase B.
      </p>
    </div>
  );
}
