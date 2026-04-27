import { useCallback, useEffect, useState } from "react";
import { FilePlus, FolderOpen, Loader2, PenTool, Trash2, X } from "lucide-react";
import { useBootstrap } from "../providers/BootstrapProvider";
import { useNavigationStore } from "../stores/navigation-store";

interface DesignSummary {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(iso);
}

function DeleteConfirmationModal({
  design,
  onConfirm,
  onCancel,
  deleting,
}: {
  design: DesignSummary;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Delete Design
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Are you sure you want to delete{" "}
          <span className="font-medium text-slate-900 dark:text-slate-100">
            {design.name}
          </span>
          ? This action cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50 dark:bg-red-700 dark:hover:bg-red-600"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HomeScreen() {
  const { backendURL, moduleRegistry } = useBootstrap();
  const navigateToModule = useNavigationStore((state) => state.navigateToModule);

  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingDesign, setDeletingDesign] = useState<DesignSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const designerModule = moduleRegistry?.modules.find((m) => m.id === "designer");
  const designerAvailable = designerModule?.status === "loaded";

  const fetchDesigns = useCallback(async () => {
    if (!backendURL) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${backendURL}/api/modules/designer/designs`);
      if (!response.ok) {
        throw new Error(`Failed to load designs: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { data?: { designs: DesignSummary[] } };
      setDesigns(payload.data?.designs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load designs");
    } finally {
      setLoading(false);
    }
  }, [backendURL]);

  useEffect(() => {
    void fetchDesigns();
  }, [fetchDesigns]);

  const handleCreateDesign = useCallback(async () => {
    if (!backendURL) return;
    setCreating(true);
    try {
      const response = await fetch(`${backendURL}/api/modules/designer/designs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(`Failed to create design: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { data?: { design: DesignSummary } };
      const design = payload.data?.design;
      if (design) {
        navigateToModule("designer", design.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create design");
    } finally {
      setCreating(false);
    }
  }, [backendURL, navigateToModule]);

  const handleOpenDesign = useCallback(
    (designId: string) => {
      navigateToModule("designer", designId);
    },
    [navigateToModule],
  );

  const handleDeleteDesign = useCallback(async () => {
    if (!backendURL || !deletingDesign) return;
    setDeleting(true);
    try {
      const response = await fetch(
        `${backendURL}/api/modules/designer/designs/${encodeURIComponent(deletingDesign.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw new Error(`Failed to delete design: HTTP ${response.status}`);
      }
      setDeletingDesign(null);
      await fetchDesigns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete design");
    } finally {
      setDeleting(false);
    }
  }, [backendURL, deletingDesign, fetchDesigns]);

  return (
    <div className="h-full w-full overflow-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              Designs
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Manage your PCB designs
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateDesign}
            disabled={creating || !designerAvailable}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus className="h-4 w-4" />
            )}
            {creating ? "Creating..." : "New Design"}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {loading ? (
          <div className="mt-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : designs.length === 0 ? (
          <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 dark:border-slate-700 dark:bg-slate-900">
            <PenTool className="h-10 w-10 text-slate-300 dark:text-slate-600" />
            <p className="mt-4 text-sm font-medium text-slate-900 dark:text-slate-100">
              No designs yet
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Create your first design to get started
            </p>
            <button
              type="button"
              onClick={handleCreateDesign}
              disabled={creating || !designerAvailable}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FilePlus className="h-4 w-4" />
              )}
              {creating ? "Creating..." : "New Design"}
            </button>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((design) => (
              <div
                key={design.id}
                className="group relative rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-violet-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-700"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {design.name}
                    </h3>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                        r{design.revision}
                      </span>
                      <span>Modified {formatRelativeTime(design.updatedAt)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeletingDesign(design)}
                    className="rounded-md p-1.5 text-slate-400 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    title="Delete design"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    Created {formatDate(design.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpenDesign(design.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 opacity-0 transition-all group-hover:opacity-100 hover:bg-violet-100 hover:text-violet-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-violet-900/40 dark:hover:text-violet-300"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deletingDesign && (
        <DeleteConfirmationModal
          design={deletingDesign}
          onConfirm={handleDeleteDesign}
          onCancel={() => setDeletingDesign(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
