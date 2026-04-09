"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatStatus, FileUIPart } from "ai";
import {
  ArrowUpIcon,
  Loader2Icon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
  WrenchIcon,
} from "lucide-react";
import { nanoid } from "nanoid";
import {
  type ClipboardEventHandler,
  type FormEvent,
  type FormEventHandler,
  type HTMLAttributes,
  type KeyboardEventHandler,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMentions } from "@/hooks/useMentions";
import { MentionAutocomplete } from "@/components/chat/MentionAutocomplete";
import type { MentionEntity } from "@shared/types";

// ============================================================================
// Types
// ============================================================================

export type PromptInputMessage = {
  text?: string;
  files?: FileUIPart[];
};

export type AIChatPromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit"
> & {
  textareaRef?: RefObject<HTMLTextAreaElement>;
  placeholder?: string;
  accept?: string;
  multiple?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  status?: ChatStatus;
  onStop?: () => void;
  onError?: (err: {
    code: "max_files" | "max_file_size" | "accept";
    message: string;
  }) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
  chatId?: string;
  workspaceId?: string;
  autoFocus?: boolean;
  autoFocusKey?: string | number;
  toolsEnabled?: boolean;
  onToolsEnabledChange?: (enabled: boolean) => void;
  inputDisabled?: boolean;
};

// ============================================================================
// Main Component
// ============================================================================

/**
 * AIChatPromptInput - A simplified, self-contained AI chat prompt input component
 * that matches the design specification: pill-shaped input with paperclip button
 * on the left and send button on the right.
 *
 * Features:
 * - Text input with auto-resize
 * - File attachments support
 * - Enter key to submit (Shift+Enter for new line)
 * - Drag & drop file support
 * - Paste file support
 * - Loading/streaming states
 */
