/**
 * ChatSidebar Component
 * 
 * Simple sidebar wrapper for chat list
 * Minimal structure - just a container with border
 */

import { cn } from "@/lib/utils";
import { ChatList } from "./ChatList";

export interface ChatSidebarProps {
    activeChatId: string | null;
    onChatSelect: (chatId: string | null) => void;
    refreshTrigger?: number;
    className?: string;
}

export function ChatSidebar({
    activeChatId,
    onChatSelect,
    refreshTrigger,
    className,
}: ChatSidebarProps) {
    return (
        <div
            className={cn(
                "flex h-full w-64 flex-col border-r border-border bg-muted/30",
                className
            )}
        >
            <ChatList
                activeChatId={activeChatId}
                onChatSelect={onChatSelect}
                refreshTrigger={refreshTrigger}
            />
        </div>
    );
}
