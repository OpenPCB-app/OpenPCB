import { useRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useContextMenuStore } from "@shared/frontend/context-menu";
import {
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_DESTRUCTIVE,
} from "@shared/frontend/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useMenuDismiss,
  useMenuFocus,
  useMenuPosition,
} from "../shell/use-menu-lifecycle";

function handleMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.defaultPrevented || event.isPropagationStopped()) return;
  const state = useContextMenuStore.getState();
  const actions: Record<string, () => void> = {
    ArrowDown: () => state.moveFocus(1),
    ArrowUp: () => state.moveFocus(-1),
    Home: state.focusFirst,
    End: state.focusLast,
    Enter: state.selectFocused,
    " ": state.selectFocused,
    Escape: state.closeMenu,
    Tab: state.closeMenu,
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  action();
}

export function AppContextMenu() {
  const {
    open,
    scope,
    ownerId,
    position,
    groups,
    title,
    focusedIndex,
    closeMenu,
  } = useContextMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const clamped = useMenuPosition(menuRef, open, position, groups);
  useMenuFocus(menuRef, open, focusedIndex);
  useMenuDismiss(menuRef, open, closeMenu);
  if (!open) return null;
  let actionIndex = 0;
  return createPortal(
    <div
      ref={menuRef}
      data-testid="app-context-menu"
      data-scope={scope ?? ""}
      data-shortcut-owner={ownerId ?? undefined}
      tabIndex={-1}
      role="menu"
      aria-label={title ?? "Actions"}
      onKeyDown={handleMenuKey}
      onContextMenu={(event) => event.preventDefault()}
      className={cn(MENU_CONTENT, "fixed overflow-y-auto outline-none")}
      style={{
        left: clamped.x,
        top: clamped.y,
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
      }}
    >
      {title && <MenuLabel>{title}</MenuLabel>}
      {groups.map((group, gi) => (
        <div key={group.id} role="group" aria-label={group.label}>
          {group.label && <MenuLabel>{group.label}</MenuLabel>}
          {group.items.map((item, ii) => {
            if (item.kind === "separator")
              return (
                <div
                  key={`${gi}-${ii}`}
                  role="separator"
                  className="-mx-1 my-1 h-px bg-divider"
                />
              );
            const index = item.disabled ? -1 : actionIndex++;
            return (
              <button
                key={item.id}
                data-menu-item-id={item.id}
                role="menuitem"
                disabled={item.disabled}
                data-disabled={item.disabled ? "" : undefined}
                data-highlighted={index === focusedIndex ? "" : undefined}
                tabIndex={-1}
                onFocus={() => {
                  if (index >= 0)
                    useContextMenuStore.setState({ focusedIndex: index });
                }}
                onPointerMove={() => {
                  if (index >= 0)
                    useContextMenuStore.setState({ focusedIndex: index });
                }}
                onClick={() => {
                  closeMenu();
                  item.onSelect();
                }}
                className={cn(
                  MENU_ITEM,
                  "w-full justify-between",
                  item.destructive && MENU_ITEM_DESTRUCTIVE,
                )}
              >
                <span className="min-w-0 break-words">{item.label}</span>
                {item.shortcut && (
                  <span className="ml-4 shrink-0 text-2xs text-text-tertiary">
                    {item.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}

function MenuLabel({ children }: { children: string }) {
  return (
    <div className="flex min-h-[22px] items-center px-2 text-2xs uppercase tracking-[.04em] text-text-caps">
      {children}
    </div>
  );
}
