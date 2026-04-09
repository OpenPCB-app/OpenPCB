/**
 * ChatListItem Component
 *
 * Individual chat item in the sidebar with context menu
 * Reuses existing UI components: Button, DropdownMenu
 */

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useProjects } from "@/hooks/useProjects";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquareIcon,
  BotIcon,
  TerminalIcon,
  BookOpenIcon,
  SparklesIcon,
  LightbulbIcon,
  MoreHorizontalIcon,
  PencilIcon,
  TrashIcon,
  FolderIcon,
  FolderOutputIcon,
  FolderKanban,
  StarIcon,
} from "lucide-react";
import type { ChatMetadata, ChatIconName, FolderRecord } from "@shared/types";

const ICON_MAP: Record<ChatIconName, typeof MessageSquareIcon> = {
  "message-square": MessageSquareIcon,
  bot: BotIcon,
  terminal: TerminalIcon,
  "book-open": BookOpenIcon,
  sparkles: SparklesIcon,
  lightbulb: LightbulbIcon,
};

export interface ChatListItemProps {
  chat: ChatMetadata;
  isActive: boolean;
  folders: FolderRecord[];
  onClick: () => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onMoveToProject: (projectId: string | null) => void;
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelectToggle?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export function ChatListItem({
  chat,
  isActive,
  folders,
  onClick,
  onRename,
  onDelete,
  onMoveToFolder,
  onMoveToProject,
  isSelectionMode,
  isSelected,
  onSelectToggle,
  isFavorite,
  onToggleFavorite,
}: ChatListItemProps) {
  const { projects } = useProjects();
  const IconComponent = chat.icon
    ? ICON_MAP[chat.icon.name]
    : MessageSquareIcon;
  const isInFolder = !!chat.folderId;
  const projectName = chat.projectId
    ? projects.find((project) => project.id === chat.projectId)?.name ??
      "Project"
    : "Project";

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("chatId", chat.id);
    e.dataTransfer.effectAllowed = "move";
    e.currentTarget.style.opacity = "0.5";
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.style.opacity = "";
  };

  const handleClick = () => {
    if (isSelectionMode && onSelectToggle) {
      onSelectToggle();
    } else {
      onClick();
    }
  };

  return (
    <div
      draggable={!isSelectionMode}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      className={cn(
        "group relative cursor-pointer flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
        isSelected && "bg-accent/30",
      )}
    >
      {isSelectionMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={onSelectToggle}
          onClick={(e) => e.stopPropagation()}
          className="size-4 shrink-0"
        />
      )}
      <div className="flex flex-1 items-center gap-2 min-w-0 text-left">
        <IconComponent className="size-4 shrink-0" />
        <span className="truncate flex-1">{chat.title}</span>
        {chat.projectId && (
          <span
            className="size-2 shrink-0 rounded-full bg-muted-foreground/60"
            title={projectName}
            aria-label={projectName}
          />
        )}
      </div>

      {!isSelectionMode && (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-6 shrink-0 transition-opacity",
              isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite?.();
            }}
          >
            <StarIcon
              className={cn(
                "size-4",
                isFavorite
                  ? "text-yellow-500 fill-yellow-500"
                  : "text-muted-foreground",
              )}
            />
            <span className="sr-only">
              {isFavorite ? "Remove from favorites" : "Add to favorites"}
            </span>
          </Button>
          <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(
              "size-6 shrink-0 opacity-0 transition-opacity",
              "group-hover:opacity-100",
              isActive && "opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">Chat options</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onRename}>
            <PencilIcon className="size-4" />
            Rename
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderIcon className="size-4" />
              Move to Folder
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {isInFolder && (
                <>
                  <DropdownMenuItem onClick={() => onMoveToFolder(null)}>
                    <FolderOutputIcon className="size-4" />
                    Remove from Folder
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {folders.length === 0 ? (
                <DropdownMenuItem disabled>
                  No folders available
                </DropdownMenuItem>
              ) : (
                folders
                  .filter((f) => f.id !== chat.folderId)
                  .map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={() => onMoveToFolder(folder.id)}
                    >
                      <FolderIcon className="size-4" />
                      {folder.name}
                    </DropdownMenuItem>
                  ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderKanban className="size-4" />
              Move to Project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {chat.projectId && (
                <>
                  <DropdownMenuItem onClick={() => onMoveToProject(null)}>
                    <FolderOutputIcon className="size-4" />
                    Remove from Project
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {projects.filter((p) => p.id !== chat.projectId).length === 0 ? (
                <DropdownMenuItem disabled>
                  No projects available
                </DropdownMenuItem>
              ) : (
                projects
                  .filter((p) => p.id !== chat.projectId)
                  .map((project) => (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => onMoveToProject(project.id)}
                    >
                      <FolderKanban className="size-4" />
                      {project.name}
                    </DropdownMenuItem>
                  ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} variant="destructive">
            <TrashIcon className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
        </>
      )}
    </div>
  );
}

