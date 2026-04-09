import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontalIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  CopyIcon,
  TrashIcon,
  EditIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  BookmarkIcon,
  GitForkIcon,
  Loader2Icon,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageActions } from "@/components/ai-elements/message";
import { BranchIndicator } from "@/components/ai-elements/BranchIndicator";
import {
  BranchSelectorPopover,
  type Branch,
} from "@/components/ai-elements/BranchSelectorPopover";
import { useBranches } from "@/hooks/useBranches";

export type MessageRating = "thumbs-up" | "thumbs-down" | null;
export type MessageAction =
  | "copy"
  | "delete"
  | "edit"
  | "resend"
  | "regenerate"
  | "thumbs-up"
  | "thumbs-down"
  | "bookmark"
  | "fork";

const RESEND_RETRYABLE_STATUSES = new Set(["failed", "paused", "cancelled"]);

function extractTextContent(message: UIMessage): string {
  return (
    message.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") ?? ""
  );
}

type MessageActionPayload = {
  content?: string;
};

export type MessageFooterProps = {
  message: UIMessage;
  rating?: MessageRating;
  timestamp?: Date;
  onRatingChange?: (rating: MessageRating) => void;
  onAction?: (action: MessageAction, payload?: MessageActionPayload) => void;
  showTimestamp?: boolean;
  showRating?: boolean;
  showActions?: boolean;
  className?: string;
  branchCount?: number;
  currentBranchIndex?: number;
  messageId?: string;
  onBranchChange?: () => void;
  forkDisabled?: boolean;
  forkLoading?: boolean;
  actionsDisabled?: boolean;
  actionLoading?: MessageAction | null;
};

/**
 * Pure UI component for message footer with timestamp, rating, and actions
 */
