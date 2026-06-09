import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ChevronDown,
  Cloud,
  CloudOff,
  FilePlus,
  LayoutGrid,
  List,
  Loader2,
  PenTool,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useBootstrap } from "../providers/BootstrapProvider";
import { useNavigationStore } from "../stores/navigation-store";
import { useAuth } from "@/cloud/AuthProvider";
import { useCloudPrefs } from "@/cloud/cloud-prefs";
import { Button } from "@shared/frontend/ui/button";
import { Chip } from "@shared/frontend/ui/chip";
import { Pill } from "@shared/frontend/ui/pill";
import { TooltipProvider } from "@shared/frontend/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DesignCard, type DesignSummary } from "./home/DesignCard";
import { useDesignUserState } from "./home/useDesignUserState";

type FilterKey = "all" | "recent" | "starred" | "archived";
type SortKey = "modified" | "created" | "name";

const SORT_LABELS: Record<SortKey, string> = {
  modified: "Modified",
  created: "Created",
  name: "Name",
};

const WEEK_MS = 7 * 86_400_000;

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
          <Button variant="secondary" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={deleting}
            icon={
              deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )
            }
          >
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Cloud-sync status pill — reflects real auth + the project-sync setting, and
// opens Settings → Account on click. (Replaces the old hardcoded "coming soon"
// placeholder.)
function CloudSyncPill() {
  const { enabled, session } = useAuth();
  const syncOn = useCloudPrefs((s) => s.projectSyncEnabled);
  const openSettings = useNavigationStore((s) => s.openSettings);
  if (!enabled) return null; // cloud not configured → no badge
  const open = () => openSettings("account");
  if (!session) {
    return (
      <Pill
        tone="warning"
        icon={<CloudOff className="h-3 w-3" />}
        className="cursor-pointer"
        title="Sign in to enable cloud sync"
        onClick={open}
      >
        Sign in to sync
      </Pill>
    );
  }
  if (!syncOn) {
    return (
      <Pill
        tone="neutral"
        icon={<CloudOff className="h-3 w-3" />}
        className="cursor-pointer"
        title="Project sync is off — manage in Settings → Account"
        onClick={open}
      >
        Sync off
      </Pill>
    );
  }
  return (
    <Pill
      tone="success"
      icon={<Cloud className="h-3 w-3" />}
      className="cursor-pointer"
      title="Cloud sync is on — manage in Settings → Account"
      onClick={open}
    >
      Cloud sync on
    </Pill>
  );
}

