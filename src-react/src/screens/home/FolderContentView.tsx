import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigationStore } from "@/stores/navigation-store";
import { useChatList } from "@/hooks/useChatList";
import { useFolders } from "@/hooks/useFolders";
import {
  MessageSquare,
  Clock,
  Loader2,
  ArrowLeft,
  FolderIcon,
} from "lucide-react";

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 7)}w ago`;
}

interface FolderContentViewProps {
  folderId: string;
}

export function FolderContentView({ folderId }: FolderContentViewProps) {
  const { navigateToChat, navigateToHome } = useNavigationStore();
  const { folders } = useFolders();
  const { chats, loading, error } = useChatList({ folderId });

  const folder = folders.find((f) => f.id === folderId);
  const folderName = folder?.name ?? "Folder";

  const handleBack = () => {
    navigateToHome();
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <FolderIcon className="h-5 w-5 text-primary/70" />
          <h2 className="text-lg font-semibold tracking-tight">{folderName}</h2>
        </div>
        <div className="flex items-center justify-center h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <FolderIcon className="h-5 w-5 text-primary/70" />
          <h2 className="text-lg font-semibold tracking-tight">{folderName}</h2>
        </div>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <FolderIcon className="h-5 w-5 text-primary/70" />
          <h2 className="text-lg font-semibold tracking-tight">{folderName}</h2>
        </div>
        <span className="text-sm text-muted-foreground">
          {chats.length} chat{chats.length !== 1 ? "s" : ""}
        </span>
      </div>

      {chats.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          This folder is empty. Drag chats here to organize them.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {chats.map((chat) => (
            <Card
              key={chat.id}
              className="group flex flex-col p-4 cursor-pointer hover:bg-surface-muted transition-colors border-none bg-surface shadow-sm h-[100px]"
              onClick={() => navigateToChat(chat.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigateToChat(chat.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 overflow-hidden">
                  <MessageSquare className="h-4 w-4 text-primary/60 shrink-0" />
                  <span className="font-medium text-sm truncate">
                    {chat.title}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between mt-auto text-xs text-muted-foreground">
                <span className="bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
                  {chat.config?.model}
                </span>
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>{formatRelativeTime(chat.updatedAt)}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
