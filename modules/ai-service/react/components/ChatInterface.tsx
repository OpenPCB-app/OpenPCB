"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageAttachment,
} from "@/components/ai-elements/message";
import {
  AIChatPromptInput,
} from "@/components/ai-elements/prompt-input";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { MessageFooter } from "@/components/MessageFooter";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { ModelLoadingErrorModal } from "@/components/ai/ModelLoadingErrorModal";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { useChatInterface } from "@/hooks/useChatInterface";
import { extractMessageParts } from "@/lib/chat/messages";
import { MessageTextWithMentions } from "@/components/chat/MessageTextWithMentions";
import { ChatHeader } from "@/components/ChatInterface/components";
import type { ChatConfig } from "@/components/ChatInterface/types";

/**
 * Pair tool calls with their corresponding results, handling duplicate toolCallIds
 * via a queue (consume-once) pattern.
 */
function buildToolPairs(
  toolCallParts: ReturnType<typeof extractMessageParts>["toolCallParts"],
  toolResultParts: ReturnType<typeof extractMessageParts>["toolResultParts"],
) {
  const resultsByCallId = new Map<string, typeof toolResultParts>();
  for (const result of toolResultParts) {
    const queue = resultsByCallId.get(result.toolCallId);
    if (queue) {
      queue.push(result);
    } else {
      resultsByCallId.set(result.toolCallId, [result]);
    }
  }

  const pairs = toolCallParts.map((call) => {
    const queue = resultsByCallId.get(call.toolCallId);
    const result = queue?.shift();
    return { call, result };
  });

  const orphans = Array.from(resultsByCallId.values()).flat();
  return { pairs, orphans };
}

function sanitizeErrorMessage(error: string | undefined): string {
  if (!error) return "Model loading failed";
  const sanitized = error
    .replace(/\/Users\/[^\s]+/g, "[path]")
    .replace(/\/home\/[^\s]+/g, "[path]")
    .replace(/C:\\[^\s]+/g, "[path]")
    .replace(/at\s+[\w.]+\s*\([^)]+\)/g, "")
    .replace(/https?:\/\/[^\s]+/g, "[url]")
    .trim();
  return sanitized || "Model loading failed";
}

export interface ChatInterfaceProps {
  config: ChatConfig;
}

/**
 * Pure UI component for rendering an AI chat interface.
 * Accepts a single structured ChatConfig object for maximum reusability.
 * All logic is extracted to hooks and utilities.
 */
