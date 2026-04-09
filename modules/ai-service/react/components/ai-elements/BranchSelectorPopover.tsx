import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { CheckIcon, TrashIcon } from "lucide-react";

export interface Branch {
  messageId: string;
  branchIndex: number;
  isActive: boolean;
  preview: string;
  role: string;
  createdAt: string;
}

interface BranchSelectorPopoverProps {
  messageId: string;
  branches: Branch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onActivate: (messageId: string) => Promise<void>;
  onArchive: (messageId: string) => Promise<void>;
  children: React.ReactNode;
}

export function BranchSelectorPopover({
  branches,
  open,
  onOpenChange,
  onActivate,
  onArchive,
  children,
}: BranchSelectorPopoverProps) {
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);

  const handleArchive = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (archiveTarget) {
      try {
        await onArchive(archiveTarget);
      } finally {
        setArchiveTarget(null);
      }
    }
  };

  const confirmArchive = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    setArchiveTarget(id);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[320px]">
          <DropdownMenuLabel>Message Branches</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <ScrollArea className="h-[200px] p-1">
            {branches.map((branch) => (
              <DropdownMenuItem
                key={branch.messageId}
                className={cn(
                  "flex items-center justify-between gap-2 p-2 cursor-pointer mb-1 last:mb-0",
                  branch.isActive && "bg-accent",
                )}
                onSelect={() => onActivate(branch.messageId)}
              >
                <div className="flex flex-col gap-1 overflow-hidden flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                      {branch.role}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(branch.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <span className="truncate text-xs text-foreground font-normal">
                    {branch.preview || "Empty message"}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {branch.isActive ? (
                    <CheckIcon className="size-4 text-primary" />
                  ) : (
                    <div
                      role="button"
                      className="p-1.5 rounded-sm hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                      onClick={(e) => confirmArchive(e, branch.messageId)}
                    >
                      <TrashIcon className="size-3.5" />
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to archive this branch? It will be hidden
              from this view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchive}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
