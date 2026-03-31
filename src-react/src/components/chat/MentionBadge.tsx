import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseMentions } from "@/lib/mention-utils";
import type { MentionReference } from "@shared/types";

interface MentionBadgeProps {
  mention: MentionReference;
  isDeleted?: boolean;
  onClick?: () => void;
  className?: string;
}

export function MentionBadge({
  mention,
  isDeleted = false,
  onClick,
  className,
}: MentionBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={isDeleted}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded",
            "text-sm font-medium transition-colors",
            isDeleted
              ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
              : "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer",
            className,
          )}
        >
          <span>@</span>
          <span className="max-w-[150px] truncate">{mention.displayText}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {isDeleted ? (
          <span className="text-muted-foreground">
            This {mention.entityType} has been deleted
          </span>
        ) : (
          <span>Click to navigate to {mention.displayText}</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

interface RenderMentionsProps {
  text: string;
  onMentionClick?: (mention: MentionReference) => void;
  deletedEntityIds?: Set<string>;
}

export function renderTextWithMentions({
  text,
  onMentionClick,
  deletedEntityIds = new Set(),
}: RenderMentionsProps): ReactNode[] {
  const mentions = parseMentions(text);
  if (mentions.length === 0) {
    return [text];
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;

  mentions.forEach((mention, i) => {
    if (mention.position > lastIndex) {
      parts.push(text.slice(lastIndex, mention.position));
    }

    const isDeleted = deletedEntityIds.has(mention.entityId);
    parts.push(
      <MentionBadge
        key={`mention-${i}`}
        mention={mention}
        isDeleted={isDeleted}
        onClick={
          onMentionClick && !isDeleted
            ? () => onMentionClick(mention)
            : undefined
        }
      />,
    );

    lastIndex = mention.position + mention.raw.length;
  });

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
