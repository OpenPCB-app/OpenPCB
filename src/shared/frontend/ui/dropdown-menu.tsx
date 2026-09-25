import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatShortcut } from "./shortcut";

/*
 * The ONE menu look (T-025): --menu-* tokens, 3px float radius, float
 * shadow, 22px / 11px items. ContextMenu and the app context menu reuse
 * MENU_CONTENT / MENU_ITEM so the families never drift again.
 */
export const MENU_CONTENT =
  "z-60 min-w-[11rem] overflow-hidden rounded-float border border-menu-border bg-menu-bg p-1 text-xs text-text shadow-float";

export const MENU_ITEM =
  "relative flex h-[22px] cursor-pointer select-none items-center gap-2 rounded-control px-2 text-xs outline-none transition-colors [&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0 data-[highlighted]:bg-menu-highlight data-[highlighted]:text-text-strong data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export const MENU_ITEM_DESTRUCTIVE =
  "text-status-danger data-[highlighted]:bg-status-danger-soft data-[highlighted]:text-status-danger";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

export const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-divider", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "flex h-[22px] items-center px-2 text-2xs uppercase tracking-[.04em] text-text-caps",
      className,
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, align = "end", ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(MENU_CONTENT, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

export interface DropdownMenuItemProps extends React.ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Item
> {
  destructive?: boolean;
}

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(({ className, destructive = false, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(MENU_ITEM, destructive && MENU_ITEM_DESTRUCTIVE, className)}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

/** Toggle item: check glyph in a 16px leading gutter. */
export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(MENU_ITEM, "pl-6", className)}
    {...props}
  >
    <span className="absolute left-1.5 flex h-3 w-3 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check strokeWidth={1.5} />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

/** Single-choice item inside a DropdownMenuRadioGroup: dot in the gutter. */
export const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(MENU_ITEM, "pl-6", className)}
    {...props}
  >
    <span className="absolute left-1.5 flex h-3 w-3 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <span className="block h-1.5 w-1.5 rounded-full bg-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

export interface DropdownMenuShortcutProps
  extends React.HTMLAttributes<HTMLSpanElement> {
  /** Shortcut spec formatted per platform (`"Mod+Shift+S"` → ⌘⇧S / Ctrl+Shift+S). */
  keys?: string;
}

/** Right-aligned shortcut hint inside a menu item. */
export function DropdownMenuShortcut({
  keys,
  className,
  children,
  ...props
}: DropdownMenuShortcutProps) {
  return (
    <span
      className={cn(
        "ml-auto pl-4 font-mono text-2xs tracking-normal text-text-tertiary",
        className,
      )}
      {...props}
    >
      {keys ? formatShortcut(keys) : children}
    </span>
  );
}
