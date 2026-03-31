import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type WorkspaceSettingsDialogProps = {
  workspaceLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceSettingsDialog({
  workspaceLabel,
  open,
  onOpenChange,
}: WorkspaceSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-surface text-foreground border p-6 shadow-lg w-[min(90vw,24rem)]"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{workspaceLabel}</DialogTitle>
          <DialogDescription>
            Workspace-specific toggles and quick preferences live here for a
            lighter experience.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="pt-4">
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
