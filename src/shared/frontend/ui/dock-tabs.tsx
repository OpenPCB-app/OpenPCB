import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";
import { nextRovingIndex } from "./roving";

export interface DockTabItem<T> {
  id: T;
  label: React.ReactNode;
  badge?: number | string;
  /** Class for the badge (e.g. a status colour). */
  badgeClassName?: string;
  disabled?: boolean;
}

export interface DockTabsProps<T> {
  tabs: ReadonlyArray<DockTabItem<T>>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
  tabClassName?: string;
  /** Rendered after the tabs (right-aligned controls such as a close button). */
  trailing?: React.ReactNode;
  "aria-label"?: string;
  /**
   * When set, each tab gets `id` + `aria-controls` from `dockTabIds(prefix, id)`;
   * render the panel with `dockTabPanelProps(prefix, id)` so they pair up.
   */
  idPrefix?: string;
}

/** Element ids pairing a dock tab with its panel. */
export function dockTabIds(prefix: string, id: string | number) {
  return { tabId: `${prefix}-tab-${id}`, panelId: `${prefix}-panel-${id}` };
}

/** Spread onto the element that shows the active tab's content. */
export function dockTabPanelProps(prefix: string, id: string | number) {
  const { tabId, panelId } = dockTabIds(prefix, id);
  return { id: panelId, role: "tabpanel" as const, "aria-labelledby": tabId };
}

/**
 * 24px tab strip on top of a docked panel (design D2 §7). WAI-ARIA tabs with
 * automatic activation: one Tab stop (the active tab), Arrow Left/Right +
 * Home/End move and select (T-018).
 */
export function DockTabs<T extends string | number>({
  tabs,
  active,
  onChange,
  className,
  tabClassName,
  trailing,
  "aria-label": ariaLabel,
  idPrefix,
}: DockTabsProps<T>) {
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = tabs.findIndex((tab) => tab.id === active);
  // Keep exactly one tab stop even if `active` matches no (enabled) tab.
  const tabStop =
    activeIndex >= 0 && !tabs[activeIndex]?.disabled
      ? activeIndex
      : tabs.findIndex((tab) => !tab.disabled);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex({
      key: event.key,
      current: index,
      count: tabs.length,
      isDisabled: (i) => Boolean(tabs[i]?.disabled),
    });
    if (next === null) return;
    event.preventDefault();
    tabRefs.current[next]?.focus();
    const tab = tabs[next];
    if (tab && tab.id !== active) onChange(tab.id);
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      className={cn(
        "flex h-[24px] shrink-0 items-stretch border-b border-border bg-surface-rail",
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        const ids = idPrefix ? dockTabIds(idPrefix, tab.id) : null;
        return (
          <button
            key={String(tab.id)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={ids?.tabId}
            aria-controls={ids?.panelId}
            aria-selected={selected}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex items-center gap-1.5 border-r border-border px-3 text-xs whitespace-nowrap transition-colors",
              FOCUS_RING,
              "disabled:cursor-not-allowed disabled:opacity-50",
              selected
                ? "bg-surface-panel font-medium text-text-strong"
                : "text-text-tertiary hover:text-text",
              tabClassName,
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null ? (
              <span
                className={cn(
                  "font-mono text-2xs tabular-nums text-text-tertiary",
                  tab.badgeClassName,
                )}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
      {trailing ? (
        <div className="ml-auto flex items-center gap-1 px-2">{trailing}</div>
      ) : null}
    </div>
  );
}
