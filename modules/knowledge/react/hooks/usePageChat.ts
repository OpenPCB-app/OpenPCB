import { useState, useCallback, useRef, useEffect } from "react";
import type { FileUIPart } from "ai";
import { createChat, findChatByContext, updateChat } from "@/lib/api/chat-api";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";
import type { Page } from "@modules/knowledge/shared/types";
import { tiptapToHTML } from "@modules/_kit/tiptap-to-html";
import {
  collectEditToolCalls,
  collectEditToolResults,
  isSuccessfulEditToolResult,
  getEditId,
  type EditLifecycleEvent,
  type EditAppliedEvent,
} from "@modules/_kit/edit-lifecycle";

export type { EditLifecycleEvent, EditAppliedEvent };

const MAX_CONTENT_CHARS = 12000;
const MAX_CHUNK_CHARS = 1200;
const MAX_SELECTED_CHUNKS = 6;
const SUMMARY_CHARS = 600;

interface ContentChunk {
  index: number;
  text: string;
}

function extractTargetPageIdFromToolCallArgs(args: unknown): string | null {
  if (!args || typeof args !== "object") {
    return null;
  }

  const record = args as Record<string, unknown>;
  const targetType =
    typeof record.target_type === "string"
      ? record.target_type
      : typeof record.targetType === "string"
        ? record.targetType
        : null;
  const targetId =
    typeof record.target_id === "string"
      ? record.target_id
      : typeof record.targetId === "string"
        ? record.targetId
        : null;

  if (targetType && targetType !== "knowledge.page") {
    return null;
  }

  return targetId && targetId.length > 0 ? targetId : null;
}

function extractTargetPageIdFromToolResult(result: unknown): string | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const record = result as Record<string, unknown>;
  const targetIdCandidates = [
    record.target_id,
    record.targetId,
    record.page_id,
    record.pageId,
  ];

  for (const candidate of targetIdCandidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

/**
 * Options for the usePageChat hook.
 */
export interface UsePageChatOptions {
  /** Currently selected page ID */
  pageId: string | null;
  /** Page data (for building system prompt) */
  page: Page | null;
  /** Active workspace ID */
  workspaceId: string | null;
  /** Callback when a chat is created (to link to page if needed) */
  onChatCreated?: (chatId: string) => Promise<void>;
  /** Callback when an edit tool completes successfully */
  onEditApplied?: (event: EditAppliedEvent) => void;
  /** Callback for all edit lifecycle events (started/completed/failed) */
  onEditLifecycleEvent?: (event: EditLifecycleEvent) => void;
}

/**
 * Return type for the usePageChat hook.
 */
export interface UsePageChatReturn {
  /** The active chat ID */
  chatId: string | null;
  /** Whether chat initialization is in progress */
  isInitializing: boolean;
  /** Currently selected provider ID */
  provider: string;
  /** Currently selected model ID */
  model: string;
  /** Whether tools are currently enabled for this page chat */
  toolsEnabled: boolean;
  /** Toggle tools for this page chat */
  setToolsEnabled: (enabled: boolean) => void;
  /** Current system prompt (built from page content) */
  systemPrompt: string;
  /** Chat messages */
  messages: ReturnType<typeof useStreamChat>["messages"];
  /** Current streaming/connection status */
  status: ReturnType<typeof useStreamChat>["status"];
  /** Model loading state (for Ollama, etc.) */
  modelLoadingState: ReturnType<typeof useStreamChat>["modelLoadingState"];
  /** Submit a new message */
  submitMessage: (params: {
    text: string;
    files?: FileUIPart[];
  }) => Promise<void>;
  /** Abort the current stream */
  abort: () => Promise<void>;
  /** Reset chat state */
  reset: () => void;
}

// ─── System Prompt Helpers ──────────────────────────────────────────────────

function buildPropertiesSection(page: Page): string {
  const props = page.properties_json;
  if (!props || Object.keys(props).length === 0) {
    return "";
  }

  const lines = Object.values(props).map((prop) => {
    const value = formatPropertyValue(prop.value, prop.type);
    return `- ${prop.name}: ${value}`;
  });

  return `\nPROPERTIES:\n${lines.join("\n")}`;
}

function formatPropertyValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return "N/A";

  switch (type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "multi-select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "date":
      try {
        return new Date(value as string).toLocaleDateString();
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}

function splitIntoBlocks(html: string): string[] {
  return html
    .split(/(?=<(?:h[1-6]|p|ul|ol|blockquote|pre|div|hr|table|details)\b)/i)
    .map((block) => block.trim())
    .filter(Boolean);
}

function buildChunks(blocks: string[]): ContentChunk[] {
  const chunks: ContentChunk[] = [];
  let current = "";
  let chunkIndex = 0;

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) {
      chunks.push({ index: chunkIndex++, text: trimmed });
    }
    current = "";
  };

  for (const block of blocks) {
    const candidate = current ? `${current}${block}` : block;
    const isHeading = /^<h[1-6]\b/i.test(block);

    if (candidate.length > MAX_CHUNK_CHARS || (isHeading && current)) {
      flush();
      current = block;
      continue;
    }

    current = candidate;
  }

  flush();
  return chunks;
}

function normalizeQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3)
    .slice(0, 12);
}

function scoreChunk(chunk: ContentChunk, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const lower = chunk.text.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (lower.includes(term)) {
      score += 3;
    }
  }

  const headingBonus = /^<h[1-6]\b/i.test(chunk.text) ? 2 : 0;
  const earlyChunkBias = Math.max(0, 1 - chunk.index * 0.08);
  return score + headingBonus + earlyChunkBias;
}

function selectRelevantChunks(
  chunks: ContentChunk[],
  userQuery: string,
  maxContentChars: number,
): ContentChunk[] {
  const terms = normalizeQueryTerms(userQuery);

  const ranked = [...chunks]
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
    .map((entry) => entry.chunk);

  const pool = terms.length > 0 ? ranked : chunks;
  const selected: ContentChunk[] = [];
  let used = 0;

  for (const chunk of pool) {
    if (selected.length >= MAX_SELECTED_CHUNKS) break;
    if (used + chunk.text.length > maxContentChars) continue;
    selected.push(chunk);
    used += chunk.text.length;
  }

  if (selected.length === 0 && chunks.length > 0) {
    const first = chunks[0];
    if (first) {
      selected.push(first);
    }
  }

  return selected.sort((a, b) => a.index - b.index);
}

function buildContentSection(htmlContent: string, userQuery: string): string {
  if (!htmlContent) {
    return "(Empty page)";
  }

  if (htmlContent.length <= MAX_CONTENT_CHARS) {
    return htmlContent;
  }

  const blocks = splitIntoBlocks(htmlContent);
  const chunks = buildChunks(blocks);
  const selected = selectRelevantChunks(chunks, userQuery, MAX_CONTENT_CHARS);

  const summary = htmlContent.slice(0, SUMMARY_CHARS).trim();
  const summarySuffix = htmlContent.length > SUMMARY_CHARS ? "..." : "";

  const selectedText = selected
    .map((chunk, i) => `[Chunk ${i + 1}]\n${chunk.text}`)
    .join("\n\n");

  const includedChars = selected.reduce((sum, chunk) => sum + chunk.text.length, 0);
  const omittedChars = Math.max(0, htmlContent.length - includedChars);

  return [
    `SUMMARY (truncated preview):\n${summary}${summarySuffix}`,
    `SELECTED CONTEXT CHUNKS (query-aware):\n${selectedText}`,
    `(Additional content omitted: ${omittedChars.toLocaleString()} characters)`,
  ].join("\n\n");
}

function renderPageHTML(page: Page): string {
  const tiptapData = page.content_json?.data;
  if (!tiptapData) {
    return "";
  }
  return tiptapToHTML(tiptapData, {
    excludeImages: true,
    includeStyles: true,
  });
}

/**
 * Build system prompt from page content.
 */
