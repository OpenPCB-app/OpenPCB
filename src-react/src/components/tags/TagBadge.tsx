import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TagRecord } from "@shared/types/tag.types";

interface TagBadgeProps {
  tag: TagRecord;
  onDelete?: (tagId: string) => void;
  className?: string;
  size?: "sm" | "md";
}

function getContrastColor(hexColor: string): string {
  if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(hexColor))
    return "var(--color-foreground)";

  const hex = hexColor.replace("#", "");
  const r = parseInt(
    hex.length === 3 ? hex.charAt(0) + hex.charAt(0) : hex.substring(0, 2),
    16,
  );
  const g = parseInt(
    hex.length === 3 ? hex.charAt(1) + hex.charAt(1) : hex.substring(2, 4),
    16,
  );
  const b = parseInt(
    hex.length === 3 ? hex.charAt(2) + hex.charAt(2) : hex.substring(4, 6),
    16,
  );

  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "black" : "white";
}

export function TagBadge({
  tag,
  onDelete,
  className,
  size = "md",
}: TagBadgeProps) {
  const style = tag.color
    ? {
        backgroundColor: tag.color,
        color: getContrastColor(tag.color),
        borderColor: "transparent",
      }
    : undefined;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 transition-all hover:opacity-90",
        size === "sm" && "text-[10px] px-1.5 py-0",
        className,
      )}
      style={style}
    >
      {tag.name}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(tag.id);
          }}
          className={cn(
            "ml-0.5 rounded-full outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 hover:bg-black/20",
            tag.color &&
              getContrastColor(tag.color) === "black" &&
              "hover:bg-black/10",
          )}
        >
          <X className="h-3 w-3" />
          <span className="sr-only">Remove {tag.name} tag</span>
        </button>
      )}
    </Badge>
  );
}
