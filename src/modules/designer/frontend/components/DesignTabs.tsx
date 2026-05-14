import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@shared/frontend/ui/context-menu";
import { Plus, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { DesignerDesignSummary } from "../../../../sdks/designer";

interface DesignTabsProps {
  designs: DesignerDesignSummary[];
  openDesignIds: string[];
  activeDesignId: string | null;
  creatingDesign: boolean;
  onActivate(id: string): void;
  onClose(id: string): void;
  onCloseOthers(id: string): void;
  onCloseAll(): void;
  onRename(id: string, name: string): Promise<void> | void;
  onReorder(fromIndex: number, toIndex: number): void;
  onCreate(): void;
}

type DropSide = "before" | "after" | null;

const PLACEHOLDER = "Untitled Design";

function tabLabel(
  designs: DesignerDesignSummary[],
  designId: string,
): { name: string; revision: number | null } {
  const found = designs.find((d) => d.id === designId);
  if (!found) return { name: "Loading…", revision: null };
  return { name: found.name || PLACEHOLDER, revision: found.revision };
}

export function DesignTabs({
  designs,
  openDesignIds,
  activeDesignId,
  creatingDesign,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseAll,
  onRename,
  onReorder,
  onCreate,
}: DesignTabsProps): ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    side: DropSide;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startRename = useCallback(
    (designId: string) => {
      const current = designs.find((d) => d.id === designId);
      setDraftName(current?.name ?? "");
      setEditingId(designId);
    },
    [designs],
  );

  const commitRename = useCallback(async () => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    const previous = designs.find((d) => d.id === editingId)?.name ?? "";
    setEditingId(null);
    if (!trimmed || trimmed === previous) {
      return;
    }
    try {
      await onRename(editingId, trimmed);
    } catch {
      /* parent surfaces toast; nothing else to do here */
    }
  }, [draftName, designs, editingId, onRename]);

  const cancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void commitRename();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    },
    [cancelRename, commitRename],
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>, designId: string) => {
      // Middle click closes the tab.
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
        onClose(designId);
      }
    },
    [onClose],
  );

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, index: number) => {
      setDragIndex(index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, index: number) => {
      if (dragIndex === null || dragIndex === index) {
        setDropTarget(null);
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const side: DropSide =
        event.clientX < rect.left + rect.width / 2 ? "before" : "after";
      setDropTarget({ index, side });
    },
    [dragIndex],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, index: number) => {
      event.preventDefault();
      if (dragIndex === null) return;
      let to = index;
      if (dropTarget?.side === "after") to = index + 1;
      if (to > dragIndex) to -= 1;
      if (to !== dragIndex) onReorder(dragIndex, to);
      setDragIndex(null);
      setDropTarget(null);
    },
    [dragIndex, dropTarget, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropTarget(null);
  }, []);

  const indicatorFor = useCallback(
    (index: number): DropSide => {
      if (!dropTarget || dropTarget.index !== index) return null;
      return dropTarget.side;
    },
    [dropTarget],
  );

  const onlyOneOpen = openDesignIds.length <= 1;

  const items = useMemo(
    () =>
      openDesignIds.map((designId, index) => {
        const { name, revision } = tabLabel(designs, designId);
        const isActive = designId === activeDesignId;
        const isEditing = editingId === designId;
        const indicator = indicatorFor(index);
        return (
          <ContextMenu key={designId}>
            <ContextMenuTrigger asChild>
              <div
                role="tab"
                aria-selected={isActive}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                onMouseDown={(e) => handleMouseDown(e, designId)}
                onClick={() => {
                  if (!isEditing && !isActive) onActivate(designId);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startRename(designId);
                }}
                className={`group relative flex h-7 min-w-[120px] max-w-[200px] cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
                  isActive
                    ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800/60 dark:bg-violet-950/40 dark:text-violet-200"
                    : "border-transparent text-slate-600 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800"
                } ${dragIndex === index ? "opacity-50" : ""}`}
                data-testid={`design-tab-${designId}`}
              >
                {indicator === "before" && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-1 -left-0.5 w-0.5 rounded bg-violet-500"
                  />
                )}
                {indicator === "after" && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-1 -right-0.5 w-0.5 rounded bg-violet-500"
                  />
                )}
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => {
                      void commitRename();
                    }}
                    onKeyDown={handleInputKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    maxLength={120}
                    className="h-5 min-w-0 flex-1 rounded-sm border border-violet-300 bg-white px-1 text-xs text-slate-900 outline-none dark:border-violet-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                ) : (
                  <>
                    <span className="flex-1 truncate font-medium" title={name}>
                      {name}
                    </span>
                    {isActive && revision !== null && (
                      <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                        r{revision}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose(designId);
                      }}
                      aria-label={`Close ${name}`}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-opacity hover:bg-slate-300/80 dark:hover:bg-slate-700 ${
                        isActive
                          ? "opacity-80"
                          : "opacity-0 group-hover:opacity-80"
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  if (!isActive) onActivate(designId);
                  startRename(designId);
                }}
              >
                Rename
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onClose(designId)}>
                Close
              </ContextMenuItem>
              <ContextMenuItem
                disabled={onlyOneOpen}
                onSelect={() => onCloseOthers(designId)}
              >
                Close others
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onCloseAll()}>
                Close all
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      }),
    [
      activeDesignId,
      commitRename,
      designs,
      dragIndex,
      draftName,
      editingId,
      handleDragEnd,
      handleDragOver,
      handleDragStart,
      handleDrop,
      handleInputKeyDown,
      handleMouseDown,
      indicatorFor,
      onActivate,
      onClose,
      onCloseAll,
      onCloseOthers,
      onlyOneOpen,
      openDesignIds,
      startRename,
    ],
  );

  return (
    <div
      role="tablist"
      aria-label="Open designs"
      className="flex min-w-0 items-center gap-1 overflow-x-auto"
      style={{ scrollbarWidth: "none" }}
    >
      {items}
      <button
        type="button"
        onClick={onCreate}
        disabled={creatingDesign}
        aria-label="New design"
        title={creatingDesign ? "Creating…" : "New design"}
        className="ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-200/80 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
