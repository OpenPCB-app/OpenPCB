import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";

export interface OutlineRowAction {
  label: string;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  onSelect(): void;
}

interface OutlineRowProps {
  icon?: ReactNode;
  primary: string;
  secondary?: string | null;
  tertiary?: string | null;
  selected: boolean;
  onSelect(): void;
  onActivate?(): void;
  actions?: OutlineRowAction[];
  renaming?: boolean;
  onRenameCommit?(value: string): void;
  onRenameCancel?(): void;
}

export function OutlineRow({
  icon,
  primary,
  secondary,
  tertiary,
  selected,
  onSelect,
  onActivate,
  actions,
  renaming,
  onRenameCommit,
  onRenameCancel,
}: OutlineRowProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (!(event.target instanceof Node)) return;
      if (!wrapperRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [menuOpen]);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (!actions || actions.length === 0) return;
    event.preventDefault();
    setMenuPos({ x: event.clientX, y: event.clientY });
    setMenuOpen(true);
    onSelect();
  };

  const handleKebabClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!actions || actions.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.right, y: rect.bottom });
    setMenuOpen((prev) => !prev);
  };

  const commitRename = () => {
    const value = inputRef.current?.value.trim() ?? "";
    if (value.length === 0) {
      onRenameCancel?.();
      return;
    }
    onRenameCommit?.(value);
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onRenameCancel?.();
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onDoubleClick={onActivate}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          } else if (event.key === "F2") {
            const renameAction = actions?.find((a) => a.label === "Rename");
            if (renameAction && !renameAction.disabled) {
              event.preventDefault();
              renameAction.onSelect();
            }
          } else if (event.key === "Delete" || event.key === "Backspace") {
            const deleteAction = actions?.find((a) => a.label === "Delete");
            if (deleteAction && !deleteAction.disabled) {
              event.preventDefault();
              deleteAction.onSelect();
            }
          }
        }}
        className={`group flex items-center gap-2 px-2 py-1 text-xs transition-colors cursor-pointer ${
          selected
            ? "bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-100"
            : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
        }`}
        data-selected={selected || undefined}
      >
        {icon && (
          <span
            className={`flex h-4 w-4 shrink-0 items-center justify-center ${
              selected
                ? "text-violet-500 dark:text-violet-300"
                : "text-slate-400 dark:text-slate-500"
            }`}
          >
            {icon}
          </span>
        )}
        {renaming ? (
          <input
            ref={inputRef}
            defaultValue={primary}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleInputKeyDown}
            onBlur={commitRename}
            className="min-w-0 flex-1 rounded border border-violet-400 bg-white px-1 py-0 text-xs text-slate-800 outline-none dark:border-violet-600 dark:bg-slate-800 dark:text-slate-100"
          />
        ) : (
          <>
            <span
              className="min-w-0 flex-1 truncate font-medium"
              title={primary}
            >
              {primary}
            </span>
            {secondary && (
              <span
                className={`min-w-0 max-w-[40%] truncate text-[11px] ${
                  selected
                    ? "text-violet-700/80 dark:text-violet-200/80"
                    : "text-slate-500 dark:text-slate-500"
                }`}
                title={secondary}
              >
                {secondary}
              </span>
            )}
            {tertiary && (
              <span
                className={`shrink-0 text-[10px] tabular-nums ${
                  selected
                    ? "text-violet-600/70 dark:text-violet-300/70"
                    : "text-slate-400 dark:text-slate-600"
                }`}
                title={tertiary}
              >
                {tertiary}
              </span>
            )}
            {actions && actions.length > 0 && (
              <button
                type="button"
                onClick={handleKebabClick}
                aria-label="Actions"
                className={`shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-slate-200 group-hover:opacity-100 dark:hover:bg-slate-800 ${
                  selected ? "opacity-100" : ""
                }`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>
      {menuOpen && menuPos && actions && (
        <div
          role="menu"
          style={{ position: "fixed", top: menuPos.y, left: menuPos.x }}
          className="z-50 min-w-[10rem] rounded-md border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={action.disabled}
              onClick={(event) => {
                event.stopPropagation();
                if (action.disabled) return;
                setMenuOpen(false);
                action.onSelect();
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-1 text-left text-xs transition-colors ${
                action.disabled
                  ? "cursor-not-allowed text-slate-400 dark:text-slate-600"
                  : action.destructive
                    ? "text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              <span>{action.label}</span>
              {action.shortcut && (
                <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0 text-[10px] font-mono text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {action.shortcut}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
