import { GitBranchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BranchIndicatorProps {
  currentBranchIndex: number;
  totalBranches: number;
  onOpenSelector: () => void;
  className?: string;
}

export function BranchIndicator({
  currentBranchIndex,
  totalBranches,
  onOpenSelector,
  className,
}: BranchIndicatorProps) {
  if (totalBranches <= 1) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 gap-1.5 rounded-full px-2 text-xs text-muted-foreground font-medium hover:text-foreground",
              className,
            )}
            onClick={onOpenSelector}
          >
            <GitBranchIcon className="size-3.5" />
            <span>
              {currentBranchIndex + 1}/{totalBranches}
            </span>
            <span className="sr-only">Switch branch</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>View alternate branches</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
