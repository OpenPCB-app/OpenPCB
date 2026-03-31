/**
 * Content Editor Service
 *
 * Main service for AI-powered content editing.
 * Integrates with TaskOrchestrator pattern for streaming.
 */

import type { DatabaseAccess } from "../../../db";
import type { ProviderRegistry } from "../../../infrastructure/ai-providers/registry";
import type { ContentTarget } from "./content-target.interface";
import type { ContentTargetRegistry } from "./content-target-registry";
import type { ContentEditSnapshotRepository } from "../../../db/repositories/content-edit-snapshot";
import type { ContentEditLockRepository } from "../../../db/repositories/content-edit-lock";
import type {
  EditContentInput,
  EditStreamResult,
  TargetRef,
  ContentSelection,
  ContentContext,
  EditCancellationInfo,
  RegisteredTargetInfo,
} from "./types";
import type { TiptapDocument } from "../../utils/markdown-to-tiptap";
import type { KernelMessage, ProviderId } from "@shared/types";
import type { ChatResult, StreamCallbacks } from "../../../infrastructure/ai-providers/engine";
import { v7 as uuidv7 } from "uuid";

import { generateUUIDv7 } from "../../../db/schema/base";
import type { ContentEditPayload, ContentEditTaskResultData } from "../../../db/schema/task";
import { ValidationError } from "../../../core/errors";
import { nowISO } from "../../../core/utils/time";
import { tiptapToMarkdown } from "../../utils/tiptap-to-markdown";
import {
  TargetLockedError,
  InvalidSelectionError,
  EditNotFoundError,
  RollbackError,
  ProviderError,
  ContentParseError,
} from "./errors";
import {
  buildEditPrompt,
  getRecommendedTemperature,
  getRecommendedMaxTokens,
} from "./prompt-builder";
import { parseEditOutput, OutputAccumulator, validateNotEmpty } from "./output-parser";

/**
 * Content editor configuration
 */
