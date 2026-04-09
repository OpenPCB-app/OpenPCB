import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DesignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialName?: string;
  initialDescription?: string | null;
  confirmLabel: string;
  onConfirm: (input: { name: string; description: string }) => Promise<void>;
}

export function DesignDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName,
  initialDescription,
  confirmLabel,
  onConfirm,
}: DesignDialogProps) {
  const [name, setName] = useState(initialName ?? "");
  const [detail, setDetail] = useState(initialDescription ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName ?? "");
    setDetail(initialDescription ?? "");
    setError(null);
  }, [initialDescription, initialName, open]);

  const handleConfirm = async () => {
    if (!name.trim()) {
      setError("Design name is required");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onConfirm({ name: name.trim(), description: detail.trim() });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="design-name">Name</Label>
            <Input
              id="design-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Main board"
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="design-description">Description</Label>
            <Textarea
              id="design-description"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Optional design notes"
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isSaving}>
            {isSaving ? "Saving..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