export function ChatInterface({ config }: ChatInterfaceProps) {
  const {
    messages = [],
    status,
    modelName,
    className,
    projectContext,
    projectContextError,
    inputRef,
    ui = {},
    features = {},
    context = {},
    behavior = {},
  } = config;

  const { placeholder = "What would you like to know?", emptyState } = ui;
  const { tools, mentions } = features;
  const reasoningConfig = features.reasoning;
  const isReasoningEnabled = reasoningConfig?.enabled ?? true;
  const reasoningDefaultExpanded = reasoningConfig?.defaultExpanded ?? false;
  const {
    autoFocus = true,
    onSubmit,
    onStop,
    onBack,
    onMessageAction,
    onBranchChange,
    onMessageRating: externalOnMessageRating,
    messageRatings: externalMessageRatings,
    modelLoading,
    renderOverrides,
    forkingMessageId,
    messageActions,
    inputDisabled = false,
  } = behavior;

  const { chatId, workspaceId } = context;
  const modelLoadingState = modelLoading?.state ?? null;

  const hasMessages = messages.length > 0;
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);

  const isModelLoadError = modelLoadingState?.status === "error";

  useEffect(() => {
    if (isModelLoadError) {
      setErrorDismissed(false);
    }
  }, [isModelLoadError]);

  useEffect(() => {
    if (!onBack) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.repeat) {
        e.preventDefault();
        onBack();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  const handleRetry = () => {
    setShowErrorModal(false);
    modelLoading?.onRetry?.();
  };

  const handleCancelError = () => {
    setErrorDismissed(true);
    setShowErrorModal(false);
  };

  const chatInterface = useChatInterface({
    messages,
    status,
    onMessageAction,
  });

  const messageRatings = externalMessageRatings ?? chatInterface.messageRatings;
  const handleRatingChange =
    externalOnMessageRating ?? chatInterface.handleRatingChange;
  const previewImage = chatInterface.previewImage;
  const handleImagePreview = chatInterface.handleImagePreview;
  const handleClosePreview = chatInterface.handleClosePreview;
  const createMarkdownComponents =
    renderOverrides?.markdownComponents ?? chatInterface.createMarkdownComponents;

  return (
    <div className={cn("relative flex size-full flex-col", className)}>
      <ChatHeader
        showBack={!!onBack}
        onBack={onBack}
        projectContext={projectContext}
        projectContextError={projectContextError}
        modelName={modelName}
        modelLoadingState={modelLoadingState}
      />

      <Conversation className="flex-1">
        <ConversationContent className="px-6 pb-36 max-w-[900px] mx-auto">
          {!hasMessages ? (
            renderOverrides?.emptyState ? (
              renderOverrides.emptyState()
            ) : (
              <ConversationEmptyState
                title={emptyState?.title ?? "No messages yet"}
                description={emptyState?.description ?? "Start a conversation to see messages here"}
              />
            )
          ) : (
            messages.map((message, index) => {
              const messageId = chatInterface.getMessageId(message, index);
              const rating = messageRatings[messageId] || null;
              const isStreaming = chatInterface.isMessageStreaming(index);
              const isError = message.isError;

              const messageMarkdownComponents = createMarkdownComponents(index);

              const {
                textParts,
                imageParts,
                reasoningParts,
                toolCallParts,
                toolResultParts,
              } = extractMessageParts(message);
              const hasAssistantText = textParts.some((part) => part.text.length > 0);
              const isReasoningStreaming = isStreaming && !hasAssistantText;
              const reasoningDefaultOpen =
                reasoningDefaultExpanded || isReasoningStreaming;
              const hasRenderableContent =
                textParts.some((part) => part.text.trim().length > 0) ||
                imageParts.length > 0 ||
                reasoningParts.some((part) => part.text.trim().length > 0) ||
                toolCallParts.length > 0 ||
                toolResultParts.length > 0 ||
                isError;

              const { pairs: toolPairs, orphans: orphanResults } = buildToolPairs(
                toolCallParts,
                toolResultParts,
              );

              if (
                message.role === "assistant" &&
                !hasRenderableContent &&
                !isStreaming
              ) {
                return null;
              }

              return (
                <Message
                  key={messageId}
                  from={message.role}
                  className={cn(
                    "flex-col",
                    isError &&
                      "border border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-200 rounded-xl p-4 max-w-[85%]",
                  )}
                >
                  {/* Image attachments */}
                  {imageParts.length > 0 && (
                    <div
                      className={cn(
                        "flex flex-wrap gap-2 mb-2",
                        message.role === "user"
                          ? "justify-end"
                          : "justify-start",
                      )}
                    >
                      {imageParts.map((attachment, partIndex) => (
                        <MessageAttachment
                          key={`${messageId}-attachment-${partIndex}`}
                          data={attachment}
                          className="size-24 cursor-pointer"
                          onClick={() =>
                            handleImagePreview({
                              url: attachment.url,
                              name: attachment.filename,
                            })
                          }
                        />
                      ))}
                    </div>
                  )}

                  {/* Reasoning parts (for o1/o3 reasoning models) */}
                  {isReasoningEnabled &&
                    reasoningParts.length > 0 &&
                    message.role === "assistant" && (
                      <div className="mb-3">
                        {reasoningParts.map((part, partIndex) => (
                          <Reasoning
                            key={`${messageId}-reasoning-${partIndex}`}
                            isStreaming={isReasoningStreaming}
                            defaultOpen={reasoningDefaultOpen}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{part.text}</ReasoningContent>
                          </Reasoning>
                        ))}
                      </div>
                    )}

                  {/* Text content */}
                  <MessageContent>
                    {textParts.map((part, partIndex) => (
                      <div
                        key={`${messageId}-${partIndex}`}
                        className="markdown-content max-w-full"
                      >
                        <MessageTextWithMentions
                          text={part.text}
                          isStreaming={isStreaming}
                          markdownComponents={messageMarkdownComponents}
                          onMentionClick={mentions?.onMentionClick}
                        />
                      </div>
                    ))}
                    {toolPairs.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {toolPairs.map(({ call, result }, pairIndex) => (
                          <Tool key={`${messageId}-tool-${call.toolCallId}-${pairIndex}`}>
                            <ToolHeader
                              type="tool-invocation"
                              title={call.toolName}
                              state={
                                result
                                  ? result.isError
                                    ? "output-error"
                                    : "output-available"
                                  : "input-available"
                              }
                            />
                            <ToolContent>
                              <ToolInput input={call.args} />
                              {result && (
                                <ToolOutput
                                  output={result.result}
                                  errorText={
                                    result.isError
                                      ? String(result.result)
                                      : undefined
                                  }
                                />
                              )}
                            </ToolContent>
                          </Tool>
                        ))}
                      </div>
                    )}
                    {orphanResults.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {orphanResults.map((result, orphanIndex) => (
                          <Tool
                            key={`${messageId}-tool-result-${result.toolCallId}-${orphanIndex}`}
                          >
                            <ToolHeader
                              type="tool-invocation"
                              title={result.toolName}
                              state={
                                result.isError ? "output-error" : "output-available"
                              }
                            />
                            <ToolContent>
                              <ToolOutput
                                output={result.result}
                                errorText={
                                  result.isError ? String(result.result) : undefined
                                }
                              />
                            </ToolContent>
                          </Tool>
                        ))}
                      </div>
                    )}
                  </MessageContent>

                  {/* Message footer */}
                  {renderOverrides?.messageFooter ? (
                    renderOverrides.messageFooter({ message, messageId, rating })
                  ) : (
                    <MessageFooter
                      message={message}
                      rating={rating}
                      branchCount={message.branchCount}
                      currentBranchIndex={message.branchIndex}
                      onRatingChange={(newRating) =>
                        handleRatingChange(messageId, newRating)
                      }
                      onBranchChange={onBranchChange}
                      onAction={(action, payload) => {
                        chatInterface.handleMessageAction(
                          messageId,
                          action,
                          message,
                          payload,
                        );
                      }}
                      forkDisabled={
                        status === "streaming" ||
                        status === "submitted" ||
                        Boolean(forkingMessageId) ||
                        Boolean(messageActions?.isBusy)
                      }
                      forkLoading={forkingMessageId === messageId}
                      actionsDisabled={
                        status === "streaming" ||
                        status === "submitted" ||
                        Boolean(forkingMessageId) ||
                        Boolean(messageActions?.isBusy)
                      }
                      actionLoading={
                        messageActions?.activeMessageId === messageId
                          ? messageActions.activeAction ?? null
                          : null
                      }
                    />
                  )}
                </Message>
              );
            })
          )}
        </ConversationContent>
      </Conversation>

      {/* Input area */}
      {onSubmit && (
        <div className="absolute bottom-0 left-0 right-0 z-10 pt-6 pb-4 px-6">
          <div className="mx-auto max-w-xl">
            <AIChatPromptInput
              onSubmit={onSubmit}
              onStop={onStop}
              placeholder={placeholder}
              status={status}
              className="w-full"
              textareaRef={inputRef}
              chatId={chatId}
              workspaceId={workspaceId}
              autoFocus={autoFocus}
              autoFocusKey={chatId}
              toolsEnabled={tools?.enabled}
              onToolsEnabledChange={tools?.onToolsEnabledChange}
              inputDisabled={inputDisabled}
            />
          </div>
        </div>
      )}

      {/* Image preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-label={previewImage.name || "Image preview"}
          onClick={handleClosePreview}
        >
          <img
            src={previewImage.url}
            alt={previewImage.name || "Image"}
            className="max-h-[90vh] max-w-[85vw] rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Model Loading Error Modal */}
      <ModelLoadingErrorModal
        isOpen={(isModelLoadError || showErrorModal) && !errorDismissed}
        modelName={
          modelLoadingState?.modelName || modelName || "Unknown model"
        }
        error={sanitizeErrorMessage(modelLoadingState?.error)}
        onRetry={handleRetry}
        onCancel={handleCancelError}
      />
    </div>
  );
}

export type { ChatConfig, MessageAction, MessageRating } from "@/components/ChatInterface/types";
export default ChatInterface;