export function HomeScreen() {
  const { backendURL, moduleRegistry } = useBootstrap();
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);
  const userState = useDesignUserState();

  const [designs, setDesigns] = useState<DesignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingDesign, setDeletingDesign] = useState<DesignSummary | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sort, setSort] = useState<SortKey>("modified");
  const [view, setView] = useState<"grid" | "list">("grid");
  const searchRef = useRef<HTMLInputElement>(null);

  const designerModule = moduleRegistry?.modules.find(
    (m) => m.id === "designer",
  );
  const designerAvailable = designerModule?.status === "loaded";

  const fetchDesigns = useCallback(async () => {
    if (!backendURL) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${backendURL}/api/modules/designer/designs`,
      );
      if (!response.ok) {
        throw new Error(`Failed to load designs: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: { designs: DesignSummary[] };
      };
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
      const response = await fetch(
        `${backendURL}/api/modules/designer/designs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to create design: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        data?: { design: DesignSummary };
      };
      const design = payload.data?.design;
      if (design) navigateToModule("designer", design.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create design");
    } finally {
      setCreating(false);
    }
  }, [backendURL, navigateToModule]);

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

  // Keyboard: ⌘K focus search, N new design (when not typing into a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (!typing && (e.key === "n" || e.key === "N") && designerAvailable) {
        e.preventDefault();
        void handleCreateDesign();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleCreateDesign, designerAvailable]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const filtered = designs.filter((d) => {
      const archived = userState.isArchived(d.id);
      if (filter === "archived") {
        if (!archived) return false;
      } else if (archived) {
        return false;
      } else if (filter === "starred" && !userState.isStarred(d.id)) {
        return false;
      } else if (
        filter === "recent" &&
        now - new Date(d.updatedAt).getTime() > WEEK_MS
      ) {
        return false;
      }
      return q ? d.name.toLowerCase().includes(q) : true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      const key = sort === "created" ? "createdAt" : "updatedAt";
      return new Date(b[key]).getTime() - new Date(a[key]).getTime();
    });
    return sorted;
  }, [designs, query, filter, sort, userState]);

  const filterChips: { key: FilterKey; label: string; count?: number }[] = [
    { key: "all", label: "All" },
    { key: "recent", label: "Recent" },
    { key: "starred", label: "Starred", count: userState.starredCount },
    { key: "archived", label: "Archived", count: userState.archivedCount },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-full w-full overflow-auto bg-slate-50 dark:bg-slate-950">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {/* Header */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                Designs
              </h1>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {designs.length} {designs.length === 1 ? "project" : "projects"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <CloudSyncPill />
              <Button
                variant="primary"
                onClick={handleCreateDesign}
                disabled={creating || !designerAvailable}
                icon={
                  creating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FilePlus className="h-4 w-4" />
                  )
                }
              >
                {creating ? "Creating…" : "New design"}
                {!creating && (
                  <span className="ml-1 rounded bg-white/20 px-1.5 text-[10px]">
                    N
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Controls */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              {filterChips.map((c) => (
                <Chip
                  key={c.key}
                  active={filter === c.key}
                  count={
                    c.key === "all" || c.key === "recent" ? undefined : c.count
                  }
                  icon={
                    c.key === "starred" ? (
                      <Star className="h-3 w-3" />
                    ) : undefined
                  }
                  onClick={() => setFilter(c.key)}
                >
                  {c.label}
                </Chip>
              ))}
            </div>

            <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-control border border-slate-200 bg-white px-3 py-1.5 dark:border-slate-700 dark:bg-slate-900">
              <Search className="h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
                placeholder="Search designs…"
                className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
              />
              <span className="rounded bg-slate-100 px-1.5 font-mono text-[10px] text-slate-400 dark:bg-slate-800">
                ⌘K
              </span>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-control border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                  {SORT_LABELS[sort]}
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <DropdownMenuItem
                    key={k}
                    onSelect={() => setSort(k)}
                    className={cn(
                      sort === k && "text-violet-600 dark:text-violet-300",
                    )}
                  >
                    {SORT_LABELS[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="inline-flex rounded-control border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
              {(["grid", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-label={`${v} view`}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "flex items-center rounded-md px-2 py-1",
                    view === v
                      ? "bg-accent-soft text-accent-text"
                      : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300",
                  )}
                >
                  {v === "grid" ? (
                    <LayoutGrid className="h-3.5 w-3.5" />
                  ) : (
                    <List className="h-3.5 w-3.5" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Body */}
          {loading ? (
            <div className="mt-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : visible.length === 0 ? (
            <div className="mt-12 flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-16 dark:border-slate-700 dark:bg-slate-900">
              <PenTool className="h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-4 text-sm font-medium text-slate-900 dark:text-slate-100">
                {designs.length === 0
                  ? "No designs yet"
                  : "No matching designs"}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {designs.length === 0
                  ? "Create your first design to get started"
                  : "Try a different filter or search term"}
              </p>
              {designs.length === 0 && (
                <Button
                  variant="primary"
                  className="mt-4"
                  onClick={handleCreateDesign}
                  disabled={creating || !designerAvailable}
                  icon={<FilePlus className="h-4 w-4" />}
                >
                  New design
                </Button>
              )}
            </div>
          ) : view === "grid" ? (
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {visible.map((design) => (
                <DesignCard
                  key={design.id}
                  design={design}
                  view="grid"
                  starred={userState.isStarred(design.id)}
                  archived={userState.isArchived(design.id)}
                  onOpen={() => navigateToModule("designer", design.id)}
                  onToggleStar={() => userState.toggleStar(design.id)}
                  onToggleArchive={() => userState.toggleArchive(design.id)}
                  onDelete={() => setDeletingDesign(design)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-6 flex flex-col gap-2">
              {visible.map((design) => (
                <DesignCard
                  key={design.id}
                  design={design}
                  view="list"
                  starred={userState.isStarred(design.id)}
                  archived={userState.isArchived(design.id)}
                  onOpen={() => navigateToModule("designer", design.id)}
                  onToggleStar={() => userState.toggleStar(design.id)}
                  onToggleArchive={() => userState.toggleArchive(design.id)}
                  onDelete={() => setDeletingDesign(design)}
                />
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
    </TooltipProvider>
  );
}
