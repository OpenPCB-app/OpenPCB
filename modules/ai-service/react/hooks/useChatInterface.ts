import { useState, useCallback } from "react";
import type { UIMessage, ChatStatus } from "ai";
import type { Components } from "react-markdown";
import { useMessageRating, type MessageRating } from "./useMessageRating";
import { createMarkdownComponents } from "@/lib/chat/markdown";
import { isMessageStreaming, getMessageId } from "@/lib/chat/messages";
import { copyToClipboard } from "@/lib/chat/clipboard";

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

export interface MessageActionPayload {
  content?: string;
}

export type UseChatInterfaceOptions = {
    messages?: UIMessage[];
    status?: ChatStatus;
    onMessageAction?: (
        messageId: string,
        action: MessageAction,
        payload?: MessageActionPayload,
    ) => void;
};

export type UseChatInterfaceReturn = {
    // Image preview state
    previewImage: { url: string; name?: string } | null;
    handleImagePreview: (image: { url: string; name?: string }) => void;
    handleClosePreview: () => void;

    // Message ratings
    messageRatings: Record<string, MessageRating>;
    handleRatingChange: (messageId: string, rating: MessageRating) => void;

    // Message actions
    handleMessageAction: (
        messageId: string,
        action: MessageAction,
        message?: UIMessage,
        payload?: MessageActionPayload,
    ) => void;

    // Utilities
    isMessageStreaming: (messageIndex: number) => boolean;
    getMessageId: (message: UIMessage, index: number) => string;
    createMarkdownComponents: (messageIndex: number) => Components;
};

/**
 * Hook for managing ChatInterface logic
 */
export function useChatInterface(options: UseChatInterfaceOptions = {}): UseChatInterfaceReturn {
    const { messages = [], status, onMessageAction } = options;

    const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);

    const {
        ratings: messageRatings,
        setRating,
        toggleThumbsUp,
        toggleThumbsDown,
    } = useMessageRating();

    // Handle image preview
    const handleImagePreview = useCallback((image: { url: string; name?: string }) => {
        setPreviewImage(image);
    }, []);

    const handleClosePreview = useCallback(() => {
        setPreviewImage(null);
    }, []);

    // Handle rating change
    const handleRatingChange = useCallback(
        (messageId: string, rating: MessageRating) => {
            setRating(messageId, rating);
            if (rating) {
                onMessageAction?.(messageId, rating);
            }
        },
        [setRating, onMessageAction]
    );

    // Handle message actions
    const handleMessageAction = useCallback(
        (
            messageId: string,
            action: MessageAction,
            message?: UIMessage,
            payload?: MessageActionPayload,
        ) => {
            switch (action) {
                case "copy":
                    if (message) {
                        const text = message.parts
                            ?.filter((part) => part.type === "text")
                            .map((part) => part.text)
                            .join("") || "";
                        if (text) {
                            copyToClipboard(text).catch(() => {
                                // Silently fail
                            });
                        }
                    }
                    break;

                case "thumbs-up":
                    toggleThumbsUp(messageId);
                    break;

                case "thumbs-down":
                    toggleThumbsDown(messageId);
                    break;

                case "resend":
                case "regenerate":
                case "fork":
                    // Delegate to parent via onMessageAction (handled in ChatScreen)
                    break;

                default:
                    // For other actions (delete, edit), delegate to parent
                    break;
            }

            onMessageAction?.(messageId, action, payload);
        },
        [toggleThumbsUp, toggleThumbsDown, onMessageAction]
    );

    // Check if message is streaming
    const checkIsMessageStreaming = useCallback(
        (messageIndex: number) => {
            return isMessageStreaming(messageIndex, messages.length, status);
        },
        [messages.length, status]
    );

    // Get message ID
    const getMessageIdForIndex = useCallback(
        (message: UIMessage, index: number) => {
            return getMessageId(message, index);
        },
        []
    );

    // Create markdown components for a specific message
    const createMarkdownComponentsForMessage = useCallback(
        (messageIndex: number): Components => {
            const isStreaming = checkIsMessageStreaming(messageIndex);
            return createMarkdownComponents({ isStreaming });
        },
        [checkIsMessageStreaming]
    );

    return {
        previewImage,
        handleImagePreview,
        handleClosePreview,
        messageRatings,
        handleRatingChange,
        handleMessageAction,
        isMessageStreaming: checkIsMessageStreaming,
        getMessageId: getMessageIdForIndex,
        createMarkdownComponents: createMarkdownComponentsForMessage,
    };
}
