import { useState } from "react";
import { Plus, Trash2, Edit2, Check, X, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { TagBadge } from "./TagBadge";
import { useTags } from "@/hooks/useTags";
import { cn } from "@/lib/utils";
import type { TagRecord } from "@shared/types/tag.types";

interface TagManagerProps {
  children?: React.ReactNode;
  projectId?: string;
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#84cc16",
  "#10b981",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#64748b",
  "#000000",
];

export function TagManager({ children, projectId }: TagManagerProps) {
  const { tags, loading, createTag, updateTag, deleteTag } = useTags(projectId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string | null>(COLORS[6] ?? null);
  const [deleteTarget, setDeleteTarget] = useState<TagRecord | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const startEdit = (tag: TagRecord) => {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color || null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditColor(null);
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setFormError(null);
    try {
      await updateTag(id, {
        name: editName,
        color: editColor,
      });
      setEditingId(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to update tag";
      setFormError(message);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setFormError(null);
    try {
      await createTag({
        name: newName,
        color: newColor,
        projectId,
      });
      setNewName("");
      setNewColor(COLORS[Math.floor(Math.random() * COLORS.length)] ?? null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create tag";
      setFormError(message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTag(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to delete tag";
      setFormError(message);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Dialog>
        <DialogTrigger asChild>
          {children || <Button variant="outline">Manage Tags</Button>}
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Manage Tags</DialogTitle>
            <DialogDescription>
              Create, edit, and manage your tags.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 py-4">
            <Input
              placeholder="New tag name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-9"
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <ColorPicker color={newColor} onChange={(c) => setNewColor(c)} />
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!newName.trim()}
              aria-label="Create tag"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {loading ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                Loading...
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-4">
                No tags created yet.
              </div>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between p-2 rounded-md border bg-card"
                >
                  {editingId === tag.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(tag.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                      />
                      <ColorPicker
                        color={editColor}
                        onChange={(c) => setEditColor(c)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-green-500"
                        onClick={() => saveEdit(tag.id)}
                        aria-label={`Save tag ${tag.name}`}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-red-500"
                        onClick={cancelEdit}
                        aria-label="Cancel edit"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <TagBadge tag={tag} />
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => startEdit(tag)}
                          aria-label={`Edit tag ${tag.name}`}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setDeleteTarget(tag)}
                          aria-label={`Delete tag ${tag.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {formError && (
            <div className="text-sm text-destructive bg-destructive/10 p-2 rounded mt-2">
              {formError}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;?
              This will remove it from all chats and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ColorPicker({
  color,
  onChange,
}: {
  color: string | null;
  onChange: (c: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          style={{ backgroundColor: color || undefined }}
        >
          {color ? null : <Palette className="h-4 w-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48 p-2">
        <div className="grid grid-cols-4 gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Select color ${c}`}
              className={cn(
                "h-8 w-8 rounded-full border border-muted ring-offset-background transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                color === c && "ring-2 ring-ring ring-offset-2",
              )}
              style={{ backgroundColor: c }}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
