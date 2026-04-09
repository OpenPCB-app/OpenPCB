import { cn } from "@/lib/utils";
import { ChatList } from "./ChatList";
import { Button } from "@/components/ui/button";
import { PanelLeft, Plus } from "lucide-react";
import { useNavigationStore } from "@/stores/navigation-store";

export interface CollapsibleChatSidebarProps {
  activeChatId: string | null;
  onChatSelect: (chatId: string | null) => void;
  onNewChat: () => void;
  refreshTrigger?: number;
  className?: string;
}

export function CollapsibleChatSidebar({
  activeChatId,
  onChatSelect,
  onNewChat,
  refreshTrigger,
  className,
}: CollapsibleChatSidebarProps) {
  const { sidebarCollapsed, toggleSidebar } = useNavigationStore();

  if (sidebarCollapsed) {
    return (
      <div
        className={cn(
          "flex h-full w-12 flex-col items-center border-r border-border bg-muted/30 py-2 gap-2",
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onNewChat}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full w-64 flex-col border-r border-border bg-muted/30",
        className,
      )}
    >
      <div className="flex items-center justify-between p-2">

      </div>
      <ChatList
        activeChatId={activeChatId}
        onChatSelect={onChatSelect}
        refreshTrigger={refreshTrigger}
        toggleSidebar={toggleSidebar}
      />
    </div>
  );
}