export interface ContentEditorConfig {
  /** Lock TTL in milliseconds (default: 60000) */
  lockTtlMs?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Content Editor Service
 *
 * Provides AI-powered content editing with:
 * - Multiple edit modes (replace, append, selection)
 * - Snapshot-based rollback
 * - Lock-based concurrency control
 * - SSE streaming
 */
export class ContentEditorService {
  private static readonly CONTENT_EDIT_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS content_edit_lock (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  edit_id TEXT NOT NULL,
  acquired_by TEXT,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cel_edit ON content_edit_lock (edit_id);
CREATE INDEX IF NOT EXISTS idx_cel_expires ON content_edit_lock (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cel_target ON content_edit_lock (target_type, target_id);
CREATE TABLE IF NOT EXISTS content_edit_snapshot (
  id TEXT PRIMARY KEY NOT NULL,
  edit_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  content_before TEXT NOT NULL,
  mode TEXT NOT NULL,
  selection_info TEXT,
  instruction TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  content_after TEXT,
  tokens_used TEXT,
  error TEXT,
  workspace_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX IF NOT EXISTS idx_ces_edit ON content_edit_snapshot (edit_id);
CREATE INDEX IF NOT EXISTS idx_ces_target ON content_edit_snapshot (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_ces_status ON content_edit_snapshot (status);
CREATE INDEX IF NOT EXISTS idx_ces_workspace ON content_edit_snapshot (workspace_id);
CREATE INDEX IF NOT EXISTS idx_ces_expires ON content_edit_snapshot (expires_at);
CREATE INDEX IF NOT EXISTS idx_ces_target_status ON content_edit_snapshot (target_type, target_id, status);
`;

  private debug: boolean;
  private lockTtlMs: number;
  private contentEditSchemaReady = false;
  private contentEditSchemaInitPromise: Promise<void> | null = null;
  /** Tracks edit operations per task to prevent duplicate edits on same target */
  private editsByTask = new Map<string, Set<string>>();

  constructor(
    private db: DatabaseAccess,
    private providerRegistry: ProviderRegistry,
    private targetRegistry: ContentTargetRegistry,
    private snapshotRepo: ContentEditSnapshotRepository,
    private lockRepo: ContentEditLockRepository,
    config?: ContentEditorConfig
  ) {
    this.debug = config?.debug ?? false;
    this.lockTtlMs = config?.lockTtlMs ?? 60000;
  }

  /**
   * Start a streaming edit operation
   */
  async editContentStream(input: EditContentInput): Promise<EditStreamResult> {
    // Validate input
    this.validateInput(input);

    // Resolve target
    const target = await this.targetRegistry.resolve(input.target);

    // Validate mode is supported
    if (!target.supportedModes.includes(input.mode)) {
      throw new ValidationError(
        `Target ${input.target.targetType} does not support ${input.mode} mode`
      );
    }

    // Validate selection for selection mode
    if (input.mode === "selection") {
      if (!input.selection) {
        throw new InvalidSelectionError("Selection required for selection mode");
      }
      if (target.validateSelection) {
        const valid = await target.validateSelection(input.target.targetId, input.selection);
        if (!valid) {
          throw new InvalidSelectionError("Invalid selection for target");
        }
      }
    }

    // Generate edit ID
    const editId = generateUUIDv7();

    // Try to acquire lock (selection mode only)
    let lockId: string | undefined;
    if (input.mode === "selection") {
      try {
        const lock = await this.withContentEditSchemaRecovery(
          "selection lock acquisition",
          async () =>
            this.lockRepo.acquireLock(
              input.target.targetType,
              input.target.targetId,
              editId,
              { ttlMs: this.lockTtlMs, acquiredBy: "content-editor-service" }
            )
        );
        lockId = lock.id;
        this.log(`Acquired lock ${lockId} for edit ${editId}`);
      } catch (err) {
        if (err instanceof Error && err.name === "DbConflictError") {
          const existingLock = await this.lockRepo.findLock(
            input.target.targetType,
            input.target.targetId
          );
          throw new TargetLockedError(
            input.target.targetType,
            input.target.targetId,
            existingLock?.editId || "unknown"
          );
        }
        throw err;
      }
    }

    // Get current content for snapshot
    const currentContent = await target.getContent(input.target.targetId);

    // Create snapshot
    const snapshot = await this.withContentEditSchemaRecovery(
      "snapshot initialization",
      async () => {
        const created = await this.snapshotRepo.createSnapshot({
          editId,
          targetType: input.target.targetType,
          targetId: input.target.targetId,
          contentBefore: currentContent,
          mode: input.mode,
          selectionInfo: input.selection
            ? {
                type: input.selection.type,
                from: input.selection.from,
                to: input.selection.to,
                selectedText: input.selection.selectedText,
              }
            : null,
          instruction: input.instruction,
          provider: input.provider,
          model: input.model,
          workspaceId: input.workspaceId,
        });
        await this.snapshotRepo.markActive(editId);
        return created;
      }
    );

    this.log(`Created snapshot ${snapshot.id} for edit ${editId}`);

    // Create task record for tracking
    const taskPayload: ContentEditPayload = {
      editId,
      targetType: input.target.targetType,
      targetId: input.target.targetId,
      mode: input.mode,
      instruction: input.instruction,
      selection: input.selection
        ? {
            from: input.selection.from,
            to: input.selection.to,
            selectedText: input.selection.selectedText,
          }
        : undefined,
    };

    const taskId = await this.createTaskRecord({
      editId,
      provider: input.provider,
      model: input.model,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      payload: taskPayload,
    });

    this.log(`Created task ${taskId} for edit ${editId}`);

    // Get content context for prompt
    const contentContext = await target.getContentContext(
      input.target.targetId,
      input.selection
    );

    // Create the SSE stream
    const stream = this.createEditStream({
      editId,
      taskId,
      target,
      targetRef: input.target,
      input,
      contentContext,
      contentBefore: currentContent,
      lockId,
      snapshotId: snapshot.id,
    });

    return {
      stream,
      editId,
      snapshotId: snapshot.id,
      lockId,
    };
  }

  /**
   * Handle tool calls for content editing
   */
  async handleToolCall(
    toolCall: {
      target_type?: string;
      target_id?: string;
      mode: "replace" | "append" | "selection" | "generate";
      content?: string;
      content_format?: "markdown" | "html";
      instruction?: string;
      selection?: ContentSelection;
      live_stream?: boolean;
    },
    activeContext: {
      workspaceId: string;
      projectId?: string;
      activeTarget?: TargetRef;
      selection?: ContentSelection;
      knowledgeScope?: {
        rootPageId?: string;
        mentionedPageIds?: string[];
        grantMode?: "exact";
        grantLifetime?: "turn";
      };
    },
    chatSpec: { provider: string; model: string; taskId?: string }
  ): Promise<{
    success: boolean;
    message: string;
    editId?: string;
    error?: { code: string; message: string };
  }> {
    const selection = toolCall.selection ?? activeContext.selection;
    const liveStreamRequested = toolCall.live_stream === true;
    const content = typeof toolCall.content === "string" ? toolCall.content : undefined;
    const hasExplicitContent = typeof content === "string" && content.trim().length > 0;
    const useLiveStreamMode = liveStreamRequested && !hasExplicitContent;

    const targetRef: TargetRef | undefined =
      toolCall.target_type && toolCall.target_id
        ? { targetType: toolCall.target_type, targetId: toolCall.target_id }
        : activeContext.activeTarget;

    if (!targetRef) {
      return {
        success: false,
        message: "No target specified and no active context",
        error: { code: "NO_TARGET", message: "Cannot determine edit target" },
      };
    }

    if (!activeContext.workspaceId) {
      return {
        success: false,
        message: "workspaceId required",
        error: { code: "MISSING_WORKSPACE", message: "workspaceId required" },
      };
    }

    let target: ContentTarget;
    try {
      target = await this.targetRegistry.resolve(targetRef);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resolve target";
      return {
        success: false,
        message,
        error: { code: "TARGET_RESOLVE_FAILED", message },
      };
    }

    // Smart generate mode: append to non-empty docs, replace empty ones
    let resolvedMode: "replace" | "append" | "selection" =
      toolCall.mode === "generate" ? "replace" : toolCall.mode;

    if (toolCall.mode === "generate") {
      try {
        const currentContent = await target.getContent(targetRef.targetId);
        const isEmpty = isEmptyTiptapContent(currentContent.content);
        resolvedMode = isEmpty ? "replace" : "append";
      } catch {
        // If getContent fails, fall back to replace (original behavior)
        resolvedMode = "replace";
      }
    }

    // Duplicate edit guardrail: block second edit_content on same target within same task
    if (chatSpec.taskId) {
      const targetKey = `${targetRef.targetType}:${targetRef.targetId}`;
      const taskEdits = this.editsByTask.get(chatSpec.taskId);
      if (taskEdits?.has(targetKey)) {
        return {
          success: false,
          message:
            "Content was already edited in this turn. Only ONE edit_content call per target per request.",
          error: {
            code: "DUPLICATE_EDIT_BLOCKED",
            message:
              "Content was already edited in this turn. Only ONE edit_content call per target per request.",
          },
        };
      }
    }

    if (!target.supportedModes.includes(resolvedMode)) {
      return {
        success: false,
        message: `Target ${targetRef.targetType} does not support ${resolvedMode} mode`,
        error: {
          code: "INVALID_MODE",
          message: `Target ${targetRef.targetType} does not support ${resolvedMode} mode`,
        },
      };
    }

    if (target.getMetadata) {
      try {
        const metadata = await target.getMetadata(targetRef.targetId);
        const targetWorkspaceId =
          typeof metadata.workspaceId === "string" ? metadata.workspaceId : undefined;
        if (targetWorkspaceId && targetWorkspaceId !== activeContext.workspaceId) {
          return {
            success: false,
            message: "Active target belongs to a different workspace",
            error: {
              code: "WORKSPACE_MISMATCH",
              message: "Active target belongs to a different workspace",
            },
          };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to read target metadata";
        return {
          success: false,
          message,
          error: { code: "TARGET_METADATA_FAILED", message },
        };
      }
    }

    const scopeAllowed = await this.isKnowledgeTargetAllowedByScope(
      targetRef,
      target,
      activeContext,
    );
    if (!scopeAllowed) {
      return {
        success: false,
        message: "Requested page is outside the active page scope",
        error: {
          code: "PAGE_ACCESS_DENIED",
          message: "Requested page is outside the active page scope",
        },
      };
    }

    if (liveStreamRequested && hasExplicitContent) {
      this.log(
        "live_stream requested with explicit content; using direct content apply path for compatibility"
      );
    }

    if (useLiveStreamMode) {
      if (targetRef.targetType !== "writer.document") {
        return {
          success: false,
          message: "live_stream is only supported for writer.document targets",
          error: {
            code: "INVALID_LIVE_STREAM_TARGET",
            message: "live_stream is only supported for writer.document targets",
          },
        };
      }

      const instruction = toolCall.instruction?.trim();
      if (!instruction) {
        return {
          success: false,
          message: "instruction required when live_stream is true",
          error: {
            code: "MISSING_INSTRUCTION",
            message: "instruction required when live_stream is true",
          },
        };
      }

      try {
        const streamResult = await this.editContentStream({
          target: targetRef,
          mode: resolvedMode,
          instruction,
          selection,
          provider: chatSpec.provider,
          model: chatSpec.model,
          workspaceId: activeContext.workspaceId,
          projectId: activeContext.projectId,
          contentFormat: toolCall.content_format,
        });

        const streamCompletion = await this.consumeToolEditStream(streamResult.stream);
        if (!streamCompletion.success) {
          return {
            success: false,
            message: streamCompletion.error.message,
            editId: streamResult.editId,
            error: streamCompletion.error,
          };
        }

        // Track successful edit for duplicate guardrail
        if (chatSpec.taskId) {
          this.trackEdit(chatSpec.taskId, targetRef);
        }

        return {
          success: true,
          message:
            resolvedMode === "append"
              ? "Content appended successfully"
              : "Content updated successfully",
          editId: streamResult.editId,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Live edit failed";
        const schemaErrorCode = this.getSchemaUnavailableErrorCode(err);
        const errorCode =
          schemaErrorCode ??
          (err instanceof ValidationError
            ? this.mapLiveValidationErrorCode(errorMessage)
            : "TOOL_CALL_FAILED");
        return {
          success: false,
          message: errorMessage,
          error: { code: errorCode, message: errorMessage },
        };
      }
    }

    if (!hasExplicitContent) {
      return {
        success: false,
        message: "content required unless live_stream is enabled",
        error: {
          code: "MISSING_CONTENT",
          message: "content required unless live_stream is enabled",
        },
      };
    }

    const editId = generateUUIDv7();
    let lockId: string | undefined;
    let snapshotCreated = false;

    try {
      if (resolvedMode === "selection") {
        if (!selection) {
          return {
            success: false,
            message: "Selection required for selection mode",
            error: {
              code: "INVALID_SELECTION",
              message: "Selection required for selection mode",
            },
          };
        }

        if (target.validateSelection) {
          const valid = await target.validateSelection(targetRef.targetId, selection);
          if (!valid) {
            return {
              success: false,
              message: "Invalid selection for target",
              error: { code: "INVALID_SELECTION", message: "Invalid selection for target" },
            };
          }
        }

        try {
          const lock = await this.withContentEditSchemaRecovery(
            "tool-call selection lock acquisition",
            async () =>
              this.lockRepo.acquireLock(
                targetRef.targetType,
                targetRef.targetId,
                editId,
                { ttlMs: this.lockTtlMs, acquiredBy: "content-editor-tool-call" }
              )
          );
          lockId = lock.id;
        } catch (err) {
          if (err instanceof Error && err.name === "DbConflictError") {
            const existingLock = await this.lockRepo.findLock(
              targetRef.targetType,
              targetRef.targetId
            );
            return {
              success: false,
              message: `Target ${targetRef.targetType}:${targetRef.targetId} is locked`,
              error: {
                code: "TARGET_LOCKED",
                message: `Target ${targetRef.targetType}:${targetRef.targetId} is locked by edit ${
                  existingLock?.editId ?? "unknown"
                }`,
              },
            };
          }
          throw err;
        }
      }

      const currentContent = await target.getContent(targetRef.targetId);
      await this.withContentEditSchemaRecovery("tool-call snapshot initialization", async () => {
        await this.snapshotRepo.createSnapshot({
          editId,
          targetType: targetRef.targetType,
          targetId: targetRef.targetId,
          contentBefore: currentContent,
          mode: resolvedMode,
          selectionInfo: selection
            ? {
                type: selection.type,
                from: selection.from,
                to: selection.to,
                selectedText: selection.selectedText,
              }
            : null,
          instruction: toolCall.instruction ?? "AI tool call",
          provider: chatSpec.provider,
          model: chatSpec.model,
          workspaceId: activeContext.workspaceId,
        });
        await this.snapshotRepo.markActive(editId);
      });
      snapshotCreated = true;

      const contentFormat = toolCall.content_format ?? "markdown";
      const parseResult = parseEditOutput(content, contentFormat);
      validateNotEmpty(parseResult);

      if (resolvedMode === "selection" && selection) {
        await target.applySelectionUpdate(targetRef.targetId, selection, parseResult.tiptap);
      } else if (resolvedMode === "append") {
        const merged = this.mergeContent(currentContent, parseResult.tiptap);
        await target.setContent(targetRef.targetId, merged);
      } else {
        await target.setContent(targetRef.targetId, parseResult.tiptap);
      }

      const contentAfter = await target.getContent(targetRef.targetId);
      await this.snapshotRepo.completeEdit(editId, { contentAfter });

      if (lockId) {
        await this.lockRepo.releaseLock(editId);
      }

      // Track successful edit for duplicate guardrail
      if (chatSpec.taskId) {
        this.trackEdit(chatSpec.taskId, targetRef);
      }

      return {
        success: true,
        message: resolvedMode === "append" ? "Content appended successfully" : "Content updated successfully",
        editId,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Edit failed";
      const schemaErrorCode = this.getSchemaUnavailableErrorCode(err);
      const errorCode = schemaErrorCode
        ? schemaErrorCode
        : err instanceof ContentParseError
          ? "CONTENT_PARSE_ERROR"
          : "TOOL_CALL_FAILED";

      if (snapshotCreated) {
        await this.snapshotRepo.failEdit(editId, {
          code: errorCode,
          message: errorMessage,
          timestamp: nowISO(),
        });
      }

      if (lockId) {
        await this.lockRepo.releaseLock(editId);
      }

      return {
        success: false,
        message: errorMessage,
        editId,
        error: { code: errorCode, message: errorMessage },
      };
    }
  }

  private async consumeToolEditStream(stream: ReadableStream<Uint8Array>): Promise<
    | { success: true }
    | { success: false; error: { code: string; message: string } }
  > {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const event = this.parseSseFrame(frame);
          if (!event) {
            continue;
          }

          if (event.name === "error") {
            return {
              success: false,
              error: {
                code:
                  typeof event.payload.code === "string"
                    ? event.payload.code
                    : "STREAM_ERROR",
                message:
                  typeof event.payload.message === "string"
                    ? event.payload.message
                    : "Edit stream failed",
              },
            };
          }

          if (event.name === "cancelled") {
            return {
              success: false,
              error: {
                code: "STREAM_CANCELLED",
                message: "Edit stream cancelled before completion",
              },
            };
          }
        }
      }

      return { success: true };
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseFrame(frame: string): { name: string; payload: Record<string, unknown> } | null {
    const lines = frame
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return null;
    }

    let eventName = "message";
    let rawData = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim() || "message";
      } else if (line.startsWith("data:")) {
        rawData += line.slice("data:".length).trim();
      }
    }

    if (!rawData) {
      return { name: eventName, payload: {} };
    }

    try {
      const parsed = JSON.parse(rawData);
      if (parsed && typeof parsed === "object") {
        return { name: eventName, payload: parsed as Record<string, unknown> };
      }
      return { name: eventName, payload: {} };
    } catch (err) {
      this.log(`Failed to parse SSE payload for event '${eventName}': ${err}`);
      return { name: eventName, payload: {} };
    }
  }

  private mapLiveValidationErrorCode(message: string): string {
    if (message.includes("instruction required")) {
      return "MISSING_INSTRUCTION";
    }
    if (message.includes("workspaceId required")) {
      return "MISSING_WORKSPACE";
    }
    if (message.includes("Selection required")) {
      return "INVALID_SELECTION";
    }
    if (message.includes("does not support")) {
      return "INVALID_MODE";
    }
    return "VALIDATION_ERROR";
  }

  private resolveKnowledgeScope(activeContext: {
    activeTarget?: TargetRef;
    knowledgeScope?: { rootPageId?: string; mentionedPageIds?: string[] };
  }): {
    isScoped: boolean;
    rootPageId: string | null;
    mentionedPageIds: Set<string>;
  } {
    const explicitRoot =
      typeof activeContext.knowledgeScope?.rootPageId === "string" &&
      activeContext.knowledgeScope.rootPageId.length > 0
        ? activeContext.knowledgeScope.rootPageId
        : null;
    const activeRoot =
      activeContext.activeTarget?.targetType === "knowledge.page" &&
      typeof activeContext.activeTarget.targetId === "string" &&
      activeContext.activeTarget.targetId.length > 0
        ? activeContext.activeTarget.targetId
        : null;
    const rootPageId = explicitRoot ?? activeRoot;
    const mentionedPageIds = new Set(
      (activeContext.knowledgeScope?.mentionedPageIds ?? []).filter(
        (pageId): pageId is string =>
          typeof pageId === "string" && pageId.length > 0,
      ),
    );

    return {
      isScoped: rootPageId !== null,
      rootPageId,
      mentionedPageIds,
    };
  }

  private async isKnowledgeTargetAllowedByScope(
    targetRef: TargetRef,
    target: ContentTarget,
    activeContext: {
      activeTarget?: TargetRef;
      knowledgeScope?: { rootPageId?: string; mentionedPageIds?: string[] };
    },
  ): Promise<boolean> {
    if (targetRef.targetType !== "knowledge.page") {
      return true;
    }

    const scope = this.resolveKnowledgeScope(activeContext);
    if (!scope.isScoped) {
      return true;
    }

    if (scope.rootPageId === targetRef.targetId) {
      return true;
    }

    if (scope.mentionedPageIds.has(targetRef.targetId)) {
      return true;
    }

    if (!scope.rootPageId || !target.getMetadata) {
      return false;
    }

    const visited = new Set<string>();
    let currentId: string | null = targetRef.targetId;
    while (currentId) {
      if (visited.has(currentId)) {
        return false;
      }
      visited.add(currentId);

      let metadata: Record<string, unknown>;
      try {
        metadata = await target.getMetadata(currentId);
      } catch {
        return false;
      }

      const parentId =
        typeof metadata.parentId === "string" && metadata.parentId.length > 0
          ? metadata.parentId
          : null;
      if (!parentId) {
        return false;
      }
      if (parentId === scope.rootPageId) {
        return true;
      }

      currentId = parentId;
    }

    return false;
  }

  private getSchemaUnavailableErrorCode(error: unknown): string | null {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && code === "CONTENT_EDIT_SCHEMA_UNAVAILABLE") {
      return code;
    }
    return null;
  }

  /**
   * Rollback an edit to its snapshot
   */
  async rollback(editId: string): Promise<void> {
    // Find snapshot
    const snapshot = await this.snapshotRepo.findByEditId(editId);
    if (!snapshot) {
      throw new EditNotFoundError(editId);
    }

    // Get target
    const target = this.targetRegistry.get(snapshot.targetType);

    // Restore content
    try {
      await target.setContent(
        snapshot.targetId,
        snapshot.contentBefore as TiptapDocument
      );
      this.log(`Rolled back edit ${editId} to snapshot ${snapshot.id}`);
    } catch (err) {
      throw new RollbackError(
        editId,
        err instanceof Error ? err.message : String(err)
      );
    }

    // Mark snapshot as rolled back
    await this.snapshotRepo.markRolledBack(editId);

    // Release lock if held
    await this.lockRepo.releaseLock(editId);
  }

  /**
   * Cancel an in-progress edit
   */
  async cancel(editId: string): Promise<EditCancellationInfo> {
    // Find snapshot
    const snapshot = await this.snapshotRepo.findByEditId(editId);
    if (!snapshot) {
      throw new EditNotFoundError(editId);
    }

    // Get target
    const target = this.targetRegistry.get(snapshot.targetType);

    // Restore original content (rollback)
    await target.setContent(
      snapshot.targetId,
      snapshot.contentBefore as TiptapDocument
    );

    // Mark as rolled back
    await this.snapshotRepo.markRolledBack(editId);

    // Release lock
    await this.lockRepo.releaseLock(editId);

    this.log(`Cancelled and rolled back edit ${editId}`);

    return {
      editId,
      rolledBack: true,
    };
  }

  /**
   * Get list of registered targets
   */
  getRegisteredTargets(): RegisteredTargetInfo[] {
    return this.targetRegistry.listTargets();
  }

  /**
   * Get edit history for a target
   */
  async getEditHistory(
    targetRef: TargetRef,
    limit?: number
  ): Promise<
    Array<{
      editId: string;
      mode: string;
      instruction: string;
      status: string;
      createdAt: Date;
    }>
  > {
    const snapshots = await this.snapshotRepo.findByTarget(
      targetRef.targetType,
      targetRef.targetId,
      { limit }
    );

    return snapshots.map((s) => ({
      editId: s.editId,
      mode: s.mode,
      instruction: s.instruction,
      status: s.status,
      createdAt: s.createdAt,
    }));
  }

  // ─── Private Methods ─────────────────────────────────────────────────────────

  /**
   * Create the SSE edit stream
   */
  private createEditStream(params: {
    editId: string;
    taskId: string;
    target: ContentTarget;
    targetRef: TargetRef;
    input: EditContentInput;
    contentContext: ContentContext;
    contentBefore: TiptapDocument;
    lockId?: string;
    snapshotId: string;
  }): ReadableStream<Uint8Array> {
    const {
      editId,
      taskId,
      target,
      targetRef,
      input,
      contentContext,
      contentBefore,
      lockId,
      snapshotId,
    } = params;
    const self = this;
    const accumulator = new OutputAccumulator();
    let abortController: AbortController | null = null;
    let hasStartedStreaming = false;
    let startedAt: number | null = null;
    let tokenBuffer = "";
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let flushInFlight = false;
    const flushIntervalMs = 1000;

    return new ReadableStream({
      async start(controller) {
        const sendSSE = (event: string, data: Record<string, unknown>) => {
          try {
            const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(new TextEncoder().encode(payload));
          } catch {
            // Stream closed
          }
        };

        const streamContentFormat = input.contentFormat ?? "markdown";

        const applyOutput = async (isFinal: boolean) => {
          const parseResult = accumulator.parse(streamContentFormat);
          validateNotEmpty(parseResult);

          if (input.mode === "selection" && input.selection) {
            await target.applySelectionUpdate(
              targetRef.targetId,
              input.selection,
              parseResult.tiptap
            );
          } else {
            if (input.mode === "append") {
              const merged = self.mergeContent(contentBefore, parseResult.tiptap);
              await target.setContent(targetRef.targetId, merged);
            } else {
              await target.setContent(targetRef.targetId, parseResult.tiptap);
            }
          }

          sendSSE("applied", { appliedAt: Date.now(), final: isFinal });

          return parseResult;
        };

        const flush = async (options?: { force?: boolean; isFinal?: boolean }) => {
          if (flushInFlight) {
            return;
          }

          if (!options?.force && tokenBuffer.length === 0) {
            return;
          }

          flushInFlight = true;
          const isFinal = options?.isFinal ?? false;
          const buffered = tokenBuffer;
          tokenBuffer = "";
          let parseResult: ReturnType<OutputAccumulator["parse"]> | undefined;

          try {
            if (buffered.length > 0) {
              sendSSE("token", { delta: buffered });
            }

            if (buffered.length > 0 || options?.force) {
              parseResult = await applyOutput(isFinal);
            }
          } catch (err) {
            if (isFinal) {
              throw err;
            }
          } finally {
            flushInFlight = false;
          }

          return parseResult;
        };

        try {
          // Update task to running
          await self.updateTaskStatus(taskId, "running");
          startedAt = Date.now();

          // Send start event
          sendSSE("start", {
            editId,
            taskId,
            targetRef,
            mode: input.mode,
            snapshotId,
            lockId,
          });

          // Get provider engine
          const engine = await self.providerRegistry.get(
            input.provider as ProviderId
          );
          if (!engine) {
            throw new ProviderError(
              input.provider,
              input.model,
              "Provider not available"
            );
          }

          // Build prompt
          const prompt = buildEditPrompt({
            mode: input.mode,
            instruction: input.instruction,
            context: contentContext,
            selection: input.selection,
            customSystemPrompt: input.systemPrompt,
            contentFormat: streamContentFormat,
          });

          // Build messages in KernelMessage format
          const messages: KernelMessage[] = [
            {
              id: uuidv7(),
              role: "user",
              parts: [{ type: "text", text: prompt.userPrompt }],
              createdAt: new Date().toISOString(),
            },
          ];

          // Prepare request
          const temperature =
            input.temperature ?? getRecommendedTemperature(input.mode);
          const maxTokens =
            input.maxTokens ??
            getRecommendedMaxTokens(input.mode, input.selection?.selectedText?.length);

          abortController = new AbortController();

          // Stream from provider
          const callbacks: StreamCallbacks = {
            onToken: async (token: string) => {
              // Update to streaming on first token
              if (!hasStartedStreaming) {
                hasStartedStreaming = true;
                await self.updateTaskStatus(taskId, "streaming");
                if (!flushTimer) {
                  flushTimer = setInterval(() => {
                    void flush();
                  }, flushIntervalMs);
                }
              }
              accumulator.addChunk(token);
              tokenBuffer += token;
            },
            onComplete: async (chatResult: ChatResult) => {
                try {
                  if (flushTimer) {
                    clearInterval(flushTimer);
                    flushTimer = null;
                  }

                  const parseResult = await flush({ force: true, isFinal: true });
                  if (!parseResult) {
                    throw new ContentParseError("Missing parsed output");
                  }

                  // Complete snapshot
                  const contentAfter = await target.getContent(targetRef.targetId);
                  const tokensUsed = chatResult.usage
                    ? {
                        prompt: chatResult.usage.promptTokens,
                        completion: chatResult.usage.completionTokens,
                        total: chatResult.usage.totalTokens,
                      }
                    : undefined;
                  await self.snapshotRepo.completeEdit(editId, {
                    contentAfter,
                    tokensUsed,
                  });

                  // Release lock
                  if (lockId) {
                    await self.lockRepo.releaseLock(editId);
                  }

                  // Update task to completed
                  const taskResult: ContentEditTaskResultData = {
                    success: true,
                    data: {
                      editId,
                      contentApplied: true,
                      markdownOutput: parseResult.markdown,
                    },
                    tokensUsed,
                    duration: Date.now() - (startedAt ?? Date.now()),
                    finishReason: self.mapFinishReason(chatResult.finishReason),
                  };
                  await self.updateTaskStatus(taskId, "completed", taskResult);

                  sendSSE("done", {
                    editId,
                    contentAfter: tiptapToMarkdown(contentAfter),
                    selectionAfter:
                      input.mode === "selection" ? parseResult.markdown : undefined,
                    tokensUsed,
                  });

                  controller.close();
                } catch (err) {
                  // Update task to failed
                  await self.updateTaskStatus(taskId, "failed", undefined, {
                    code: "APPLY_ERROR",
                    message: err instanceof Error ? err.message : "Failed to apply edit",
                  });

                  sendSSE("error", {
                    code: "APPLY_ERROR",
                    message:
                      err instanceof Error ? err.message : "Failed to apply edit",
                    retryable: false,
                  });

                  // Record error
                  await self.snapshotRepo.failEdit(editId, {
                    code: "APPLY_ERROR",
                    message:
                      err instanceof Error ? err.message : String(err),
                    timestamp: nowISO(),
                  });

                  // Release lock
                  if (lockId) {
                    await self.lockRepo.releaseLock(editId);
                  }

                  controller.close();
                }
              },
            onError: async (error: Error) => {
                if (flushTimer) {
                  clearInterval(flushTimer);
                  flushTimer = null;
                }
                // Update task to failed
                await self.updateTaskStatus(taskId, "failed", undefined, {
                  code: "STREAM_ERROR",
                  message: error.message,
                });

                sendSSE("error", {
                  code: "STREAM_ERROR",
                  message: error.message,
                  retryable: false,
                });

                await self.snapshotRepo.failEdit(editId, {
                  code: "STREAM_ERROR",
                  message: error.message,
                  timestamp: nowISO(),
                });

                if (lockId) {
                  await self.lockRepo.releaseLock(editId);
                }

                controller.close();
              },
            onAbort: async (partial: { text: string; reasoningText?: string }) => {
                if (flushTimer) {
                  clearInterval(flushTimer);
                  flushTimer = null;
                }
                // Update task to cancelled
                await self.updateTaskStatus(taskId, "cancelled");

                await self.snapshotRepo.markRolledBack(editId);

                sendSSE("cancelled", {
                  rolledBack: true,
                  partialContent: partial.text,
                });

                if (lockId) {
                  await self.lockRepo.releaseLock(editId);
                }

                controller.close();
              },
          };

          await engine.stream(
            {
              taskId: editId,
              model: input.model,
              messages,
              systemPrompt: prompt.systemPrompt,
              temperature,
              maxTokens,
              signal: abortController.signal,
            },
            callbacks
          );
        } catch (err) {
          self.log(`Edit stream error: ${err}`);

          const errorCode = err instanceof ContentParseError ? "PARSE_ERROR" : "UNKNOWN_ERROR";
          const errorMessage = err instanceof Error ? err.message : String(err);

          // Update task to failed
          await self.updateTaskStatus(taskId, "failed", undefined, {
            code: errorCode,
            message: errorMessage,
          });

          sendSSE("error", {
            code: errorCode,
            message: errorMessage,
            retryable: false,
          });

          // Record error
          await self.snapshotRepo.failEdit(editId, {
            code: "STREAM_ERROR",
            message: errorMessage,
            timestamp: nowISO(),
          });

          // Release lock
          if (lockId) {
            await self.lockRepo.releaseLock(editId);
          }

          controller.close();
        }
      },

      cancel() {
        // Abort the provider request
        if (abortController) {
          abortController.abort();
        }

        if (flushTimer) {
          clearInterval(flushTimer);
          flushTimer = null;
        }
      },
    });
  }

  /**
   * Merge two Tiptap documents (for append mode)
   */
  private mergeContent(
    existing: TiptapDocument,
    toAppend: TiptapDocument
  ): TiptapDocument {
    return {
      type: "doc",
      content: [...(existing.content || []), ...(toAppend.content || [])],
    };
  }

  /**
   * Validate edit input
   */
  private validateInput(input: EditContentInput): void {
    if (!input.target?.targetType || !input.target?.targetId) {
      throw new ValidationError("target.targetType and target.targetId required");
    }
    if (!input.mode) {
      throw new ValidationError("mode required");
    }
    if (!input.instruction) {
      throw new ValidationError("instruction required");
    }
    if (!input.provider) {
      throw new ValidationError("provider required");
    }
    if (!input.model) {
      throw new ValidationError("model required");
    }
    if (!input.workspaceId) {
      throw new ValidationError("workspaceId required");
    }
  }

  /**
   * Create a task record for tracking the edit operation
   */
  private async createTaskRecord(params: {
    editId: string;
    provider: string;
    model: string;
    workspaceId: string;
    projectId?: string;
    payload: ContentEditPayload;
  }): Promise<string> {
    const taskId = generateUUIDv7();

    await this.db.tasks.create({
      id: taskId,
      type: "content_edit",
      status: "pending",
      priority: 5,
      provider: params.provider,
      model: params.model,
      payload: params.payload,
      workspaceId: params.workspaceId,
      projectId: params.projectId ?? null,
    });

    return taskId;
  }

  /**
   * Update task status during edit lifecycle
   */
  private async updateTaskStatus(
    taskId: string,
    status: "running" | "streaming" | "completed" | "failed" | "cancelled",
    result?: ContentEditTaskResultData,
    error?: { code: string; message: string }
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (status === "running" || status === "streaming") {
      updates.startedAt = new Date();
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = new Date();
    }

    if (result) {
      updates.result = result;
    }

    if (error) {
      updates.error = {
        type: "fatal",
        code: error.code,
        message: error.message,
        retryable: false,
        timestamp: nowISO(),
      };
    }

    await this.db.tasks.update(taskId, updates);
  }

  private log(message: string): void {
    if (this.debug) {
      console.log(`[ContentEditorService] ${message}`);
    }
  }

  private async withContentEditSchemaRecovery<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.isMissingContentEditSchemaError(error)) {
        throw error;
      }

      console.warn(
        `[ContentEditorService] Missing content-edit schema detected during ${operationName}; attempting runtime repair`
      );

      try {
        await this.ensureContentEditSchemaReady(true);
      } catch (repairError) {
        throw this.createSchemaUnavailableError(operationName, repairError);
      }

      try {
        return await operation();
      } catch (retryError) {
        if (this.isMissingContentEditSchemaError(retryError)) {
          throw this.createSchemaUnavailableError(operationName, retryError);
        }
        throw retryError;
      }
    }
  }

  private async ensureContentEditSchemaReady(force = false): Promise<void> {
    if (!force && this.contentEditSchemaReady) {
      return;
    }

    if (this.contentEditSchemaInitPromise) {
      return this.contentEditSchemaInitPromise;
    }

    const initPromise = (async () => {
      this.db.getRawDb().exec(ContentEditorService.CONTENT_EDIT_SCHEMA_DDL);
      this.contentEditSchemaReady = true;
      console.info("[ContentEditorService] Content-edit schema repair completed");
    })();

    this.contentEditSchemaInitPromise = initPromise.finally(() => {
      this.contentEditSchemaInitPromise = null;
    });

    return this.contentEditSchemaInitPromise;
  }

  private isMissingContentEditSchemaError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return (
      message.includes("no such table: content_edit_snapshot") ||
      message.includes("no such table: content_edit_lock")
    );
  }

  private createSchemaUnavailableError(operationName: string, cause: unknown): Error & { code: string } {
    const message =
      cause instanceof Error
        ? cause.message
        : "Unable to initialize content edit schema";
    const error = new Error(
      `Content edit schema unavailable during ${operationName}: ${message}`,
      { cause }
    ) as Error & { code: string };
    error.code = "CONTENT_EDIT_SCHEMA_UNAVAILABLE";
    return error;
  }

  private trackEdit(taskId: string, targetRef: TargetRef): void {
    const targetKey = `${targetRef.targetType}:${targetRef.targetId}`;
    let set = this.editsByTask.get(taskId);
    if (!set) {
      set = new Set();
      this.editsByTask.set(taskId, set);
    }
    set.add(targetKey);
  }

  /** Clear edit tracking for a completed task */
  clearTaskEdits(taskId: string): void {
    this.editsByTask.delete(taskId);
  }

  private mapFinishReason(
    reason: ChatResult["finishReason"]
  ): ContentEditTaskResultData["finishReason"] {
    switch (reason) {
      case "stop":
      case "length":
      case "error":
        return reason;
      case "content_filter":
      case "tool_calls":
        return "stop";
      default:
        return undefined;
    }
  }
}

/**
 * Check if a TipTap content array represents an empty document.
 * Handles: undefined, null, [], [{ type: "paragraph" }], [{ type: "paragraph", content: [] }]
 */
export function isEmptyTiptapContent(content: unknown): boolean {
  if (!content || !Array.isArray(content) || content.length === 0) return true;
  if (content.length > 1) return false;
  const first = content[0] as { type?: string; content?: unknown[] } | undefined;
  if (first?.type !== "paragraph") return false;
  return !first.content || first.content.length === 0;
}
