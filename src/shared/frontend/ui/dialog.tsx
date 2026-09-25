import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";

/*
 * The one modal recipe (T-014): scrim, --surface-panel, 3px float radius,
 * dialog shadow, 34px header with a 12px/500 sentence-case title. Radix
 * gives the focus trap and returns focus to the opener on close.
 */

export function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

export function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export const DialogClose = DialogPrimitive.Close;

export type DialogSize = "sm" | "md" | "lg" | "xl" | "full";

const SIZES: Record<DialogSize, string> = {
  sm: "w-[min(92vw,24rem)] max-h-[85vh]",
  md: "w-[min(92vw,32rem)] max-h-[85vh]",
  lg: "w-[min(92vw,44rem)] max-h-[88vh]",
  xl: "w-[min(94vw,64rem)] max-h-[90vh]",
  full: "w-[96vw] h-[92vh]",
};

const DialogChromeContext = React.createContext({ showCloseButton: true });

export interface DialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Width preset; default `md` (32rem). */
  size?: DialogSize;
  /** Top-right close (×) button. Default true. */
  showCloseButton?: boolean;
}

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size = "md", showCloseButton = true, onEscapeKeyDown, ...props }, ref) => (
  <DialogPrimitive.Portal data-slot="dialog-portal">
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className="fixed inset-0 z-50 bg-scrim"
    />
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-content"
      aria-modal="true"
      className={cn(
        "fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden",
        "rounded-float border border-border bg-surface-panel text-xs text-text shadow-dialog outline-none",
        SIZES[size],
        className,
      )}
      {...props}
      onEscapeKeyDown={(event) => {
        onEscapeKeyDown?.(event);
        // Radix listens for Escape in the capture phase, before the focused
        // field's own handler; a field with an open edit keeps its Escape.
        if (!event.defaultPrevented && isEscapeOwnedByField(event.target)) {
          event.preventDefault();
        }
      }}
    >
      <DialogChromeContext.Provider value={{ showCloseButton }}>
        {children}
      </DialogChromeContext.Provider>
      {showCloseButton ? (
        <DialogPrimitive.Close
          aria-label="Close"
          className={cn(
            "absolute right-1.5 top-1.5 inline-flex h-[22px] w-[22px] items-center justify-center rounded-control",
            "text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-strong",
            FOCUS_RING,
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

/** True when Escape targets an element that consumes it (e.g. a dirty NumberInput). */
export function isEscapeOwnedByField(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-escape-owner="true"]') !== null;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>((props, ref) => <DialogPrimitive.Title ref={ref} data-slot="dialog-title" {...props} />);
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("text-xs text-text-secondary", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

export interface DialogHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  /** Rendered under the header bar (and wired as the accessible description). */
  description?: React.ReactNode;
  /** Controls right of the title (left of the close button). */
  trailing?: React.ReactNode;
}

/** 34px title bar; title is the dialog's accessible name. */
export function DialogHeader({ title, description, trailing, className, ...props }: DialogHeaderProps) {
  const { showCloseButton } = React.useContext(DialogChromeContext);
  return (
    <div className={cn("shrink-0", className)} {...props}>
      <div
        className={cn(
          "flex h-[34px] items-center gap-2 border-b border-border pl-3",
          showCloseButton ? "pr-9" : "pr-3",
        )}
      >
        <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong">
          {title}
        </DialogTitle>
        {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
      </div>
      {description ? (
        <DialogDescription className="px-3 pt-2">{description}</DialogDescription>
      ) : null}
    </div>
  );
}

export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-3 py-3 text-xs text-text", className)}
      {...props}
    />
  );
}

/** Right-aligned action row; put the primary action last. */
export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}
