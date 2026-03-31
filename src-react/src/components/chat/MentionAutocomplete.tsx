import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { cn } from "@/lib/utils";
import type { MentionEntity } from "@shared/types";

interface MentionAutocompleteProps {
  suggestions: MentionEntity[];
  isLoading: boolean;
  isOpen: boolean;
  selectedIndex: number;
  onSelect: (entity: MentionEntity) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export function MentionAutocomplete({
  suggestions,
  isLoading,
  isOpen,
  selectedIndex,
  onSelect,
  onClose,
  anchorRef,
}: MentionAutocompleteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [position, setPosition] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    flipUp: boolean;
  }>({ left: 0, flipUp: false });

  // Calculate position based on anchor element and viewport
  useLayoutEffect(() => {
    if (!isOpen || !listRef.current) return;

    const anchor = anchorRef?.current;
    if (!anchor) {
      // Fallback: position above cursor area
      setPosition({ bottom: 8, left: 0, flipUp: true });
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const listHeight = listRef.current.offsetHeight || 200; // Estimate if not rendered
    const viewportHeight = window.innerHeight;
    const padding = 8;

    // Space available above and below the anchor
    const spaceBelow = viewportHeight - anchorRect.bottom - padding;
    const spaceAbove = anchorRect.top - padding;

    // Prefer showing above (flipUp) since input is usually at bottom
    const flipUp = spaceBelow < listHeight && spaceAbove > spaceBelow;

    if (flipUp) {
      setPosition({
        bottom: anchor.offsetHeight + padding,
        left: 0,
        flipUp: true,
      });
    } else {
      setPosition({
        top: -listHeight - padding,
        left: 0,
        flipUp: false,
      });
    }
  }, [isOpen, anchorRef, suggestions.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const items = listRef.current.querySelectorAll("[data-mention-item]");
      items[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  if (!isOpen) return null;

  const showEmptyState = !isLoading && suggestions.length === 0;

  return (
    <div
      ref={listRef}
      className={cn(
        "absolute z-50 w-72 max-h-52 overflow-y-auto",
        "rounded-lg border border-border bg-popover/95 backdrop-blur-sm shadow-xl",
        "animate-in fade-in-0 duration-150",
        position.flipUp ? "slide-in-from-top-2" : "slide-in-from-bottom-2",
      )}
      style={{
        ...(position.top !== undefined && { top: position.top }),
        ...(position.bottom !== undefined && { bottom: position.bottom }),
        left: position.left,
      }}
    >
      {isLoading && (
        <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Searching...
        </div>
      )}
      {showEmptyState && (
        <div className="px-3 py-3 text-sm text-muted-foreground text-center">
          No pages found
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="py-1">
          {suggestions.map((entity, index) => (
            <button
              key={`${entity.entityType}:${entity.id}`}
              data-mention-item
              type="button"
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left text-sm",
                "transition-colors duration-75",
                "hover:bg-accent/80",
                "focus:bg-accent focus:outline-none",
                index === selectedIndex && "bg-accent",
              )}
              onClick={() => onSelect(entity)}
            >
              {entity.icon && (
                <span className="flex-shrink-0 text-base w-5 text-center">
                  {entity.icon}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{entity.displayText}</div>
                {entity.description && (
                  <div className="truncate text-xs text-muted-foreground mt-0.5">
                    {entity.description}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
