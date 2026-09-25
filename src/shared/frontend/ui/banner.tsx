import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "./icon-button";

export type BannerTone = "info" | "warning" | "danger" | "success" | "neutral";

const TONES: Record<BannerTone, { box: string; accent: string }> = {
  info: { box: "bg-status-info-soft border-status-info-border", accent: "text-status-info" },
  warning: {
    box: "bg-status-warning-soft border-status-warning-border",
    accent: "text-status-warning",
  },
  danger: {
    box: "bg-status-danger-soft border-status-danger-border",
    accent: "text-status-danger",
  },
  success: {
    box: "bg-status-success-soft border-status-success-border",
    accent: "text-status-success",
  },
  neutral: {
    box: "bg-status-neutral-soft border-status-neutral-border",
    accent: "text-text-secondary",
  },
};

const ICONS: Record<BannerTone, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  info: Info,
  warning: AlertTriangle,
  danger: OctagonAlert,
  success: CheckCircle2,
  neutral: Info,
};

export interface BannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone: BannerTone;
  title?: React.ReactNode;
  /** Replaces the tone icon; `null` hides it. */
  icon?: React.ReactNode;
  /** Right-aligned buttons (kit `Button size="sm"`), e.g. Retry. */
  actions?: React.ReactNode;
  /** Adds a dismiss button. */
  onDismiss?: () => void;
  /** One-line strip (no title row), for toolbars and panel headers. */
  compact?: boolean;
  /**
   * Floating over a canvas or other content: puts an opaque panel under the
   * translucent tint (so contrast never depends on what is behind it) and
   * adds the float shadow.
   */
  floating?: boolean;
}

/**
 * Inline status message on status tokens. Body text stays `text-text` (AA on
 * every soft fill); the tone colours the icon + title. Danger is
 * `role="alert"`.
 */
export const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  (
    {
      tone,
      title,
      icon,
      actions,
      onDismiss,
      compact = false,
      floating = false,
      className,
      children,
      role,
      ...props
    },
    ref,
  ) => {
    const Icon = ICONS[tone];
    const glyph =
      icon === undefined ? (
        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
      ) : (
        icon
      );
    const banner = (
      <div
        ref={floating ? undefined : ref}
        role={role ?? (tone === "danger" ? "alert" : undefined)}
        className={cn(
          "flex gap-2 rounded-control border text-xs text-text",
          compact ? "min-h-[24px] items-center px-2 py-0.5" : "items-start px-2.5 py-2",
          TONES[tone].box,
          !floating && className,
        )}
        {...(floating ? {} : props)}
      >
        {glyph !== null ? (
          <span
            aria-hidden="true"
            className={cn(
              "flex shrink-0 items-center [&_svg]:h-3.5 [&_svg]:w-3.5",
              compact ? "" : "mt-px",
              TONES[tone].accent,
            )}
          >
            {glyph}
          </span>
        ) : null}
        <div className={cn("min-w-0 flex-1", compact && "truncate")}>
          {title !== undefined && title !== null ? (
            <div className={cn("font-medium", TONES[tone].accent, compact ? "inline" : "mb-0.5")}>
              {title}
              {compact && children ? " " : null}
            </div>
          ) : null}
          {compact ? <span>{children}</span> : children}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        {onDismiss ? (
          <IconButton
            label="Dismiss"
            variant="ghost"
            size="sm"
            tooltip={false}
            onClick={onDismiss}
            className="-mr-1 shrink-0"
          >
            <X strokeWidth={1.5} />
          </IconButton>
        ) : null}
      </div>
    );
    if (!floating) return banner;
    return (
      <div
        ref={ref}
        className={cn("rounded-control bg-surface-panel shadow-float", className)}
        {...props}
      >
        {banner}
      </div>
    );
  },
);
Banner.displayName = "Banner";
