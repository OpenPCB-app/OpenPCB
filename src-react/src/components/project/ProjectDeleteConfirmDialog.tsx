import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useProjects } from "@/hooks/useProjects";
import type { ProjectRecord } from "@shared/types";

interface ProjectDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectRecord;
}

export function ProjectDeleteConfirmDialog({
  open,
  onOpenChange,
  project,
}: ProjectDeleteConfirmDialogProps) {
  const { remove } = useProjects();
  const [isDeleting, setIsDeleting] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!acknowledged) return;

    setIsDeleting(true);
    setError(null);

    try {
      await remove(project.id);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
      setIsDeleting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setAcknowledged(false);
      setError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="bg-surface text-foreground border border-border shadow-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Project?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete project "{project.name}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start space-x-3 rounded-md border border-destructive/20 bg-destructive/5 p-4">
            <Checkbox
              id="orphan-acknowledgment"
              checked={acknowledged}
              onCheckedChange={(checked) => setAcknowledged(!!checked)}
              className="mt-1"
            />
            <div className="grid gap-1.5 leading-none">
              <Label
                htmlFor="orphan-acknowledgment"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                I understand that existing chats in this project will be orphaned.
              </Label>
              <p className="text-xs text-muted-foreground">
                Chats will not be deleted but will no longer be associated with any project.
              </p>
            </div>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={!acknowledged || isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete Project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
