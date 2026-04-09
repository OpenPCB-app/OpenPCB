/**
 * ChatInterface Configuration Type System
 *
 * Replaces the flat 47-prop ChatInterfaceProps with a structured,
 * composable configuration object. All properties are optional to
 * support preset-based configuration with selective overrides.
 */

import type { ChatStatus, UIMessage } from "ai";
import type { MentionReference, ProjectRecord } from "@shared/types";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import type { ModelLoadingState } from "@/stores/model-loading-store";
import type { Components } from "react-markdown";
import type { FormEvent, RefObject, ReactNode } from "react";

// ============================================================================
// Re-exported Action Types
// ============================================================================

/** Actions that can be performed on a message */
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

/** Rating state for a message */
export type MessageRating = "thumbs-up" | "thumbs-down" | null;

// ============================================================================
// Tool Configuration
// ============================================================================

/** Controls how AI tools are configured and constrained for a chat session */
export interface ToolsConfig {
  /** Whether tools are enabled for this chat session */
  enabled?: boolean;

  /** How the model should use tools: auto-decide, always use, or never use */
  toolChoice?: "auto" | "required" | "none";

  /** Whitelist of tool names allowed in this session. Empty = all tools allowed */
  allowedTools?: string[];

  /** Per-tool settings keyed by tool name (e.g., timeout, max iterations) */
  toolSettings?: Record<string, unknown>;

  /** Callback when user toggles the tools-enabled switch */
  onToolsEnabledChange?: (enabled: boolean) => void;
}

// ============================================================================
// Attachment Configuration
// ============================================================================

/** Controls file attachment capabilities for the prompt input */
export interface AttachmentsConfig {
  /** Whether file attachments are enabled */
  enabled?: boolean;

  /** MIME types accepted (e.g., "image/*,.pdf") */
  accept?: string;

  /** Whether multiple files can be attached at once */
  multiple?: boolean;

  /** Maximum number of files per message */
  maxFiles?: number;

  /** Maximum file size in bytes */
  maxFileSize?: number;
}

// ============================================================================
// UI Configuration
// ============================================================================

/** Controls visual presentation and layout of the chat interface */
export interface ChatUIConfig {
  /** Layout mode: full window, embedded in another component, or compact sidebar */
  mode?: "full" | "embedded" | "compact";

  /** Message density: comfortable spacing or compact for embedded contexts */
  density?: "comfortable" | "compact";

  /** Whether to show user/assistant avatars next to messages */
  showAvatars?: boolean;

  /** Whether to show timestamps on messages */
  showTimestamps?: boolean;

  /** Visual style for message bubbles */
  bubbleStyle?: "default" | "minimal" | "bordered";

  /** Additional CSS class applied to the chat container */
  themeClass?: string;

  /** Empty state configuration shown when no messages exist */
  emptyState?: {
    /** Title text for the empty state */
    title?: string;
    /** Description text for the empty state */
    description?: string;
  };

  /** Placeholder text for the input field */
  placeholder?: string;
}

// ============================================================================
// Feature Configuration
// ============================================================================

/** Controls which interactive features are available in the chat */
export interface ChatFeatureConfig {
  /** Tool usage configuration */
  tools?: ToolsConfig;

  /** File attachment configuration */
  attachments?: AttachmentsConfig;

  /** @mention functionality configuration */
  mentions?: {
    /** Whether @mentions are enabled */
    enabled?: boolean;
    /** Callback when a mention chip is clicked in a message */
    onMentionClick?: (mention: MentionReference) => void;
  };

  /** AI reasoning/thought display configuration (for o1/o3 models) */
  reasoning?: {
    /** Whether reasoning blocks are shown */
    enabled?: boolean;
    /** Whether reasoning blocks are expanded by default */
    defaultExpanded?: boolean;
  };

  /** Image preview modal configuration */
  imagePreview?: {
    /** Whether clicking images opens a preview modal */
    enabled?: boolean;
  };
}

// ============================================================================
// Context Configuration
// ============================================================================

/** Provides contextual identifiers that scope the chat session */
export interface ChatContextConfig {
  /** Workspace this chat belongs to */
  workspaceId?: string;

  /** Project this chat is scoped to */
  projectId?: string | null;

  /** Module space this chat is embedded in */
  spaceId?: string | null;

  /** Module identifier for module-specific chats */
  moduleId?: string;

  /** System prompt prepended to all messages */
  systemPrompt?: string;

  /** Chat identifier for persistence and history */
  chatId?: string;

