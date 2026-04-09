import { useState, useCallback, useEffect, useRef } from "react";
import type { FileUIPart } from "ai";
import {
    validateFiles,
    createFilePreview,
    convertBlobUrlToDataUrl,
    type FileError,
} from "@/lib/chat/files";
import { extractFilesFromClipboard } from "@/lib/chat/clipboard";

export type PromptInputMessage = {
    text?: string;
    files?: FileUIPart[];
};

export type UsePromptInputOptions = {
    accept?: string;
    maxFiles?: number;
    maxFileSize?: number;
    multiple?: boolean;
    onError?: (error: FileError) => void;
    onSubmit: (message: PromptInputMessage) => void | Promise<void>;
};

export type UsePromptInputReturn = {
    // State
    text: string;
    attachments: (FileUIPart & { id: string })[];
    isComposing: boolean;

    // Setters
    setText: (text: string) => void;
    setIsComposing: (composing: boolean) => void;

    // File handlers
    addFiles: (fileList: File[] | FileList) => void;
    removeAttachment: (id: string) => void;
    clearAttachments: () => void;

    // Event handlers
    handleFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;

    // Refs
    setupDragAndDrop: (formElement: HTMLFormElement | null) => void;

    // Auto-resize
    setupAutoResize: (textarea: HTMLTextAreaElement | null) => void;
};

/**
 * Hook for managing prompt input state and logic
 */
export function usePromptInput(options: UsePromptInputOptions): UsePromptInputReturn {
    const {
        accept,
        maxFiles,
        maxFileSize,
        onError,
        onSubmit,
    } = options;

    const [text, setText] = useState("");
    const [attachments, setAttachments] = useState<(FileUIPart & { id: string })[]>([]);
    const [isComposing, setIsComposing] = useState(false);

    const formRef = useRef<HTMLFormElement | null>(null);

    // Add files with validation
    const addFiles = useCallback(
        (fileList: File[] | FileList) => {
            const incoming = Array.from(fileList);
            const { valid, errors } = validateFiles(incoming, {
                accept,
                maxSize: maxFileSize,
                maxFiles: maxFiles ? Math.max(0, maxFiles - attachments.length) : undefined,
            });

            // Report errors
            errors.forEach((error) => onError?.(error));

            // Add valid files
            if (valid.length > 0) {
                const newAttachments = valid.map(createFilePreview);
                setAttachments((prev) => [...prev, ...newAttachments]);
            }
        },
        [accept, maxFileSize, maxFiles, attachments.length, onError]
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
        [attachments]
    );

    // File input change handler
    const handleFileChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            if (event.currentTarget.files) {
                addFiles(event.currentTarget.files);
                event.currentTarget.value = "";
            }
        },
        [addFiles]
    );

    // Form submit handler
    const handleSubmit = useCallback(
        (event: React.FormEvent<HTMLFormElement>) => {
            event.preventDefault();

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
                })
            ).then((convertedFiles: FileUIPart[]) => {
                try {
                    const result = onSubmit({
                        text: text.trim() || undefined,
                        files: convertedFiles,
                    });

                    // Clear input immediately after submission is kicked off
                    setText("");
                    clearAttachments();

                    // Handle async completion (errors are swallowed; input stays cleared)
                    if (result instanceof Promise) {
                        result.catch(() => {
                            // Keep cleared; user can type a fresh prompt
                        });
                    }
                } catch (error) {
                    // Swallow to avoid blocking user input; input already cleared
                }
            });
        },
        [text, attachments, onSubmit, clearAttachments]
    );

    // Keyboard handler
    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter") {
                if (isComposing || event.nativeEvent.isComposing) {
                    return;
                }
                if (event.shiftKey) {
                    return; // Allow Shift+Enter for new line
                }
                event.preventDefault();

                // Check if the submit button is disabled before submitting
                const form = event.currentTarget.form;
                const submitButton = form?.querySelector(
                    'button[type="submit"]'
                ) as HTMLButtonElement | null;
                if (!submitButton || submitButton.disabled) {
                    return;
                }

                form?.requestSubmit();
            }

            // Remove last attachment when Backspace is pressed and textarea is empty
            if (
                event.key === "Backspace" &&
                event.currentTarget.value === "" &&
                attachments.length > 0
            ) {
                event.preventDefault();
                const lastAttachment = attachments.at(-1);
                if (lastAttachment) {
                    removeAttachment(lastAttachment.id);
                }
            }
        },
        [isComposing, attachments, removeAttachment]
    );

    // Paste handler
    const handlePaste = useCallback(
        (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const items = event.clipboardData?.items;
            if (!items) return;

            const files = extractFilesFromClipboard(items);
            if (files.length > 0) {
                event.preventDefault();
                addFiles(files);
            }
        },
        [addFiles]
    );

    // Setup drag and drop
    const setupDragAndDrop = useCallback(
        (formElement: HTMLFormElement | null) => {
            formRef.current = formElement;
            if (!formElement) return;

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

            formElement.addEventListener("dragover", onDragOver);
            formElement.addEventListener("drop", onDrop);

            return () => {
                formElement.removeEventListener("dragover", onDragOver);
                formElement.removeEventListener("drop", onDrop);
            };
        },
        [addFiles]
    );

    // Setup auto-resize
    const setupAutoResize = useCallback((textarea: HTMLTextAreaElement | null) => {
        if (!textarea) return;

        const resize = () => {
            textarea.style.height = "auto";
            textarea.style.height = `${Math.min(textarea.scrollHeight, 192)}px`; // max 192px (12rem)
        };

        resize();
        textarea.addEventListener("input", resize);
        return () => textarea.removeEventListener("input", resize);
    }, []);

    return {
        text,
        attachments,
        isComposing,
        setText,
        setIsComposing,
        addFiles,
        removeAttachment,
        clearAttachments,
        handleFileChange,
        handleSubmit,
        handleKeyDown,
        handlePaste,
        setupDragAndDrop,
        setupAutoResize,
    };
}