export function buildSystemPrompt(
  page: Page,
  options?: { userQuery?: string },
): string {
  const html = renderPageHTML(page);
  const contentSection = buildContentSection(html, options?.userQuery ?? "");
  const charCount = html.length;
  const isEmpty = charCount === 0;
  const docState = isEmpty ? "EMPTY" : `HAS_CONTENT (${charCount} chars)`;

  const iconSection = page.icon ? `\n- Icon: ${page.icon}` : "";
  const propertiesSection = buildPropertiesSection(page);

  const modeGuidance = isEmpty
    ? "Page is EMPTY — use mode='generate' or mode='replace' to create initial content."
    : "Page has content — use mode='append' to add content, mode='replace' ONLY if user explicitly asks to rewrite everything.";

  return `You are helping the user work with a Knowledge page.

PAGE:
- Title: ${page.title}
- State: ${docState}${iconSection}
${propertiesSection}

CONTENT (HTML format with inline styles):
${contentSection}

FORMATTING CAPABILITIES:
The editor supports rich formatting. When generating or editing content, use HTML with inline styles:

Text styling:
- Color: <span style="color: #dc2626">red text</span>
- Font: <span style="font-family: Georgia">serif text</span>
- Size: <span style="font-size: 24px">large text</span>
- Background: <mark style="background-color: #fef2f2">highlighted</mark>
- Bold: <strong>, Italic: <em>, Underline: <u>, Strike: <s>
- Subscript: <sub>, Superscript: <sup>

Block formatting:
- Alignment: <p style="text-align: center">centered</p>
- Line height: <p style="line-height: 1.5">spaced</p>
- Callout: <div data-callout-type="info">note</div> (types: info, warning, error, success)
- Toggle: <details><summary>Title</summary>Hidden content</details>

Available colors: #dc2626 (red), #ea580c (orange), #ca8a04 (yellow), #16a34a (green), #2563eb (blue), #9333ea (purple)
Available fonts: Default, Arial, Georgia, Times New Roman, Courier New, Verdana, Trebuchet MS, Comic Sans MS, Impact
Available sizes: 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72 px

CRITICAL RULE — MUST FOLLOW:
Make exactly ONE edit_content tool call per user request. NEVER call edit_content twice.
BAD: Two edit_content calls (causes duplicate content)
GOOD: One edit_content call with ALL content combined

TOOL RULES (follow strictly):
1. ${modeGuidance}
2. Use edit_content with content_format="html" for content with rich formatting.
3. Use core.format_content for STYLE-ONLY changes (when text must stay identical).
4. When user asks to "format", "style", "make it look", "change color/font/size" → use core.format_content.
5. When user asks to "write", "add", "rewrite", "edit" → use edit_content.
6. Use knowledge.read_page to fetch full/additional page content when needed before editing.
7. Use knowledge.page_info to understand page state, properties, and hierarchy before editing.
8. By default, tools are scoped to the currently opened page and its descendants.
9. Pages outside that scope are allowed only when explicitly mentioned in the current user turn.
10. Use knowledge.list_child_pages to explore sub-pages within allowed scope.
11. Use knowledge.search_pages to find pages within allowed scope.
12. Use knowledge.create_page to create new child pages within allowed scope.
13. For long content, provide it all in a single edit_content call — never break it into multiple calls.
14. Do not only describe edits when the user asks to modify the page; perform them with edit_content.`;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Hook for managing page-scoped AI chat in the Knowledge module.
 *
 * Features:
 * - One persistent chat thread per page context
 * - Prompt refreshed on every message using latest page content
 * - Tool-enabled editing context for direct page updates
 * - Edit lifecycle tracking (started/completed/failed)
 */
export function usePageChat(options: UsePageChatOptions): UsePageChatReturn {
  const { pageId, page, workspaceId, onChatCreated, onEditApplied, onEditLifecycleEvent } = options;

  const [chatId, setChatId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const [toolsEnabled, setToolsEnabled] = useState(true);

  const activeWorkspaceId = useAppStore((state) => state.activeWorkspaceId);
  const pendingModelSelection = useChatStore(
    (state) => state.pendingModelSelection,
  );

  const streamChat = useStreamChat();
  const {
    loadMessages,
    resetState,
    submitMessage: submitStreamMessage,
    abort: abortStream,
    messages,
  } = streamChat;

  const selectedProvider = pendingModelSelection?.provider ?? "openai";
  const selectedModel =
    pendingModelSelection?.model ?? "gpt-4o-mini-2024-07-18";

  const pageRef = useRef(page);
  const systemPromptRef = useRef(page ? buildSystemPrompt(page) : "");
  const chatIdRef = useRef(chatId);
  const messagesRef = useRef(messages);

  // Edit lifecycle tracking refs
  const hydratedChatsRef = useRef<Set<string>>(new Set());
  const hydrationBarriersByChatRef = useRef<Map<string, Promise<void>>>(new Map());
  const seenToolCallsByChatRef = useRef<Map<string, Set<string>>>(new Map());
  const seenToolResultsByChatRef = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    pageRef.current = page;
    systemPromptRef.current = page ? buildSystemPrompt(page) : "";
  }, [page]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const onChatCreatedRef = useRef(onChatCreated);
  useEffect(() => {
    onChatCreatedRef.current = onChatCreated;
  }, [onChatCreated]);

  const resolveWorkspaceId = useCallback(() => {
    return workspaceId ?? activeWorkspaceId ?? "default-workspace";
  }, [workspaceId, activeWorkspaceId]);

  const syncSystemPrompt = useCallback(
    async (targetChatId: string, prompt: string) => {
      await updateChat(targetChatId, {
        config: {
          systemPrompt: prompt,
          provider: selectedProvider,
          model: selectedModel,
        },
      });
    },
    [selectedProvider, selectedModel],
  );

  const findOrCreatePageChat = useCallback(
    async (initialPrompt: string): Promise<string> => {
      if (!pageId) {
        throw new Error("pageId is required");
      }

      const wsId = resolveWorkspaceId();
      const existing = await findChatByContext({
        workspaceId: wsId,
        category: "knowledge_page",
        contextType: "knowledge_page",
        contextId: pageId,
      });

      if (existing?.id) {
        return existing.id;
      }

      const currentPage = pageRef.current;
      const created = await createChat(
        {
          title: currentPage?.title
            ? `Page: ${currentPage.title}`
            : "Knowledge Page Chat",
          category: "knowledge_page",
          contextRef: {
            type: "knowledge_page",
            id: pageId,
          },
          config: {
            systemPrompt: initialPrompt,
            provider: selectedProvider,
            model: selectedModel,
          },
        },
        wsId,
      );

      if (onChatCreatedRef.current) {
        await onChatCreatedRef.current(created.id);
      }

      return created.id;
    },
    [pageId, resolveWorkspaceId, selectedProvider, selectedModel],
  );

  // Initialize chat for page — with hydration barrier for edit lifecycle
  useEffect(() => {
    let cancelled = false;

    const initializeForPage = async () => {
      if (!pageId) {
        setChatId(null);
        resetState();
        return;
      }

      setIsInitializing(true);
      resetState();

      try {
        const initialPrompt = pageRef.current
          ? buildSystemPrompt(pageRef.current)
          : "";
        const resolvedChatId = await findOrCreatePageChat(initialPrompt);

        if (cancelled) return;

        setChatId(resolvedChatId);
        chatIdRef.current = resolvedChatId;

        // Reset edit lifecycle tracking for new chat
        hydratedChatsRef.current.delete(resolvedChatId);
        seenToolCallsByChatRef.current.set(resolvedChatId, new Set());
        seenToolResultsByChatRef.current.set(resolvedChatId, new Set());

        if (initialPrompt) {
          await syncSystemPrompt(resolvedChatId, initialPrompt);
        }

        if (cancelled) return;

        // Load messages with hydration barrier
        const barrier = loadMessages(resolvedChatId).catch(() => {
          // Keep chat submit resilient even if hydration fails.
        }).finally(() => {
          const baselineMessages = messagesRef.current;
          const baselineCalls = collectEditToolCalls(baselineMessages);
          const baselineResults = collectEditToolResults(baselineMessages);
          const seenCalls = seenToolCallsByChatRef.current.get(resolvedChatId) ?? new Set<string>();
          const seenResults = seenToolResultsByChatRef.current.get(resolvedChatId) ?? new Set<string>();
          for (const call of baselineCalls) {
            seenCalls.add(call.occurrenceKey);
          }
          for (const result of baselineResults) {
            seenResults.add(result.occurrenceKey);
          }
          seenToolCallsByChatRef.current.set(resolvedChatId, seenCalls);
          seenToolResultsByChatRef.current.set(resolvedChatId, seenResults);
          hydratedChatsRef.current.add(resolvedChatId);
        });
        hydrationBarriersByChatRef.current.set(resolvedChatId, barrier);
      } catch (err) {
        console.error("[usePageChat] Failed to initialize page chat:", err);
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    void initializeForPage();

    return () => {
      cancelled = true;
    };
  }, [
    pageId,
    workspaceId,
    activeWorkspaceId,
    findOrCreatePageChat,
    loadMessages,
    resetState,
    syncSystemPrompt,
  ]);

  // Edit lifecycle tracking effect
  useEffect(() => {
    if (!chatId || !pageId) {
      return;
    }

    const seenCalls = seenToolCallsByChatRef.current.get(chatId) ?? new Set<string>();
    seenToolCallsByChatRef.current.set(chatId, seenCalls);
    const seen =
      seenToolResultsByChatRef.current.get(chatId) ?? new Set<string>();
    seenToolResultsByChatRef.current.set(chatId, seen);

    const toolCalls = collectEditToolCalls(messages);
    const toolResults = collectEditToolResults(messages);
    const documentIdByOccurrence = new Map<string, string>();

    if (!hydratedChatsRef.current.has(chatId)) {
      for (const call of toolCalls) {
        seenCalls.add(call.occurrenceKey);
      }
      for (const result of toolResults) {
        seen.add(result.occurrenceKey);
      }
      return;
    }

    for (const call of toolCalls) {
      const targetDocumentId =
        extractTargetPageIdFromToolCallArgs(call.args) ?? pageId;
      documentIdByOccurrence.set(call.occurrenceKey, targetDocumentId);
      if (seenCalls.has(call.occurrenceKey)) {
        continue;
      }
      seenCalls.add(call.occurrenceKey);
      onEditLifecycleEvent?.({
        chatId,
        documentId: targetDocumentId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        status: "started",
      });
    }

    for (const result of toolResults) {
      const targetDocumentId =
        documentIdByOccurrence.get(result.occurrenceKey) ??
        extractTargetPageIdFromToolResult(result.result) ??
        pageId;
      if (seen.has(result.occurrenceKey)) {
        continue;
      }

      seen.add(result.occurrenceKey);
      if (!seenCalls.has(result.occurrenceKey)) {
        seenCalls.add(result.occurrenceKey);
        onEditLifecycleEvent?.({
          chatId,
          documentId: targetDocumentId,
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          status: "started",
        });
      }

      const success = isSuccessfulEditToolResult(result);
      onEditLifecycleEvent?.({
        chatId,
        documentId: targetDocumentId,
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        status: success ? "completed" : "failed",
        editId: getEditId(result.result),
        result: result.result,
      });

      if (!success || !onEditApplied) {
        continue;
      }

      onEditApplied({
        chatId,
        documentId: targetDocumentId,
        toolCallId: result.toolCallId,
        editId: getEditId(result.result),
        result: result.result,
      });
    }
  }, [chatId, pageId, messages, onEditApplied, onEditLifecycleEvent]);

  const submitMessage = useCallback(
    async (params: { text: string; files?: FileUIPart[] }) => {
      if (!pageId) {
        throw new Error("Cannot submit message without a selected page");
      }

      let currentChatId = chatIdRef.current;

      if (!currentChatId) {
        const initialPrompt = pageRef.current
          ? buildSystemPrompt(pageRef.current)
          : "";
        currentChatId = await findOrCreatePageChat(initialPrompt);
        setChatId(currentChatId);
      }

      // Wait for hydration if needed
      const hydrationBarrier = hydrationBarriersByChatRef.current.get(currentChatId);
      if (hydrationBarrier) {
        await hydrationBarrier;
      }

      const currentPage = pageRef.current;
      const promptForTurn = currentPage
        ? buildSystemPrompt(currentPage, { userQuery: params.text })
        : systemPromptRef.current;

      if (promptForTurn) {
        await syncSystemPrompt(currentChatId, promptForTurn);
        systemPromptRef.current = promptForTurn;
      }

      const resolvedWorkspaceId = resolveWorkspaceId();

      await submitStreamMessage({
        chatId: currentChatId,
        provider: selectedProvider,
        model: selectedModel,
        text: params.text,
        files: params.files,
        workspaceId: resolvedWorkspaceId,
        toolChoice: toolsEnabled ? "auto" : "none",
        allowedTools: toolsEnabled
          ? [
              "knowledge.read_page",
              "knowledge.page_info",
              "knowledge.create_page",
              "knowledge.list_child_pages",
              "knowledge.search_pages",
              "edit_content",
              "core.format_content",
            ]
          : undefined,
        activeContext: {
          workspaceId: resolvedWorkspaceId,
          activeTarget: {
            targetType: "knowledge.page",
            targetId: pageId,
          },
        },
      });
    },
    [
      pageId,
      findOrCreatePageChat,
      resolveWorkspaceId,
      selectedProvider,
      selectedModel,
      submitStreamMessage,
      syncSystemPrompt,
      toolsEnabled,
    ],
  );

  const abort = useCallback(async () => {
    await abortStream();
  }, [abortStream]);

  const reset = useCallback(() => {
    setChatId(null);
    resetState();
  }, [resetState]);

  return {
    chatId,
    isInitializing,
    provider: selectedProvider,
    model: selectedModel,
    toolsEnabled,
    setToolsEnabled,
    systemPrompt: systemPromptRef.current,
    messages: streamChat.messages,
    status: streamChat.status,
    modelLoadingState: streamChat.modelLoadingState,
    submitMessage,
    abort,
    reset,
  };
}
