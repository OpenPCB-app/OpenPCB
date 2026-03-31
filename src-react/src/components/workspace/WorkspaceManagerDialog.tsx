import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAppStore } from "@/stores/app-store"
import { Trash2 } from "lucide-react"

type WorkspaceManagerDialogProps = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceManagerDialog({
  workspaceId,
  open,
  onOpenChange,
}: WorkspaceManagerDialogProps) {
  const { workspaces, updateWorkspace, deleteWorkspace } = useAppStore()
  const workspace = workspaces.find(w => w.id === workspaceId)

  const [name, setName] = useState(workspace?.name || "")
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when dialog opens
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setName(workspace?.name || "")
      setIsEditing(false)
      setError(null)
    }
    onOpenChange(open)
  }

  const handleSave = async () => {
    if (!workspace) return
    if (!name.trim()) {
      setError("Workspace name cannot be empty")
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await updateWorkspace(workspace.id, { name: name.trim() })
      setIsEditing(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!workspace) return

    setIsDeleting(true)
    setError(null)

    try {
      await deleteWorkspace(workspace.id)
      setDeleteDialogOpen(false)
      onOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
      setDeleteDialogOpen(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const canDelete = workspaces.length > 1

  if (!workspace) return null

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="bg-surface text-foreground border-border p-6 shadow-lg w-[min(90vw,28rem)]"
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Manage Workspace</DialogTitle>
            <DialogDescription>
              Edit workspace name or delete workspace
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Workspace Name */}
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace Name</Label>
              {isEditing ? (
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter workspace name"
                  className="bg-background"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave()
                    if (e.key === "Escape") setIsEditing(false)
                  }}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{workspace.name}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing(true)}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}

            {/* Delete Section */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Delete Workspace</p>
                  <p className="text-xs text-muted-foreground">
                    {canDelete
                      ? "Permanently delete this workspace"
                      : "Cannot delete the last workspace"}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  disabled={!canDelete}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            {isEditing ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditing(false)
                    setName(workspace.name)
                    setError(null)
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </>
            ): null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-surface text-foreground border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{workspace.name}"? This action
              cannot be undone and will delete all projects, threads, and data
              in this workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
