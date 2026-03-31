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
import { useAppStore } from "@/stores/app-store"

type WorkspaceCreateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mandatory?: boolean
}

export function WorkspaceCreateDialog({
  open,
  onOpenChange,
  mandatory = false,
}: WorkspaceCreateDialogProps) {
  const { createWorkspace, setActiveWorkspace } = useAppStore()

  const [name, setName] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when dialog opens/closes
  const handleOpenChange = (open: boolean) => {
    // If mandatory, prevent closing (setting open to false)
    if (mandatory && !open) return

    if (!open) {
      setName("")
      setError(null)
      setIsCreating(false)
    }
    onOpenChange(open)
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Workspace name cannot be empty")
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const newWorkspace = await createWorkspace({
        name: name.trim(),
        settings: {},
      })

      // Switch to newly created workspace
      setActiveWorkspace(newWorkspace.id)

      // Close dialog
      handleOpenChange(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="bg-surface text-foreground border-border p-6 shadow-lg sm:max-w-[425px]"
        onPointerDownOutside={(event) => event.preventDefault()}
        showCloseButton={!mandatory}
      >
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>
            {mandatory
              ? "Welcome! You need to create a workspace to get started."
              : "Create a new workspace to organize your projects and data"}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-workspace-name">Workspace Name</Label>
            <Input
              id="new-workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Personal, Work, Team"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate()
                if (e.key === "Escape" && !mandatory) handleOpenChange(false)
              }}
            />
          </div>

          {/* Error Message */}
          {error && (
            <div className="text-sm text-destructive font-medium bg-destructive/10 p-3 rounded-md border border-destructive/20">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          {!mandatory && (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
          )}
          <Button onClick={handleCreate} disabled={isCreating} className="w-full sm:w-auto">
            {isCreating ? "Creating..." : "Create Workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
