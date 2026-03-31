/**
 * ChatList Component
 *
 * Sidebar chat list with create, rename, delete functionality
 * Folders displayed as collapsible sections containing their chats
 * Root-level chats (no folder) shown below folders
 */
import { PanelLeftClose } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { Input } from "@/components/ui/input";
import {
  PlusIcon,
  MessageSquareIcon,
  Loader2Icon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  Trash2Icon,
  XIcon,
  CheckSquareIcon,
  SquareIcon,
  StarIcon,
  GripVerticalIcon,
  BookmarkIcon,
} from "lucide-react";
import { BookmarksPanel } from "@/components/BookmarksPanel";
import { ChatListItem } from "./ChatListItem";
import { useChatList } from "@/hooks/useChatList";
import { useChatOperations } from "@/hooks/useChatOperations";
import { useFolders } from "@/hooks/useFolders";
import { useFavorites } from "@/hooks/useFavorites";
import { moveChatToFolder, moveChatToProject, deleteChats } from "@/lib/api/chat-api";
import type { ChatMetadata, FolderRecord } from "@shared/types";
import type { FavoriteWithChat } from "@shared/types/favorite.types";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableFavoriteItem({
  favorite,
  activeChatId,
  folders,
  onChatSelect,
  onChatRename,
  onChatDelete,
  onMoveToFolder,
  onMoveToProject,
  onToggleFavorite,
}: {
  favorite: FavoriteWithChat;
  activeChatId: string | null;
  folders: FolderRecord[];
  onChatSelect: (chatId: string) => void;
  onChatRename: (chat: ChatMetadata) => void;
  onChatDelete: (chat: ChatMetadata) => void;
  onMoveToFolder: (chatId: string, folderId: string | null) => void;
  onMoveToProject: (chatId: string, projectId: string | null) => void;
  onToggleFavorite: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: favorite.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  if (!favorite.chat) return null;

  // Create a minimal ChatMetadata-like object from the favorite
  // We need to satisfy ChatMetadata interface
  const chatMeta: ChatMetadata = {
    id: favorite.chat.id,
    title: favorite.chat.title,
    updatedAt: favorite.chat.updatedAt,
    // Fill required fields with defaults
    workspaceId: favorite.workspaceId,
    createdAt: favorite.createdAt, // Fallback to favorite creation time
    config: {
      provider: "openai", // Default
      model: "gpt-4o-mini-2024-07-18",
      systemPrompt: null,
    },
    messageCount: 0,
    lastMessagePreview: null,
    tags: [],
    pinned: false,
    archived: false,
    icon: null,
    folderId: null,
    projectId: null,
    category: null,
    contextRef: null,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-0.5 group/fav">
      <button
        className="cursor-grab p-0.5 text-muted-foreground/50 hover:text-muted-foreground touch-none opacity-0 group-hover/fav:opacity-100 transition-opacity"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-3" />
      </button>
      <div className="flex-1 min-w-0">
        <ChatListItem
          chat={chatMeta}
          isActive={activeChatId === favorite.chat.id}
          folders={folders}
          onClick={() => onChatSelect(favorite.chat!.id)}
          onRename={() => onChatRename(chatMeta)}
          onDelete={() => onChatDelete(chatMeta)}
          onMoveToFolder={(folderId) => onMoveToFolder(favorite.chat!.id, folderId)}
          onMoveToProject={(projectId) => onMoveToProject(favorite.chat!.id, projectId)}
          isFavorite={true}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </div>
  );
}

interface CollapsibleFolderProps {

  folder: FolderRecord;
  chats: ChatMetadata[];
  activeChatId: string | null;
  allFolders: FolderRecord[];
  onToggle: () => void;
  onChatSelect: (chatId: string) => void;
  onChatRename: (chat: ChatMetadata) => void;
  onChatDelete: (chat: ChatMetadata) => void;
  onMoveToFolder: (chatId: string, folderId: string | null) => void;
  onMoveToProject: (chatId: string, projectId: string | null) => void;
  onDrop: (folderId: string, chatId: string) => void;
  isSelectionMode?: boolean;
  selectedChats?: Set<string>;
  onSelectChat?: (chatId: string) => void;
  isFavorite: (chatId: string) => boolean;
  onToggleFavorite: (chatId: string) => void;
}

function CollapsibleFolder({
  folder,
  chats,
  activeChatId,
  allFolders,
  onToggle,
  onChatSelect,
  onChatRename,
  onChatDelete,
  onMoveToFolder,
  onMoveToProject,
  onDrop,
  isSelectionMode,
  selectedChats,
  onSelectChat,
  isFavorite,
  onToggleFavorite,
}: CollapsibleFolderProps) {
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
      onDrop(folder.id, chatId);
    }
  };

  const isExpanded = folder.isExpanded;
  const ChevronIcon = isExpanded ? ChevronDownIcon : ChevronRightIcon;
  const FolderStateIcon = isExpanded ? FolderOpenIcon : FolderIcon;

  return (
    <div className="space-y-0.5">
      {/* Folder header - clickable to toggle */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={onToggle}
        className={cn(
          "flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer select-none",
          isDragOver
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50 text-muted-foreground",
        )}
      >
        <ChevronIcon className="size-4 shrink-0" />
        <FolderStateIcon className="size-4 shrink-0" />
        <span className="truncate flex-1 font-medium">{folder.name}</span>
        <span className="text-xs text-muted-foreground/70">{chats.length}</span>
      </div>

      {/* Nested chats - only show when expanded */}
      {isExpanded && chats.length > 0 && (
        <div className="pl-4 space-y-0.5">
          {chats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              folders={allFolders}
              onClick={() => onChatSelect(chat.id)}
              onRename={() => onChatRename(chat)}
              onDelete={() => onChatDelete(chat)}
              onMoveToFolder={(folderId) => onMoveToFolder(chat.id, folderId)}
              onMoveToProject={(projectId) => onMoveToProject(chat.id, projectId)}
              isSelectionMode={isSelectionMode}
              isSelected={selectedChats?.has(chat.id)}
              onSelectToggle={() => onSelectChat?.(chat.id)}
              isFavorite={isFavorite(chat.id)}
              onToggleFavorite={() => onToggleFavorite(chat.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export interface ChatListProps {
  activeChatId: string | null;
  onChatSelect: (chatId: string | null) => void;
  className?: string;
}

export function ChatList({
  activeChatId,
  onChatSelect,
  refreshTrigger,
  toggleSidebar,
  className,
}: ChatListProps & { refreshTrigger?: number; toggleSidebar?: () => void }) {
  const { chats, loading, error, refetch } = useChatList();
  const {
    renameChat,
    removeChat,
    isCreating,
    error: operationError,
  } = useChatOperations(refetch);
  const { folders, toggleExpanded } = useFolders();
  const {
    favorites,
    add: addFavorite,
    remove: removeFavorite,
    isFavorite,
    reorder: reorderFavorite,
  } = useFavorites();
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (refreshTrigger) {
      refetch();
    }
  }, [refreshTrigger, refetch]);

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [chatToRename, setChatToRename] = useState<ChatMetadata | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<ChatMetadata | null>(null);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const { chatsByFolder, rootChats } = useMemo(() => {
    if (!chats)
      return {
        chatsByFolder: new Map<string, ChatMetadata[]>(),
        rootChats: [],
      };

    const byFolder = new Map<string, ChatMetadata[]>();
    const root: ChatMetadata[] = [];

    for (const chat of chats) {
      if (chat.folderId) {
        const existing = byFolder.get(chat.folderId) ?? [];
        existing.push(chat);
        byFolder.set(chat.folderId, existing);
      } else {
        root.push(chat);
      }
    }

    return { chatsByFolder: byFolder, rootChats: root };
  }, [chats]);

  const handleNewChat = () => {
    onChatSelect(null);
  };

  const handleOpenRename = (chat: ChatMetadata) => {
    setChatToRename(chat);
    setNewTitle(chat.title);
    setRenameDialogOpen(true);
  };

  const handleConfirmRename = async () => {
    if (!chatToRename || !newTitle.trim()) return;

    await renameChat(chatToRename.id, newTitle.trim());
    setRenameDialogOpen(false);
    setChatToRename(null);
    setNewTitle("");
  };

  const handleOpenDelete = (chat: ChatMetadata) => {
    setChatToDelete(chat);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!chatToDelete) return;

    const success = await removeChat(chatToDelete.id);
    if (success && activeChatId === chatToDelete.id) {
      onChatSelect(null);
    }

    setDeleteDialogOpen(false);
    setChatToDelete(null);
  };

  const handleMoveToFolder = async (
    chatId: string,
    folderId: string | null,
  ) => {
    try {
      await moveChatToFolder(chatId, folderId);
      refetch();
    } catch (err) {
      console.error("Failed to move chat to folder:", err);
    }
  };

  const handleMoveToProject = async (
    chatId: string,
    projectId: string | null,
  ) => {
    try {
      await moveChatToProject(chatId, projectId);
      refetch();
    } catch (err) {
      console.error("Failed to move chat to project:", err);
    }
  };

  const handleFolderDrop = (folderId: string, chatId: string) => {
    handleMoveToFolder(chatId, folderId);
  };

  const handleToggleSelectionMode = () => {
    setIsSelectionMode(!isSelectionMode);
    setSelectedChats(new Set());
  };

  const handleSelectChat = (chatId: string) => {
    const newSelected = new Set(selectedChats);
    if (newSelected.has(chatId)) {
      newSelected.delete(chatId);
    } else {
      newSelected.add(chatId);
    }
    setSelectedChats(newSelected);
  };

  const handleSelectAll = () => {
    const allChatIds = chats.map((chat) => chat.id);
    if (selectedChats.size === allChatIds.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(allChatIds));
    }
  };

  const handleOpenBulkDelete = () => {
    if (selectedChats.size === 0) return;
    setBulkDeleteDialogOpen(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedChats.size === 0) return;

    const ids = Array.from(selectedChats);
    try {
      await deleteChats(ids);
      if (ids.includes(activeChatId || "")) {
        onChatSelect(null);
      }
      setIsSelectionMode(false);
      setSelectedChats(new Set());
      refetch();
    } catch (err) {
      console.error("Failed to delete chats:", err);
    } finally {
      setBulkDeleteDialogOpen(false);
    }
  };

  const handleCancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedChats(new Set());
  };

  const handleFavoriteDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = favorites.findIndex((f) => f.id === active.id);
    const newIndex = favorites.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    reorderFavorite(active.id as string, newIndex);
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Chats</h2>

        <div>
          {isSelectionMode ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleSelectAll}
                className="mr-2"
                aria-label={selectedChats.size === chats.length ? "Deselect all" : "Select all"}
              >
                {selectedChats.size === chats.length ? (
                  <CheckSquareIcon className="size-4" />
                ) : (
                  <SquareIcon className="size-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleOpenBulkDelete}
                disabled={selectedChats.size === 0}
                className="mr-2"
                aria-label="Delete selected"
              >
                <Trash2Icon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleCancelSelection}
                aria-label="Cancel selection"
              >
                <XIcon className="size-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setBookmarksPanelOpen(true)}
                className="mr-2"
                aria-label="Open bookmarks"
              >
                <BookmarkIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleSidebar}
                className="mr-2"
                aria-label="Collapse sidebar"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
              <Button
                onClick={handleNewChat}
                variant="ghost"
                size="icon-sm"
                disabled={isCreating}
              >
                {isCreating ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlusIcon className="size-4" />
                )}
                <span className="sr-only">New chat</span>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleToggleSelectionMode}
                className="ml-2"
                aria-label="Enter selection mode"
              >
                <CheckSquareIcon className="size-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {loading && (!chats || chats.length === 0) && (
            <div className="flex items-center justify-center py-8">
              <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 text-sm text-destructive">{error}</div>
          )}

          {operationError && (
            <div className="px-3 py-2 text-sm text-destructive">
              {operationError}
            </div>
          )}

          {!loading && (!chats || chats.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <MessageSquareIcon className="size-8 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">No chats yet</p>
              <p className="text-xs text-muted-foreground">
                Create a new chat to get started
              </p>
            </div>
          )}

          {folders.length > 0 && (
            <div className="space-y-1 mb-2">
              {/* Favorites Section */}
              {favorites.length > 0 && (
                <div className="space-y-0.5 mb-2">
                  <div
                    onClick={() => setFavoritesExpanded(!favoritesExpanded)}
                    className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer select-none hover:bg-accent/50 text-muted-foreground"
                  >
                    {favoritesExpanded ? (
                      <ChevronDownIcon className="size-4 shrink-0" />
                    ) : (
                      <ChevronRightIcon className="size-4 shrink-0" />
                    )}
                    <StarIcon className="size-4 shrink-0 text-yellow-500 fill-yellow-500" />
                    <span className="truncate flex-1 font-medium">Favorites</span>
                    <span className="text-xs text-muted-foreground/70">
                      {favorites.length}
                    </span>
                  </div>

                  {favoritesExpanded && (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={handleFavoriteDragEnd}
                    >
                      <SortableContext
                        items={favorites.map((f) => f.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        <div className="pl-4 space-y-0.5">
                          {favorites.map((fav) => (
                            <SortableFavoriteItem
                              key={fav.id}
                              favorite={fav}
                              activeChatId={activeChatId}
                              folders={folders}
                              onChatSelect={onChatSelect}
                              onChatRename={handleOpenRename}
                              onChatDelete={handleOpenDelete}
                              onMoveToFolder={handleMoveToFolder}
                              onMoveToProject={handleMoveToProject}
                              onToggleFavorite={() =>
                                fav.chatId && removeFavorite(fav.chatId)
                              }
                            />
                          ))}
                        </div>
                      </SortableContext>
                    </DndContext>
                  )}

                  <div className="h-px bg-border mx-2 my-2" />
                </div>
              )}

              {folders.map((folder) => (
                <CollapsibleFolder
                  key={folder.id}
                  folder={folder}
                  chats={chatsByFolder.get(folder.id) ?? []}
                  activeChatId={activeChatId}
                  allFolders={folders}
                  onToggle={() => toggleExpanded(folder.id)}
                  onChatSelect={onChatSelect}
                  onChatRename={handleOpenRename}
                  onChatDelete={handleOpenDelete}
                  onMoveToFolder={handleMoveToFolder}
                  onMoveToProject={handleMoveToProject}
                  onDrop={handleFolderDrop}
                  isSelectionMode={isSelectionMode}
                  selectedChats={selectedChats}
                  onSelectChat={handleSelectChat}
                  isFavorite={isFavorite}
                  onToggleFavorite={(chatId) =>
                    isFavorite(chatId)
                      ? removeFavorite(chatId)
                      : addFavorite(chatId)
                  }
                />
              ))}
              {rootChats.length > 0 && (
                <div className="h-px bg-border mx-2 my-2" />
              )}
            </div>
          )}

          {/* Root chats */}
          {folders.length === 0 && favorites.length > 0 && (
            <div className="space-y-0.5 mb-2">
              <div
                onClick={() => setFavoritesExpanded(!favoritesExpanded)}
                className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors cursor-pointer select-none hover:bg-accent/50 text-muted-foreground"
              >
                {favoritesExpanded ? (
                  <ChevronDownIcon className="size-4 shrink-0" />
                ) : (
                  <ChevronRightIcon className="size-4 shrink-0" />
                )}
                <StarIcon className="size-4 shrink-0 text-yellow-500 fill-yellow-500" />
                <span className="truncate flex-1 font-medium">Favorites</span>
                <span className="text-xs text-muted-foreground/70">
                  {favorites.length}
                </span>
              </div>

              {favoritesExpanded && (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleFavoriteDragEnd}
                >
                  <SortableContext
                    items={favorites.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="pl-4 space-y-0.5">
                      {favorites.map((fav) => (
                        <SortableFavoriteItem
                          key={fav.id}
                          favorite={fav}
                          activeChatId={activeChatId}
                          folders={folders}
                          onChatSelect={onChatSelect}
                          onChatRename={handleOpenRename}
                          onChatDelete={handleOpenDelete}
                          onMoveToFolder={handleMoveToFolder}
                          onMoveToProject={handleMoveToProject}
                          onToggleFavorite={() =>
                            fav.chatId && removeFavorite(fav.chatId)
                          }
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
              <div className="h-px bg-border mx-2 my-2" />
            </div>
          )}

          {rootChats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              folders={folders}
              onClick={() => onChatSelect(chat.id)}
              onRename={() => handleOpenRename(chat)}
              onDelete={() => handleOpenDelete(chat)}
              onMoveToFolder={(folderId) =>
                handleMoveToFolder(chat.id, folderId)
              }
              onMoveToProject={(projectId) =>
                handleMoveToProject(chat.id, projectId)
              }
              isSelectionMode={isSelectionMode}
              isSelected={selectedChats.has(chat.id)}
              onSelectToggle={() => handleSelectChat(chat.id)}
              isFavorite={isFavorite(chat.id)}
              onToggleFavorite={() =>
                isFavorite(chat.id)
                  ? removeFavorite(chat.id)
                  : addFavorite(chat.id)
              }
            />
          ))}
        </div>
      </ScrollArea>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new name for this chat
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Chat name"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleConfirmRename();
              }
            }}
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{chatToDelete?.title}"? This
              action cannot be undone.
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

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Chats</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedChats.size} selected chat{selectedChats.size === 1 ? "" : "s"}? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmBulkDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BookmarksPanel
        open={bookmarksPanelOpen}
        onOpenChange={setBookmarksPanelOpen}
      />
    </div>
  );
}
