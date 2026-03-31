import { useState, useEffect } from "react";

export type UseReasoningOptions = {
    isStreaming?: boolean;
    defaultOpen?: boolean;
    autoClose?: boolean;
    autoCloseDelay?: number;
};

export type UseReasoningReturn = {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    duration: number | undefined;
    hasAutoClosed: boolean;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

/**
 * Hook for managing reasoning component state
 * Handles auto-open/close behavior and duration tracking
 */
export function useReasoning(options: UseReasoningOptions = {}): UseReasoningReturn {
    const {
        isStreaming = false,
        defaultOpen = true,
        autoClose = true,
        autoCloseDelay = AUTO_CLOSE_DELAY,
    } = options;

    const [isOpen, setIsOpen] = useState(defaultOpen);
    const [duration, setDuration] = useState<number | undefined>(undefined);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    // Track duration when streaming starts and ends
    useEffect(() => {
        if (isStreaming) {
            if (startTime === null) {
                setStartTime(Date.now());
            }
        } else if (startTime !== null) {
            setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S));
            setStartTime(null);
        }
    }, [isStreaming, startTime]);

    // Auto-open when streaming starts
    useEffect(() => {
        if (isStreaming && defaultOpen && !isOpen) {
            setIsOpen(true);
            setHasAutoClosed(false);
        }
    }, [isStreaming, defaultOpen, isOpen]);

    // Auto-close when streaming ends (once only)
    useEffect(() => {
        if (autoClose && defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
            const timer = setTimeout(() => {
                setIsOpen(false);
                setHasAutoClosed(true);
            }, autoCloseDelay);

            return () => clearTimeout(timer);
        }
    }, [isStreaming, isOpen, defaultOpen, autoClose, autoCloseDelay, hasAutoClosed]);

    return {
        isOpen,
        setIsOpen,
        duration,
        hasAutoClosed,
    };
}