  /** Active editing context sent with messages for context-aware AI responses */
  activeContext?: {
    /** Workspace the user is actively working in */
    workspaceId: string;
    /** Project the user is actively working in */
    projectId?: string;
    /** Currently focused target (e.g., a document or node) */
    activeTarget?: {
      /** Type of target (e.g., "document", "node") */
      targetType: string;
      /** Unique identifier of the target */
      targetId: string;
    };
    /** Current text selection in a TipTap editor */
    selection?: {
      /** Editor type */
      type: "tiptap";
      /** Selection start position */
      from: number;
      /** Selection end position */
      to: number;
      /** The selected text content */
      selectedText?: string;
    };
    /** Optional knowledge-page scope metadata for turn-level tool authorization */
    knowledgeScope?: {
      rootPageId?: string;
      mentionedPageIds?: string[];
      grantMode?: "exact";
      grantLifetime?: "turn";
    };
  };
}

// ============================================================================
// Behavior Configuration
// ============================================================================

/** Controls interactive behavior, callbacks, and render customization */
export interface ChatBehaviorConfig {
  /** Whether the input should auto-focus on mount */
  autoFocus?: boolean;

  /** Called when user submits a message */
  onSubmit?: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;

  /** Called when user clicks the stop/abort button during streaming */
  onStop?: () => void;

  /** Called when user clicks the back button (e.g., exiting project chat) */
  onBack?: () => void;

  /** ID of the message currently being forked (shows loading state) */
  forkingMessageId?: string | null;

  /** Called when user performs an action on a message (copy, delete, etc.) */
  onMessageAction?: (
    messageId: string,
    action: MessageAction,
    payload?: MessageActionPayload,
  ) => void;

  /** Called when branch activation/archive changes visible path */
  onBranchChange?: () => void;

  /** Loading/disabled state for message-level actions */
  messageActions?: {
    activeMessageId?: string | null;
    activeAction?: MessageAction | null;
    isBusy?: boolean;
  };

  /** Called when user rates a message (thumbs up/down) */
  onMessageRating?: (messageId: string, rating: MessageRating) => void;

  /** External message ratings state (for controlled rating display) */
  messageRatings?: Record<string, MessageRating>;

  /** Model loading state and retry handler */
  modelLoading?: {
    /** Current model loading state (loading, ready, error) */
    state?: ModelLoadingState | null;
    /** Called when user clicks retry after a model loading error */
    onRetry?: () => void;
  };

  /** Disable prompt input interactions (typing, submit, attachments, tools toggle) */
  inputDisabled?: boolean;

  /** Render prop overrides for custom rendering of specific sections */
  renderOverrides?: {
    /** Custom message footer renderer (replaces default rating/action bar) */
    messageFooter?: (props: {
      /** The message being rendered */
      message: UIMessage;
      /** Unique identifier of the message */
      messageId: string;
      /** Current rating of the message */
      rating: MessageRating;
    }) => ReactNode;

    /** Custom empty state renderer (replaces default empty state) */
    emptyState?: () => ReactNode;

    /** Custom markdown component overrides per message index */
    markdownComponents?: (messageIndex: number) => Components;
  };
}

// ============================================================================
// Top-Level Chat Configuration
// ============================================================================

/**
 * Unified configuration object for ChatInterface.
 *
 * Replaces the previous 47-prop flat API with a structured, composable
 * configuration. All properties are optional — use presets for common
 * configurations and override individual properties as needed.
 *
 * @example
 * ```tsx
 * <ChatInterface config={{
 *   messages,
 *   status,
 *   modelName: "gpt-4",
 *   ui: { mode: "full", placeholder: "Ask anything..." },
 *   features: { tools: { enabled: true, toolChoice: "auto" } },
 *   context: { workspaceId: "ws-1", chatId: "chat-1" },
 *   behavior: { onSubmit: handleSubmit, onStop: handleStop },
 * }} />
 * ```
 */
export interface ChatConfig {
  /** Chat messages to display */
  messages?: (UIMessage & { isError?: boolean; branchCount?: number; branchIndex?: number })[];

  /** Current streaming/connection status */
  status?: ChatStatus;

  /** Display name of the active model */
  modelName?: string;

  /** Additional CSS class for the root container */
  className?: string;

  /** Project context for project-scoped chats (shows project badge) */
  projectContext?: ProjectRecord | null;

  /** Whether there was an error loading project context */
  projectContextError?: boolean;

  /** Ref to the input textarea for external focus control */
  inputRef?: RefObject<HTMLTextAreaElement>;

  /** Visual and layout configuration */
  ui?: ChatUIConfig;

  /** Feature toggles and configuration */
  features?: ChatFeatureConfig;

  /** Contextual identifiers for the chat session */
  context?: ChatContextConfig;

  /** Callbacks, interaction handlers, and render overrides */
  behavior?: ChatBehaviorConfig;
}
