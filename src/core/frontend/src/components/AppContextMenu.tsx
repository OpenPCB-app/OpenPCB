import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useContextMenuStore } from "@shared/frontend/context-menu";
import { cn } from "@/lib/utils";

const ITEM_HEIGHT = 32;
const PADDING_Y = 6;
const MIN_WIDTH = 160;

function useClampedPosition(
  position: { x: number; y: number },
  itemCount: number,
): { x: number; y: number } {
  const [clamped, setClamped] = useState(position);

  useEffect(() => {
    const menuHeight = itemCount * ITEM_HEIGHT + PADDING_Y * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const x = Math.min(position.x, vw - MIN_WIDTH - 8);
    const y = Math.min(position.y, vh - menuHeight - 8);
    setClamped({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [position, itemCount]);

  return clamped;
}

export function AppContextMenu() {
  const {
    open,
    scope,
    position,
    groups,
    title,
    focusedIndex,
    closeMenu,
    moveFocus,
    focusFirst,
    focusLast,
    selectFocused,
  } = useContextMenuStore();

  const menuRef = useRef<HTMLDivElement>(null);

  const enabledCount = groups.reduce((sum, g) => {
    return (
      sum + g.items.filter((i) => i.kind === "action" && !i.disabled).length
    );
  }, 0);

  const clamped = useClampedPosition(position, enabledCount);

  // Close on outside click / scroll / resize / blur
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const handleScroll = () => closeMenu();
    const handleResize = () => closeMenu();
    const handleBlur = () => closeMenu();

    document.addEventListener("click", handleClick);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", handleBlur);

    return () => {
      document.removeEventListener("click", handleClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("blur", handleBlur);
    };
  }, [open, closeMenu]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1);
          break;
        case "Home":
          e.preventDefault();
          focusFirst();
          break;
        case "End":
          e.preventDefault();
          focusLast();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          selectFocused();
          break;
        case "Escape":
          e.preventDefault();
          closeMenu();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, moveFocus, focusFirst, focusLast, selectFocused, closeMenu]);

  // Auto-focus menu when opened
  useEffect(() => {
    if (open && menuRef.current) {
      menuRef.current.focus();
    }
  }, [open]);

  const handleItemClick = useCallback(
    (actionIndex: number) => {
      let currentIdx = 0;
      for (const group of groups) {
        for (const item of group.items) {
          if (item.kind === "action" && !item.disabled) {
            if (currentIdx === actionIndex) {
              item.onSelect();
              closeMenu();
              return;
            }
            currentIdx++;
          }
        }
      }
    },
    [groups, closeMenu],
  );

  if (!open) return null;

  let actionIndex = 0;

  return createPortal(
    <div
      ref={menuRef}
      data-testid="app-context-menu"
      data-scope={scope ?? ""}
      tabIndex={-1}
      role="menu"
      className={cn(
        "fixed z-[60] min-w-[10rem] rounded-md border border-slate-200 bg-white py-1.5 shadow-lg outline-none",
        "dark:border-slate-700 dark:bg-slate-900",
      )}
      style={{
        left: clamped.x,
        top: clamped.y,
        minWidth: MIN_WIDTH,
      }}
    >
      {title && (
        <div className="px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          {title}
        </div>
      )}

      {groups.map((group, gi) => {
        const groupItems = group.items.map((item, ii) => {
          if (item.kind === "separator") {
            return (
              <div
                key={`${gi}-${ii}-sep`}
                role="separator"
                className="my-1 border-t border-slate-200 dark:border-slate-700"
              />
            );
          }

          const isFocused = actionIndex === focusedIndex;
          const idx = item.disabled ? -1 : actionIndex++;

          return (
            <button
              key={`${gi}-${ii}-${item.id}`}
              data-menu-item-id={item.id}
              role="menuitem"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={item.disabled ? undefined : () => handleItemClick(idx)}
              className={cn(
                "flex w-full items-center justify-between px-3 py-1.5 text-sm outline-none",
                "text-slate-700 dark:text-slate-200",
                item.disabled && "cursor-not-allowed opacity-50",
                !item.disabled && "hover:bg-slate-100 dark:hover:bg-slate-800",
                isFocused && !item.disabled && "bg-slate-100 dark:bg-slate-800",
                item.destructive && "text-red-600 dark:text-red-400",
              )}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <span className="ml-4 text-xs text-slate-400 dark:text-slate-500">
                  {item.shortcut}
                </span>
              )}
            </button>
          );
        });

        return (
          <div key={`group-${gi}-${group.id}`} role="group">
            {group.label && (
              <div className="px-3 py-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                {group.label}
              </div>
            )}
            {groupItems}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