export function AIChatPromptInput({
  className,
  accept,
  multiple = true,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  onStop,
  placeholder = "Example prompt text...",
  status,
  textareaRef: externalTextareaRef,
  chatId,
  workspaceId,
  autoFocus,
  autoFocusKey,
  toolsEnabled = false,
  onToolsEnabledChange,
  inputDisabled = false,
  ...props
}: AIChatPromptInputProps) {
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalTextareaRef ?? internalTextareaRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<
    (FileUIPart & { id: string })[]
  >([]);
  const [isComposing, setIsComposing] = useState(false);

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionTriggerPos, setMentionTriggerPos] = useState<number | null>(
    null,
  );

  // Mentions only require workspaceId - chatId is optional (for new chats)
  const mentionsEnabled = Boolean(workspaceId);
  const {
    suggestions,
    isLoading: mentionLoading,
    search: searchMentions,
    clear: clearMentions,
  } = useMentions({
    workspaceId: workspaceId ?? "",
    chatId: chatId,  // Pass as-is, hook handles undefined
    limit: 8,
  });

  // Debounce mention search to reduce API calls
  const mentionSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const debouncedSearchMentions = useCallback(
    (query: string) => {
      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
      }
      mentionSearchTimeoutRef.current = setTimeout(() => {
        searchMentions(query);
      }, 150); // 150ms debounce
    },
    [searchMentions]
  );

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (mentionSearchTimeoutRef.current) {
        clearTimeout(mentionSearchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, autoFocusKey, textareaRef]);

  const detectMentionTrigger = useCallback(
    (value: string, cursorPos: number) => {
      if (!mentionsEnabled) return null;

      const textBeforeCursor = value.slice(0, cursorPos);
      const atIndex = textBeforeCursor.lastIndexOf("@");

      if (atIndex === -1) return null;

      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : " ";
      if (charBeforeAt && !/\s/.test(charBeforeAt)) return null;

      const queryText = textBeforeCursor.slice(atIndex + 1);
      if (/\s/.test(queryText)) return null;

      return { triggerPos: atIndex, query: queryText };
    },
    [mentionsEnabled],
  );

  const handleMentionSelect = useCallback(
    (entity: MentionEntity) => {
      if (mentionTriggerPos === null) return;

      const textarea = textareaRef.current;
      if (!textarea) return;

      const mentionSyntax = `@[${entity.entityType}:${entity.id}|${entity.displayText}] `;
      const before = text.slice(0, mentionTriggerPos);
      const after = text.slice(textarea.selectionStart);
      const newText = before + mentionSyntax + after;

      setText(newText);
      setMentionOpen(false);
      setMentionIndex(0);
      setMentionTriggerPos(null);
      clearMentions();

      requestAnimationFrame(() => {
        const newCursorPos = mentionTriggerPos + mentionSyntax.length;
        textarea.setSelectionRange(newCursorPos, newCursorPos);
        textarea.focus();
      });
    },
    [mentionTriggerPos, text, textareaRef, clearMentions],
  );

  const closeMentionAutocomplete = useCallback(() => {
    // Cancel any pending search
    if (mentionSearchTimeoutRef.current) {
      clearTimeout(mentionSearchTimeoutRef.current);
      mentionSearchTimeoutRef.current = null;
    }
    setMentionOpen(false);
    setMentionIndex(0);
    setMentionTriggerPos(null);
    clearMentions();
  }, [clearMentions]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      const cursorPos = e.target.selectionStart;
      setText(newValue);

      const trigger = detectMentionTrigger(newValue, cursorPos);
      if (trigger) {
        setMentionTriggerPos(trigger.triggerPos);
        setMentionOpen(true);
        setMentionIndex(0);
        debouncedSearchMentions(trigger.query);
      } else if (mentionOpen) {
        closeMentionAutocomplete();
      }
    },
    [
      detectMentionTrigger,
      mentionOpen,
      closeMentionAutocomplete,
      debouncedSearchMentions,
    ],
  );

  useEffect(() => {
    if (!mentionOpen) return;
    setMentionIndex(0);
  }, [suggestions, mentionOpen]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`; // max 192px (12rem)
    };

    resize();
    textarea.addEventListener("input", resize);
    return () => textarea.removeEventListener("input", resize);
  }, [text]);

  // File validation
  const matchesAccept = useCallback(
    (f: File) => {
      if (!accept || accept.trim() === "") {
        return true;
      }
      if (accept.includes("image/*")) {
        return f.type.startsWith("image/");
      }
      return true;
    },
    [accept],
  );

  // Add files
  const addFiles = useCallback(
    (fileList: File[] | FileList) => {
      const incoming = Array.from(fileList);
      const accepted = incoming.filter((f) => matchesAccept(f));

      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return;
      }

      const withinSize = (f: File) =>
        maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);

      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return;
      }

      setAttachments((prev) => {
        const capacity =
          typeof maxFiles === "number"
            ? Math.max(0, maxFiles - prev.length)
            : undefined;
        const capped =
          typeof capacity === "number" ? sized.slice(0, capacity) : sized;

        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added.",
          });
        }

        const next: (FileUIPart & { id: string })[] = [];
        for (const file of capped) {
          next.push({
            id: nanoid(),
            type: "file",
            url: URL.createObjectURL(file),
            mediaType: file.type,
            filename: file.name,
          });
        }
        return prev.concat(next);
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError],
  );

  // Remove attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((f) => f.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((f) => f.id !== id);
    });
  }, []);

  // Clear all attachments
  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const f of prev) {
        if (f.url) {
          URL.revokeObjectURL(f.url);
        }
      }
      return [];
    });
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(
    () => () => {
      for (const f of attachments) {
        if (f.url) URL.revokeObjectURL(f.url);
      }
    },
    [attachments],
  );

  // File input change handler
  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (
    event,
  ) => {
    if (event.currentTarget.files) {
      addFiles(event.currentTarget.files);
      // Reset input to allow selecting same file again
      event.currentTarget.value = "";
    }
  };

  // Convert blob URL to data URL
  const convertBlobUrlToDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Form submit handler
  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();

    if (inputDisabled) {
      return;
    }

    if (!text.trim() && attachments.length === 0) {
      return;
    }

    // Convert blob URLs to data URLs asynchronously
    Promise.all(
      attachments.map(async ({ id, ...item }) => {
        if (item.url && item.url.startsWith("blob:")) {
          return {
            ...item,
            url: await convertBlobUrlToDataUrl(item.url),
          };
        }
        return item;
      }),
    )
      .then((convertedFiles: FileUIPart[]) => {
        try {
          const result = onSubmit(
            { text: text.trim() || undefined, files: convertedFiles },
            event,
          );

          // Handle async completion (errors are swallowed; input stays cleared)
          if (result instanceof Promise) {
            result.catch(() => {
              // Keep cleared; user can type a fresh prompt
            });
          }
        } catch {
          // Swallow to avoid blocking user input
        }
      })
      .finally(() => {
        // Always clear input and revoke blob URLs, even on error
        setText("");
        clearAttachments();
      });
  };

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (mentionOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = suggestions[mentionIndex];
        if (selected) {
          handleMentionSelect(selected);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMentionAutocomplete();
        return;
      }
    }

    if (e.key === "Enter") {
      if (isComposing || e.nativeEvent.isComposing) {
        return;
      }
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();

      const form = e.currentTarget.form;
      const submitButton = form?.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement | null;
      if (!submitButton || submitButton.disabled) {
        return;
      }

      form?.requestSubmit();
    }

    if (
      e.key === "Backspace" &&
      e.currentTarget.value === "" &&
      attachments.length > 0
    ) {
      e.preventDefault();
      const lastAttachment = attachments.at(-1);
      if (lastAttachment) {
        removeAttachment(lastAttachment.id);
      }
    }
  };

  // Paste handler - handles both files and clipboard images
  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const items = event.clipboardData?.items;

    if (!items) {
      return;
    }

    const files: File[] = [];

    // Process all clipboard items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      // Handle file items (including images copied as files or from filesystem)
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(file);
        }
      }
      // Handle image data from clipboard (e.g., screenshots, copied images from browser)
      // Note: getAsFile() only works when item.kind === "file", but we check type
      // as a safety measure for edge cases where clipboard might have image data
      else if (item.type.startsWith("image/")) {
        // Try to get as file - this will only work if it's actually a file item
        const blob = item.getAsFile();
        if (blob) {
          // Determine file extension from MIME type
          const extension = blob.type.split("/")[1] || "png";
          // Create a File object from the blob with a proper name
          const file = new File(
            [blob],
            `pasted-image-${Date.now()}.${extension}`,
            { type: blob.type },
          );
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  // Drag & drop handlers
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };

    const onDrop = (e: DragEvent) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    };

    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [addFiles]);

  // Submit button icon based on status
  const getSubmitIcon = () => {
    if (status === "submitted") {
      return <Loader2Icon className="size-4 animate-spin" />;
    }
    if (status === "streaming") {
      return <SquareIcon className="size-4" />;
    }
    return <ArrowUpIcon className="size-4" />;
  };

  const isStreaming = status === "streaming";
  const isSubmitting = status === "submitted";
  const isInputDisabled = isSubmitting || inputDisabled;
  const isStopAction = isStreaming && typeof onStop === "function";
  const isButtonDisabled =
    isSubmitting || inputDisabled || (isStreaming && !onStop);

  return (
    <form
      ref={formRef}
      className={cn("w-full", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        accept={accept}
        aria-label="Upload files"
        className="hidden"
        multiple={multiple}
        onChange={handleFileChange}
        title="Upload files"
        type="file"
      />

      {/* Main input container - pill-shaped with shadow */}
      <div className="relative w-full rounded-[20px] border border-border bg-surface shadow-lg p-3">
        {/* Image previews row - above buttons and input */}
        {attachments.filter((a) => a.mediaType?.startsWith("image/")).length >
          0 && (
          <div className="block mb-2">
            <div className="flex items-center gap-1.5 px-1">
              {attachments
                .filter((a) => a.mediaType?.startsWith("image/"))
                .map((attachment) => {
                  const filename = attachment.filename || "Image";
                  return (
                    <div
                      key={attachment.id}
                      className="group relative size-20 border-0 shrink-0 overflow-hidden rounded-md"
                    >
                      {attachment.url ? (
                        <img
                          alt={filename}
                          className="size-full object-cover shadow-md"
                          src={attachment.url}
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center">
                          <PaperclipIcon className="size-4 text-muted-foreground" />
                        </div>
                      )}
                      {/* Remove button - appears on hover */}
                      <Button
                        aria-label="Remove image"
                        className="absolute top-1 right-1 size-6 rounded-md p-0 border-0 opacity-0 bg-surface/50 transition-opacity hover:bg-destructive/80 group-hover:opacity-100 cursor-pointer [&_svg]:text-muted-foreground "
                        onClick={(e) => {
                          e.stopPropagation();
                          removeAttachment(attachment.id);
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <XIcon className="text-surface" />
                        <span className="sr-only">Remove</span>
                      </Button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Input row - buttons and textarea */}
        <div className="relative block">
          <div className="flex w-full items-end gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isInputDisabled}
              className=" cursor-pointer flex size-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-transparent text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="Attach files"
            >
              <PaperclipIcon className="size-4" />
            </button>

            <button
              type="button"
              onClick={() => onToolsEnabledChange?.(!toolsEnabled)}
              disabled={isInputDisabled}
              className={cn(
                "cursor-pointer flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                toolsEnabled
                  ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border/60 bg-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground"
              )}
              aria-label={toolsEnabled ? "Disable tools" : "Enable tools"}
              title={toolsEnabled ? "Tools enabled - LLM can call tools" : "Tools disabled - Click to enable"}
              data-testid="tools-toggle-button"
            >
              <WrenchIcon className="size-4" />
            </button>

            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                placeholder={placeholder}
                disabled={isInputDisabled}
                rows={1}
                className="w-full resize-none border-0 bg-transparent py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
              {mentionOpen && (
                <MentionAutocomplete
                  suggestions={suggestions}
                  isLoading={mentionLoading}
                  isOpen={mentionOpen}
                  selectedIndex={mentionIndex}
                  onSelect={handleMentionSelect}
                  onClose={closeMentionAutocomplete}
                  anchorRef={textareaRef as React.RefObject<HTMLElement>}
                />
              )}
            </div>

            {/* Submit button (right) - solid black circular button with white arrow */}
            <button
              type={isStopAction ? "button" : "submit"}
              onClick={
                isStopAction
                  ? (e) => {
                      e.preventDefault();
                      onStop?.();
                    }
                  : undefined
              }
              disabled={
                isButtonDisabled ||
                (!isStreaming && text.trim() === "" && attachments.length === 0)
              }
              className=" cursor-pointer flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-surface transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Send message"
            >
              {getSubmitIcon()}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

// ============================================================================
// Legacy Exports (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use AIChatPromptInput instead. This is kept for backward compatibility.
 * The legacy PromptInput component and its sub-components are still available
 * but will be removed in a future version.
 */
export { AIChatPromptInput as PromptInput };

// Legacy component exports (simplified stubs - full implementation removed for simplicity)
// These are kept as type exports only to prevent breaking changes
export type PromptInputProps = AIChatPromptInputProps;
export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputTextareaProps = HTMLAttributes<HTMLTextAreaElement>;
export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputButtonProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputSubmitProps = HTMLAttributes<HTMLButtonElement> & {
  status?: ChatStatus;
};
export type PromptInputAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart & { id: string };
};
export type PromptInputAttachmentsProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputActionAddAttachmentsProps =
  HTMLAttributes<HTMLButtonElement>;
export type PromptInputActionMenuProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputActionMenuTriggerProps =
  HTMLAttributes<HTMLButtonElement>;
export type PromptInputActionMenuContentProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputActionMenuItemProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputSpeechButtonProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputSelectProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputSelectTriggerProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputSelectContentProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputSelectItemProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputSelectValueProps = HTMLAttributes<HTMLSpanElement>;
export type PromptInputHoverCardProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputHoverCardTriggerProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputHoverCardContentProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputTabsListProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputTabProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputTabLabelProps = HTMLAttributes<HTMLHeadingElement>;
export type PromptInputTabBodyProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputTabItemProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputCommandProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputCommandInputProps = HTMLAttributes<HTMLInputElement>;
export type PromptInputCommandListProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputCommandEmptyProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputCommandGroupProps = HTMLAttributes<HTMLDivElement>;
export type PromptInputCommandItemProps = HTMLAttributes<HTMLButtonElement>;
export type PromptInputCommandSeparatorProps = HTMLAttributes<HTMLHRElement>;

// Stub components for backward compatibility (they do nothing but prevent errors)
export const PromptInputBody = () => null;
export const PromptInputTextarea = () => null;
export const PromptInputHeader = () => null;
export const PromptInputFooter = () => null;
export const PromptInputTools = () => null;
export const PromptInputButton = () => null;
export const PromptInputSubmit = () => null;
export const PromptInputAttachment = () => null;
export const PromptInputAttachments = () => null;
export const PromptInputActionAddAttachments = () => null;
export const PromptInputActionMenu = () => null;
export const PromptInputActionMenuTrigger = () => null;
export const PromptInputActionMenuContent = () => null;
export const PromptInputActionMenuItem = () => null;
export const PromptInputSpeechButton = () => null;
export const PromptInputSelect = () => null;
export const PromptInputSelectTrigger = () => null;
export const PromptInputSelectContent = () => null;
export const PromptInputSelectItem = () => null;
export const PromptInputSelectValue = () => null;
export const PromptInputHoverCard = () => null;
export const PromptInputHoverCardTrigger = () => null;
export const PromptInputHoverCardContent = () => null;
export const PromptInputTabsList = () => null;
export const PromptInputTab = () => null;
export const PromptInputTabLabel = () => null;
export const PromptInputTabBody = () => null;
export const PromptInputTabItem = () => null;
export const PromptInputCommand = () => null;
export const PromptInputCommandInput = () => null;
export const PromptInputCommandList = () => null;
export const PromptInputCommandEmpty = () => null;
export const PromptInputCommandGroup = () => null;
export const PromptInputCommandItem = () => null;
export const PromptInputCommandSeparator = () => null;

// Legacy provider exports (stubs)
export type PromptInputProviderProps = HTMLAttributes<HTMLDivElement>;
export const PromptInputProvider = ({ children }: PromptInputProviderProps) => (
  <>{children}</>
);

// Legacy hooks (stubs)
export const usePromptInputController = () => {
  throw new Error(
    "usePromptInputController is deprecated. Use AIChatPromptInput directly instead.",
  );
};
export const useProviderAttachments = () => {
  throw new Error(
    "useProviderAttachments is deprecated. Use AIChatPromptInput directly instead.",
  );
};
export const usePromptInputAttachments = () => {
  throw new Error(
    "usePromptInputAttachments is deprecated. Use AIChatPromptInput directly instead.",
  );
};
