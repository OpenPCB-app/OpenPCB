import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Folder, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useFolders } from "@/hooks/useFolders";
import { useNavigationStore } from "@/stores/navigation-store";
import { moveChatToFolder } from "@/lib/api/chat-api";
import { useChatList } from "@/hooks/useChatList";
import { cn } from "@/lib/utils";
import type { FolderRecord } from "@shared/types";

interface FolderCardProps {
  folder: FolderRecord;
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  onChatDrop: (chatId: string) => void;
}

function FolderCard({
  folder,
  onClick,
  onRename,
  onDelete,
  onChatDrop,
}: FolderCardProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const chatId = e.dataTransfer.getData("chatId");
    if (chatId) {
      onChatDrop(chatId);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          className={cn(
            "group flex flex-col justify-between w-[160px] h-[100px] p-4 cursor-pointer transition-colors border-none shadow-sm",
            isDragOver
              ? "bg-accent ring-2 ring-primary"
              : "bg-surface hover:bg-surface-muted",
          )}
          onClick={onClick}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Folder className="h-6 w-6 text-primary/70 group-hover:text-primary transition-colors" />
          <div>
            <div className="font-medium text-sm truncate">{folder.name}</div>
          </div>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onClick={onDelete} className="text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function FolderSection() {
  const { folders, loading, error, create, rename, remove } = useFolders();
  const { navigateToHome } = useNavigationStore();
  const { refetch: refetchChats } = useChatList();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [folderToRename, setFolderToRename] = useState<FolderRecord | null>(
    null,
  );
  const [renameValue, setRenameValue] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<FolderRecord | null>(
    null,
  );

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    setIsCreating(true);
    try {
      await create(newFolderName.trim());
      setCreateDialogOpen(false);
      setNewFolderName("");
    } catch (err) {
      console.error("Failed to create folder:", err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenRename = (folder: FolderRecord) => {
    setFolderToRename(folder);
    setRenameValue(folder.name);
    setRenameDialogOpen(true);
  };

  const handleConfirmRename = async () => {
    if (!folderToRename || !renameValue.trim()) return;
    try {
      await rename(folderToRename.id, renameValue.trim());
      setRenameDialogOpen(false);
      setFolderToRename(null);
      setRenameValue("");
    } catch (err) {
      console.error("Failed to rename folder:", err);
    }
  };

  const handleOpenDelete = (folder: FolderRecord) => {
    setFolderToDelete(folder);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!folderToDelete) return;
    try {
      await remove(folderToDelete.id, "move_to_root");
      setDeleteDialogOpen(false);
      setFolderToDelete(null);
    } catch (err) {
      console.error("Failed to delete folder:", err);
    }
  };

  const handleChatDrop = async (folderId: string, chatId: string) => {
    try {
      await moveChatToFolder(chatId, folderId);
      refetchChats();
    } catch (err) {
      console.error("Failed to move chat to folder:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Folders</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center justify-center h-[100px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Folders</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4 px-8 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Folders</h2>
          <div className="flex items-center gap-2">
            {folders.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {folders.length} folder{folders.length !== 1 ? "s" : ""}
              </span>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {folders.length === 0 ? (
          <div className="flex h-[100px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
            No folders yet. Create one to organize your chats.
          </div>
        ) : (
          <ScrollArea className="w-full whitespace-nowrap pb-2">
            <div className="flex w-max space-x-4 pb-2">
              {folders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onClick={() => navigateToHome()}
                  onRename={() => handleOpenRename(folder)}
                  onDelete={() => handleOpenDelete(folder)}
                  onChatDrop={(chatId) => handleChatDrop(folder.id, chatId)}
                />
              ))}
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        )}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Folder</DialogTitle>
            <DialogDescription>
              Enter a name for your new folder
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Enter a new name for this folder
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Folder name"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirmRename();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{folderToDelete?.name}"? Chats in
              this folder will be moved to the root level.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
