import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BackButtonProps {
  onBack: () => void;
  className?: string;
}

export function BackButton({ onBack, className }: BackButtonProps) {
  return (
    <div className={cn("absolute top-4 left-4 z-20", className)}>
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Back to project"
        className="h-9 w-9 rounded-full bg-surface-muted/50 backdrop-blur-sm border border-border/50 shadow-sm hover:bg-surface-muted"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
    </div>
  );
}
