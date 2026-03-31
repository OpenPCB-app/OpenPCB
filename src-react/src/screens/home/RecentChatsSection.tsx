import { Card } from "@/components/ui/card";
import { useNavigationStore } from "@/stores/navigation-store";
import { MessageSquare, Clock, Loader2 } from "lucide-react";
import { useChatList } from "@/hooks/useChatList";

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

export function RecentChatsSection() {
  const { navigateToChat } = useNavigationStore();
  const { chats, loading, error } = useChatList({ limit: 3 });

  if (loading) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent Chats</h2>
        <div className="flex items-center justify-center h-[100px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent Chats</h2>
        <div className="text-sm text-destructive">{error}</div>
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="flex flex-col gap-4 px-8 py-4">
        <h2 className="text-lg font-semibold tracking-tight">Recent Chats</h2>
        <div className="flex h-[100px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No chats yet. Start a new conversation!
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-8 py-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Recent Chats</h2>
        <span className="text-sm text-muted-foreground">
          {chats.length} chat{chats.length !== 1 ? "s" : ""}
        </span>
      </div>

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
    </div>
  );
}
