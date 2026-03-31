import { useState, useCallback } from "react";

export type MessageRating = "thumbs-up" | "thumbs-down" | null;

export type UseMessageRatingReturn = {
    ratings: Record<string, MessageRating>;
    getRating: (messageId: string) => MessageRating;
    setRating: (messageId: string, rating: MessageRating) => void;
    toggleThumbsUp: (messageId: string) => void;
    toggleThumbsDown: (messageId: string) => void;
    clearRating: (messageId: string) => void;
    clearAllRatings: () => void;
};

/**
 * Hook for managing message ratings
 */
export function useMessageRating(): UseMessageRatingReturn {
    const [ratings, setRatings] = useState<Record<string, MessageRating>>({});

    const getRating = useCallback((messageId: string): MessageRating => {
        return ratings[messageId] || null;
    }, [ratings]);

    const setRating = useCallback((messageId: string, rating: MessageRating) => {
        setRatings((prev) => ({
            ...prev,
            [messageId]: rating,
        }));
    }, []);

    const toggleThumbsUp = useCallback((messageId: string) => {
        setRatings((prev) => {
            const current = prev[messageId];
            return {
                ...prev,
                [messageId]: current === "thumbs-up" ? null : "thumbs-up",
            };
        });
    }, []);

    const toggleThumbsDown = useCallback((messageId: string) => {
        setRatings((prev) => {
            const current = prev[messageId];
            return {
                ...prev,
                [messageId]: current === "thumbs-down" ? null : "thumbs-down",
            };
        });
    }, []);

    const clearRating = useCallback((messageId: string) => {
        setRatings((prev) => {
            const { [messageId]: _, ...rest } = prev;
            return rest;
        });
    }, []);

    const clearAllRatings = useCallback(() => {
        setRatings({});
    }, []);

    return {
        ratings,
        getRating,
        setRating,
        toggleThumbsUp,
        toggleThumbsDown,
        clearRating,
        clearAllRatings,
    };
}
