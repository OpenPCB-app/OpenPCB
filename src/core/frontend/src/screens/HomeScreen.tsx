import { useGlobalShortcut } from "@shared/frontend/keyboard/use-global-shortcut";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  ChevronDown,
  Download,
  FilePlus,
  LayoutGrid,
  List,
  Loader2,
  PenTool,
  Trash2,
  X,
} from "lucide-react";
import { useBootstrap } from "../providers/BootstrapProvider";
import { useNavigationStore } from "../stores/navigation-store";
import { Button } from "@shared/frontend/ui/button";
import { SearchField } from "@shared/frontend/ui/search-field";
import { SegmentedControl } from "@shared/frontend/ui/segmented-control";
import { StatusBar, StatusSegment } from "@shared/frontend/ui/status-bar";
import { TableHeaderRow } from "@shared/frontend/ui/data-table";
import { TooltipProvider } from "@shared/frontend/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DesignCard, type DesignSummary } from "./home/DesignCard";
import { DesignDetailPanel } from "./home/DesignDetailPanel";
import { DESIGN_LIST_COLS, DesignListRow } from "./home/DesignListRow";
import { HomeSidebar, type HomeFilterKey } from "./home/HomeSidebar";
import { useDesignUserState } from "./home/useDesignUserState";

type FilterKey = HomeFilterKey;
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
      <div className="w-full max-w-sm rounded-float border border-border bg-surface-raised p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-strong">
            Delete Design
          </h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            className="rounded-control p-1 text-text-tertiary outline-none hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-2 text-xs text-text-secondary">
          Are you sure you want to delete{" "}
          <span className="font-medium text-text-strong">{design.name}</span>?
          This action cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={deleting}
            icon={
              deleting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
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
  const [view, setView] = useState<"grid" | "list">("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
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

  // App version for the footer segment — Electron-only, absent in browser dev.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAppVersions) return;
    let cancelled = false;
    api
      .getAppVersions()
      .then((versions) => {
        if (!cancelled) setAppVersion(versions.app);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Keep a selection inside the current result set (defaults to the first row).
  useEffect(() => {
    setSelectedId((current) =>
      current && visible.some((d) => d.id === current)
        ? current
        : (visible[0]?.id ?? null),
    );
  }, [visible]);

  const selectedDesign =
    visible.find((d) => d.id === selectedId) ?? visible[0] ?? null;

  const openDesign = useCallback(
    (id: string) => navigateToModule("designer", id),
    [navigateToModule],
  );

  // Keyboard: ⌘K focus search, N new design, Enter opens the selected design
  // (when not typing into a field).
  useGlobalShortcut("Mod+K", () => searchRef.current?.focus(), {
    allowInEditable: true,
  });
  useGlobalShortcut("/", () => searchRef.current?.focus());
  useGlobalShortcut("Enter", () => {
    if (!selectedId) return false;
    openDesign(selectedId);
  });
  useGlobalShortcut("N", () => {
    if (!designerAvailable) return false;
    void handleCreateDesign();
  });

  const counts = useMemo(() => {
    const now = Date.now();
    const active = designs.filter((d) => !userState.isArchived(d.id));
    return {
      all: active.length,
      recent: active.filter(
        (d) => now - new Date(d.updatedAt).getTime() <= WEEK_MS,
      ).length,
      starred: userState.starredCount,
      archived: userState.archivedCount,
    } satisfies Record<FilterKey, number>;
  }, [designs, userState]);

  const emptyState = (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-6">
      <PenTool className="h-8 w-8 text-text-disabled" />
      <p className="mt-3 text-sm font-medium text-text-strong">
        {designs.length === 0 ? "No designs yet" : "No matching designs"}
      </p>
      <p className="mt-1 text-xs text-text-tertiary">
        {designs.length === 0
          ? "Create your first design to get started"
          : "Try a different filter or search term"}
      </p>
      {designs.length === 0 && (
        <Button
          variant="primary"
          className="mt-3"
          onClick={handleCreateDesign}
          disabled={creating || !designerAvailable}
          icon={<FilePlus className="h-3 w-3" />}
        >
          New design
        </Button>
      )}
    </div>
  );

  let body;
  if (loading) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    );
  } else if (visible.length === 0) {
    body = emptyState;
  } else if (view === "grid") {
    body = (
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.map((design) => (
            <DesignCard
              key={design.id}
              design={design}
              starred={userState.isStarred(design.id)}
              archived={userState.isArchived(design.id)}
              onOpen={() => openDesign(design.id)}
              onToggleStar={() => userState.toggleStar(design.id)}
              onToggleArchive={() => userState.toggleArchive(design.id)}
              onDelete={() => setDeletingDesign(design)}
            />
          ))}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <TableHeaderRow cols={DESIGN_LIST_COLS}>
          <span>Preview</span>
          <span>Name</span>
          <span>Rev</span>
          <span>DRC</span>
          <span>Modified ▾</span>
          <span />
        </TableHeaderRow>
        <div className="min-h-0 flex-1 overflow-auto">
          {visible.map((design) => (
            <DesignListRow
              key={design.id}
              design={design}
              starred={userState.isStarred(design.id)}
              selected={design.id === selectedDesign?.id}
              onSelect={() => setSelectedId(design.id)}
              onOpen={() => openDesign(design.id)}
              onToggleStar={() => userState.toggleStar(design.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full min-h-0 w-full flex-col bg-surface-app text-text">
        {/* Header */}
        <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-surface-rail px-3">
          <h1 className="text-base font-medium text-text-strong">Designs</h1>
          <span className="font-mono text-2xs text-text-tertiary">
            {designs.length} local
          </span>
          <SearchField
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            placeholder="Search designs…"
            aria-label="Search designs"
            shortcutHint="/"
            containerClassName="ml-2 w-[300px]"
          />
          <div className="flex-1" />
          <SegmentedControl
            aria-label="View"
            options={[
              {
                id: "list" as const,
                label: "List",
                icon: <List aria-hidden="true" />,
              },
              {
                id: "grid" as const,
                label: "Grid",
                icon: <LayoutGrid aria-hidden="true" />,
              },
            ]}
            value={view}
            onChange={setView}
          />
          <Button
            variant="outline"
            onClick={() =>
              navigateToModule("designer", undefined, {
                action: "import-kicad",
              })
            }
            disabled={!designerAvailable}
            icon={<Download className="h-3 w-3" />}
          >
            Import KiCad…
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                icon={<ArrowDownWideNarrow className="h-3 w-3" />}
              >
                {SORT_LABELS[sort]}
                <ChevronDown className="h-3 w-3 text-text-tertiary" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <DropdownMenuItem
                  key={k}
                  onSelect={() => setSort(k)}
                  className={cn(sort === k && "text-text-strong")}
                >
                  {SORT_LABELS[k]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="primary"
            onClick={handleCreateDesign}
            disabled={creating || !designerAvailable}
            icon={
              creating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <FilePlus className="h-3 w-3" />
              )
            }
          >
            {creating ? "Creating…" : "New design"}
            {!creating && (
              <span className="ml-1 font-mono text-2xs opacity-60">N</span>
            )}
          </Button>
        </header>

        {error && (
          <div className="shrink-0 border-b border-border bg-status-danger-soft px-3 py-1.5 text-xs text-status-danger">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          <HomeSidebar
            filter={filter}
            onFilterChange={setFilter}
            counts={counts}
          />
          <div className="flex min-w-0 flex-1 flex-col">{body}</div>
          <DesignDetailPanel
            design={selectedDesign}
            starred={
              selectedDesign ? userState.isStarred(selectedDesign.id) : false
            }
            archived={
              selectedDesign ? userState.isArchived(selectedDesign.id) : false
            }
            onOpen={() => selectedDesign && openDesign(selectedDesign.id)}
            onToggleArchive={() =>
              selectedDesign && userState.toggleArchive(selectedDesign.id)
            }
            onDelete={() => selectedDesign && setDeletingDesign(selectedDesign)}
          />
        </div>

        {/* Footer */}
        <StatusBar>
          <StatusSegment>designs {visible.length}</StatusSegment>
          <StatusSegment flex sans className="text-text-tertiary">
            Enter to open · N new · / search
          </StatusSegment>
          <StatusSegment>Local</StatusSegment>
          {appVersion && (
            <StatusSegment>
              v{appVersion.startsWith("v") ? appVersion.slice(1) : appVersion}
            </StatusSegment>
          )}
        </StatusBar>

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
