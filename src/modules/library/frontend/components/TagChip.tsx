import type { ReactElement } from "react";
import { X } from "lucide-react";

export type TagChipSize = "sm" | "md";

interface TagChipProps {
  label: string;
  count?: number;
  active?: boolean;
  removable?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  size?: TagChipSize;
  title?: string;
}

export function TagChip({
  label,
  count,
  active = false,
  removable = false,
  disabled = false,
  onClick,
  onRemove,
  size = "sm",
  title,
}: TagChipProps): ReactElement {
  const dimensions =
    size === "md" ? "h-7 px-3 text-xs" : "h-6 px-2.5 text-[11px]";

  const tone = active
    ? "border-violet-600 bg-violet-600 text-white hover:bg-violet-700"
    : "border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700";

  const disabledTone = disabled
    ? "cursor-not-allowed opacity-50 hover:bg-slate-100 dark:hover:bg-slate-800"
    : "";

  const Tag: "button" | "span" = onClick ? "button" : "span";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={onClick ? disabled : undefined}
      title={title ?? label}
      className={`inline-flex items-center gap-1 rounded-full border font-medium transition-colors ${dimensions} ${tone} ${disabledTone}`}
    >
      <span className="max-w-[12rem] truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className={
            active
              ? "text-[10px] font-semibold text-white/80"
              : "text-[10px] font-semibold text-slate-400 dark:text-slate-500"
          }
        >
          {count}
        </span>
      )}
      {removable && onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove tag ${label}`}
          className="-mr-1 ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Tag>
  );
}
