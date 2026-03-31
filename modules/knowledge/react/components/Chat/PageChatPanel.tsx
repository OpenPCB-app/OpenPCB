import { X, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatInterface } from "@/components/ChatInterface";
import { usePageChat } from "../../hooks/usePageChat";
import type { Page } from "@modules/knowledge/shared/types";
import type { MentionReference } from "@shared/types";
import type { EditAppliedEvent, EditLifecycleEvent } from "../../hooks/usePageChat";

interface PageChatPanelProps {
  /** Currently selected page ID */
  pageId: string;
  /** Page data */
  page: Page;
  /** Active workspace ID */
  workspaceId: string | null;
  /** Callback when panel is closed */
  onClose: () => void;
  /** Callback to navigate to a different page (for @mentions) */
  onSelectPage?: (pageId: string) => void;
  /** Called when an edit tool completes successfully */
  onEditApplied?: (event: EditAppliedEvent) => void;
  /** Called for edit lifecycle events */
  onEditLifecycleEvent?: (event: EditLifecycleEvent) => void;
  /** Disable chat input interactions while page is locked */
  inputDisabled?: boolean;
}

/**
 * Chat panel for discussing a knowledge page with AI.
 *
 * Features:
 * - Uses usePageChat for lazy chat creation
 * - ChatInterface with page context
 * - @mention support for referencing other pages
 */
export function PageChatPanel({
  pageId,
  page,
  workspaceId,
  onClose,
  onSelectPage,
  onEditApplied,
  onEditLifecycleEvent,
  inputDisabled,
}: PageChatPanelProps) {
  const pageChat = usePageChat({
    pageId,
    page,
    workspaceId,
    onEditApplied,
    onEditLifecycleEvent,
  });

  const handleMentionClick = (mention: MentionReference) => {
    // Navigate to the mentioned page if it's a knowledge page
    if (mention.entityType === "knowledge-page" && onSelectPage) {
      onSelectPage(mention.entityId);
    }
  };

  return (
    <div className="flex h-full flex-col bg-muted/5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/40 p-3 h-11 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">Chat</span>
          {pageChat.isInitializing && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Chat Interface */}
      <div className="flex-1 min-h-0">
        {pageChat.isInitializing ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">
              Initializing chat...
            </span>
          </div>
        ) : (
          <ChatInterface
            config={{
              messages: pageChat.messages,
              status: pageChat.status,
              className: "h-full",
              modelName: pageChat.model,
              ui: {
                placeholder: "Ask about this page...",
                emptyState: {
                  title: "Chat about this page",
                  description: `Ask questions, get summaries, or explore ideas about "${page.title}"`,
                },
              },
              features: {
                mentions: {
                  enabled: true,
                  onMentionClick: handleMentionClick,
                },
                tools: {
                  enabled: pageChat.toolsEnabled,
                  toolChoice: pageChat.toolsEnabled ? "auto" : "none",
                  onToolsEnabledChange: pageChat.setToolsEnabled,
                },
                reasoning: {
                  enabled: true,
                  defaultExpanded: false,
                },
              },
              context: {
                workspaceId: workspaceId ?? undefined,
                activeContext:
                  workspaceId && pageId
                    ? {
                        workspaceId,
                        activeTarget: {
                          targetType: "knowledge.page",
                          targetId: pageId,
                        },
                      }
                    : undefined,
              },
              behavior: {
                onSubmit: async (message) => {
                  await pageChat.submitMessage({
                    text: message.text || "",
                    files: message.files,
                  });
                },
                onStop: pageChat.abort,
                autoFocus: true,
                modelLoading: {
                  state: pageChat.modelLoadingState,
                },
                inputDisabled,
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
