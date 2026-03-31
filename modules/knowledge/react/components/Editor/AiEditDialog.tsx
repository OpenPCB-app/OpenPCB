import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AiEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isEditing: boolean;
  statusLabel?: string;
  streamedText?: string;
  error?: string | null;
  selectionPreview?: string;
  providerLabel?: string;
}

export function AiEditDialog({
  open,
  onOpenChange,
  instruction,
  onInstructionChange,
  onSubmit,
  onCancel,
  isEditing,
  statusLabel,
  streamedText,
  error,
  selectionPreview,
  providerLabel,
}: AiEditDialogProps) {
  const preview = useMemo(() => {
    if (!selectionPreview) return null;
    if (selectionPreview.length <= 240) return selectionPreview;
    return `${selectionPreview.slice(0, 240)}…`;
  }, [selectionPreview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Edit selection with AI</DialogTitle>
          <DialogDescription>
            Provide a short instruction for the selected text.
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            {preview}
          </div>
        )}

        <div className="space-y-2">
          <Textarea
            placeholder="E.g. Make this more concise, keep the tone professional."
            value={instruction}
            onChange={(event) => onInstructionChange(event.target.value)}
            disabled={isEditing}
          />
          {providerLabel && (
            <div className="text-xs text-muted-foreground">
              Using {providerLabel}
            </div>
          )}
        </div>

        {(statusLabel || streamedText || error) && (
          <div className="rounded-md border border-border bg-background/60 p-3 text-xs">
            {statusLabel && (
              <div className="text-muted-foreground">{statusLabel}</div>
            )}
            {streamedText && (
              <div className="mt-2 whitespace-pre-wrap text-foreground">
                {streamedText}
              </div>
            )}
            {error && (
              <div className="mt-2 text-destructive">{error}</div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {isEditing ? "Stop" : "Cancel"}
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isEditing || instruction.trim().length === 0}
          >
            Run edit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