export function MessageFooter({
  message,
  rating = null,
  timestamp = new Date(),
  onRatingChange,
  onAction,
  showTimestamp = true,
  showRating = true,
  showActions = true,
  className,
  branchCount = 0,
  currentBranchIndex = 0,
  onBranchChange,
  forkDisabled,
  forkLoading,
  actionsDisabled = false,
  actionLoading = null,
}: MessageFooterProps) {
  const isUser = message.role === "user";
  const canEdit = isUser || message.role === "assistant";
  const originalText = useMemo(() => extractTextContent(message), [message]);
  const messageMetadata = (message as UIMessage & {
    metadata?: { incomplete?: boolean; cancelled?: boolean; error?: string } | null;
    taskStatus?: string | null;
    isError?: boolean;
  }).metadata;
  const taskStatus = (message as UIMessage & { taskStatus?: string | null }).taskStatus;
  const isMessageError = Boolean(
    (message as UIMessage & { isError?: boolean }).isError ||
      messageMetadata?.error,
  );
  const canResend =
    !isUser &&
    (isMessageError ||
      Boolean(messageMetadata?.incomplete) ||
      (typeof taskStatus === "string" &&
        RESEND_RETRYABLE_STATUSES.has(taskStatus)));
  const canRegenerate = !isUser;

  const { getAlternateBranches, activateBranch, archiveBranch } = useBranches();
  const [isBranchSelectorOpen, setIsBranchSelectorOpen] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isForkDialogOpen, setIsForkDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState(originalText);

  useEffect(() => {
    if (isEditDialogOpen) {
      setEditContent(originalText);
    }
  }, [isEditDialogOpen, originalText]);

  const trimmedEdit = editContent.trim();
  const canSubmitEdit =
    trimmedEdit.length > 0 &&
    trimmedEdit !== originalText.trim() &&
    !actionsDisabled &&
    actionLoading !== "edit";

  useEffect(() => {
    if (isBranchSelectorOpen && message.id) {
      getAlternateBranches(message.id)
        .then((res) => {
          setBranches(res.branches);
        })
        .catch(console.error);
    }
  }, [isBranchSelectorOpen, message.id, getAlternateBranches]);

  const handleBranchActivate = async (id: string) => {
    try {
      await activateBranch(id);
      setIsBranchSelectorOpen(false);
      onBranchChange?.();
    } catch (error) {
      console.error("Failed to activate branch:", error);
    }
  };

  const handleBranchArchive = async (id: string) => {
    try {
      await archiveBranch(id);
      if (message.id) {
        const res = await getAlternateBranches(message.id);
        setBranches(res.branches);
      }
    } catch (error) {
      console.error("Failed to archive branch:", error);
    }
  };

  const handleThumbsUp = () => {
    const newRating = rating === "thumbs-up" ? null : "thumbs-up";
    onRatingChange?.(newRating);
    if (newRating) {
      onAction?.("thumbs-up");
    }
  };

  const handleThumbsDown = () => {
    const newRating = rating === "thumbs-down" ? null : "thumbs-down";
    onRatingChange?.(newRating);
    if (newRating) {
      onAction?.("thumbs-down");
    }
  };

  const handleEditSubmit = () => {
    if (!canSubmitEdit) {
      return;
    }
    onAction?.("edit", { content: trimmedEdit });
    setIsEditDialogOpen(false);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        isUser ? "justify-end" : "justify-start",
        className,
      )}
    >
      {!isUser && showTimestamp && (
        <span>
          {timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}

      {showActions && (
        <MessageActions className={cn(isUser && "order-first")}>
          {branchCount > 1 && message.id && (
            <BranchSelectorPopover
              messageId={message.id}
              branches={branches}
              open={isBranchSelectorOpen}
              onOpenChange={setIsBranchSelectorOpen}
              onActivate={handleBranchActivate}
              onArchive={handleBranchArchive}
            >
              <BranchIndicator
                currentBranchIndex={currentBranchIndex}
                totalBranches={branchCount}
                onOpenSelector={() => setIsBranchSelectorOpen(true)}
              />
            </BranchSelectorPopover>
          )}

          {/* Rating icons - only show for assistant messages */}
          {!isUser && showRating && (
            <>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleThumbsUp}
                      className={cn(
                        "inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                        rating === "thumbs-up" && "text-primary",
                      )}
                      aria-label="Thumbs up"
                    >
                      <ThumbsUpIcon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {rating === "thumbs-up"
                        ? "Remove thumbs up"
                        : "Thumbs up"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={handleThumbsDown}
                      className={cn(
                        "inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
                        rating === "thumbs-down" && "text-primary",
                      )}
                      aria-label="Thumbs down"
                    >
                      <ThumbsDownIcon className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {rating === "thumbs-down"
                        ? "Remove thumbs down"
                        : "Thumbs down"}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}

          {/* More options menu */}
          <DropdownMenu>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={actionsDisabled || forkLoading}
                      className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer disabled:opacity-50"
                      aria-label="More options"
                    >
                      {forkLoading ? (
                        <Loader2Icon className="size-3.5 animate-spin" />
                      ) : (
                        <MoreHorizontalIcon className="size-3.5" />
                      )}
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>More options</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onAction?.("copy")}>
                <CopyIcon className="size-4" />
                Copy message
              </DropdownMenuItem>
              {(isUser || message.role === "assistant") && (
                <DropdownMenuItem
                  disabled={forkDisabled || forkLoading || actionsDisabled}
                  onClick={() => setIsForkDialogOpen(true)}
                >
                  {forkLoading ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <GitForkIcon className="size-4" />
                  )}
                  Fork to New Chat
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem
                  disabled={actionsDisabled || actionLoading === "edit"}
                  onClick={() => setIsEditDialogOpen(true)}
                >
                  {actionLoading === "edit" ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <EditIcon className="size-4" />
                  )}
                  Edit message
                </DropdownMenuItem>
              )}
            {!isUser && (
              <>
                {canRegenerate && (
                  <DropdownMenuItem
                    disabled={actionsDisabled || actionLoading === "regenerate"}
                    onClick={() => onAction?.("regenerate")}
                  >
                    {actionLoading === "regenerate" ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <RefreshCwIcon className="size-4" />
                    )}
                    Regenerate response
                  </DropdownMenuItem>
                )}
                {canResend && (
                  <DropdownMenuItem
                    disabled={actionsDisabled || actionLoading === "resend"}
                    onClick={() => onAction?.("resend")}
                  >
                    {actionLoading === "resend" ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <RotateCcwIcon className="size-4" />
                    )}
                    Resend message
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAction?.("bookmark")}>
                  <BookmarkIcon className="size-4" />
                  Bookmark
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
                onClick={() => onAction?.("delete")}
                variant="destructive"
              >
                <TrashIcon className="size-4" />
                Delete message
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </MessageActions>
      )}

      {isUser && showTimestamp && (
        <span>
          {timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      )}

      <AlertDialog open={isForkDialogOpen} onOpenChange={setIsForkDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fork this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a new chat starting from this message. The current
              chat will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onAction?.("fork");
                setIsForkDialogOpen(false);
              }}
            >
              Fork Chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit message</DialogTitle>
            <DialogDescription>
              Save to create a new conversation branch from this point.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={editContent}
            onChange={(event) => setEditContent(event.target.value)}
            rows={6}
            placeholder="Update your message"
            disabled={actionsDisabled || actionLoading === "edit"}
          />
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsEditDialogOpen(false)}
              disabled={actionLoading === "edit"}
            >
              Cancel
            </Button>
            <Button onClick={handleEditSubmit} disabled={!canSubmitEdit}>
              {actionLoading === "edit" ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Saving
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
