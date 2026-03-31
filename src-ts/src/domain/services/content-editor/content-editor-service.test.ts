import { describe, expect, test, mock } from "bun:test";

import type { DatabaseAccess } from "../../../db";
import type { ContentEditLockRepository } from "../../../db/repositories/content-edit-lock";
import type { ContentEditSnapshotRepository } from "../../../db/repositories/content-edit-snapshot";
import type { KernelProviderEngine, ChatResult } from "../../../infrastructure/ai-providers/engine";
import type { ProviderRegistry } from "../../../infrastructure/ai-providers/registry";
import type { ContentContext } from "./types";
import type { TiptapDocument } from "../../utils/markdown-to-tiptap";
import type { ContentTarget } from "./content-target.interface";
import type { ContentTargetRegistry } from "./content-target-registry";
import { ContentEditorService, isEmptyTiptapContent } from "./content-editor-service";
import { extractText } from "./output-parser";

describe("ContentEditorService", () => {
  test("generate mode applies content and completes the task", async () => {
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Original" },
          ],
        },
      ],
    };

    let currentDoc: TiptapDocument = initialDoc;
    const setContentCalls: TiptapDocument[] = [];
    let resolveSetContent: (() => void) | null = null;
    const setContentPromise = new Promise<void>((resolve) => {
      resolveSetContent = resolve;
    });

    const target: ContentTarget = {
      targetType: "knowledge.page",
      label: "Knowledge Page",
      description: "Test target",
      supportedModes: ["replace", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () => ({
        fullContent: currentDoc,
        contentMarkdown: "Original",
      }) as ContentContext,
      setContent: async (_id, content) => {
        currentDoc = content;
        setContentCalls.push(content);
        resolveSetContent?.();
      },
      applySelectionUpdate: async () => {},
    };

    const chatResult: ChatResult = {
      text: "Generated content",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    };

    const providerEngine: KernelProviderEngine = {
      providerId: "test-provider",
      name: "test",
      requiresApiKey: false,
      initialize: async () => {},
      checkStatus: async () => ({
        available: true,
        message: "ok",
        checkedAt: new Date().toISOString(),
      }),
      listModels: async () => [],
      getModel: () => undefined,
      chat: async () => ({ text: "chat", finishReason: "stop" }),
      stream: async (_request, callbacks) => {
        await callbacks.onToken?.("Generated content");
        await callbacks.onComplete?.(chatResult);
        return chatResult;
      },
      abort: () => {},
      dispose: () => {},
      isModelLoaded: async () => true,
      getLoadedModels: async () => [],
      preloadModel: async () => true,
      defaultBaseURL: undefined,
    };

    const providerRegistry = {
      get: async () => providerEngine,
    } as unknown as ProviderRegistry;

    const targetRegistry = {
      resolve: async () => target,
    } as unknown as ContentTargetRegistry;

    let resolveCompleted: (() => void) | null = null;
    const completedPromise = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const statusUpdates: Array<{ status: string; result?: unknown; error?: unknown }> = [];

    const dbStub = {
      tasks: {
        create: async () => {},
      update: async (_id, updates) => {
        statusUpdates.push({
          status: updates.status,
          result: updates.result,
          error: updates.error,
        });
        if (updates.status === "completed") {
          resolveCompleted?.();
        }
      },
      },
    } as unknown as DatabaseAccess;

    const snapshotRepo = {
      createSnapshot: async () => ({
        id: "snapshot",
        editId: "edit",
        targetType: "knowledge.page",
        targetId: "page-1",
        contentBefore: initialDoc,
        mode: "generate",
        selectionInfo: null,
        instruction: "",
        provider: "test-provider",
        model: "test-model",
        workspaceId: "workspace",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as unknown,
      markActive: async () => {},
      completeEdit: async () => {},
      failEdit: async () => {},
      markRolledBack: async () => {},
    } as unknown as ContentEditSnapshotRepository;

    const lockRepo = {
      acquireLock: async () => ({ id: "lock" }),
      releaseLock: async () => {},
    } as unknown as ContentEditLockRepository;

    const service = new ContentEditorService(
      dbStub,
      providerRegistry,
      targetRegistry,
      snapshotRepo,
      lockRepo,
    );

    await service.editContentStream({
      target: { targetType: "knowledge.page", targetId: "page-1" },
      mode: "generate",
      instruction: "Regenerate",
      provider: "test-provider",
      model: "test-model",
      workspaceId: "workspace-1",
      systemPrompt: "custom-prompt",
    });

    await Promise.all([setContentPromise, completedPromise]);

    expect(setContentCalls).toHaveLength(1);
    expect(extractText(setContentCalls[0])).toBe("Generated content");
    expect(statusUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "completed",
          result: expect.objectContaining({
            data: expect.objectContaining({
              contentApplied: true,
            }),
          }),
        }),
      ]),
    );
  });

  test("handleToolCall streams writer live edits and returns editId", async () => {
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Original live content" }],
        },
      ],
    };

    let currentDoc: TiptapDocument = initialDoc;
    const setContentCalls: TiptapDocument[] = [];
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
      setContentCalls.push(content);
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace", "append", "selection", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({
          fullContent: currentDoc,
          contentMarkdown: "Original live content",
        }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const chatResult: ChatResult = {
      text: "Live rewritten content",
      finishReason: "stop",
      usage: { promptTokens: 5, completionTokens: 4, totalTokens: 9 },
    };

    const providerEngine: KernelProviderEngine = {
      providerId: "test-provider",
      name: "test",
      requiresApiKey: false,
      initialize: async () => {},
      checkStatus: async () => ({
        available: true,
        message: "ok",
        checkedAt: new Date().toISOString(),
      }),
      listModels: async () => [],
      getModel: () => undefined,
      chat: async () => ({ text: "chat", finishReason: "stop" }),
      stream: async (_request, callbacks) => {
        await callbacks.onToken?.("Live rewritten content");
        await callbacks.onComplete?.(chatResult);
        return chatResult;
      },
      abort: () => {},
      dispose: () => {},
      isModelLoaded: async () => true,
      getLoadedModels: async () => [],
      preloadModel: async () => true,
      defaultBaseURL: undefined,
    };

    const providerRegistry = {
      get: async () => providerEngine,
    } as unknown as ProviderRegistry;

    const targetRegistry = {
      resolve: async () => target,
    } as unknown as ContentTargetRegistry;

    const dbStub = {
      tasks: {
        create: async () => {},
        update: async () => {},
      },
    } as unknown as DatabaseAccess;

    const snapshotRepo = {
      createSnapshot: async () => ({
        id: "snapshot",
        editId: "edit",
        targetType: "writer.document",
        targetId: "doc-1",
        contentBefore: initialDoc,
        mode: "replace",
        selectionInfo: null,
        instruction: "Rewrite",
        provider: "test-provider",
        model: "test-model",
        workspaceId: "ws-1",
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as unknown,
      markActive: async () => {},
      completeEdit: async () => {},
      failEdit: async () => {},
      markRolledBack: async () => {},
    } as unknown as ContentEditSnapshotRepository;

    const lockRepo = {
      acquireLock: async () => ({ id: "lock" }),
      releaseLock: async () => {},
      findLock: async () => null,
    } as unknown as ContentEditLockRepository;

    const service = new ContentEditorService(
      dbStub,
      providerRegistry,
      targetRegistry,
      snapshotRepo,
      lockRepo,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        instruction: "Rewrite to active voice",
        live_stream: true,
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result.success).toBe(true);
    expect(result.editId).toBeTruthy();
    expect(setContentCalls.length).toBeGreaterThan(0);
    expect(extractText(currentDoc)).toContain("Live rewritten content");
  });

  test("handleToolCall uses direct content apply when live_stream is true and content is provided", async () => {
    const initialDoc: TiptapDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Original text" }],
        },
      ],
    };

    let currentDoc: TiptapDocument = initialDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });
    const providerGet = mock(async () => undefined);

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({
          fullContent: currentDoc,
          contentMarkdown: "Original text",
        }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: {
          create: async () => {},
          update: async () => {},
        },
      } as unknown as DatabaseAccess,
      {
        get: providerGet,
      } as unknown as ProviderRegistry,
      {
        resolve: async () => target,
      } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({
          id: "snapshot",
          editId: "edit",
          targetType: "writer.document",
          targetId: "doc-1",
          contentBefore: initialDoc,
          mode: "replace",
          selectionInfo: null,
          instruction: "Apply explicit content",
          provider: "test-provider",
          model: "test-model",
          workspaceId: "ws-1",
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as unknown,
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "lock" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        live_stream: true,
        instruction: "Apply explicit content",
        content: "A short poem\n\nMorning light on quiet stone.",
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result.success).toBe(true);
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(providerGet).toHaveBeenCalledTimes(0);
    expect(extractText(currentDoc)).toContain("Morning light on quiet stone.");
  });

  test("handleToolCall live mode requires instruction", async () => {
    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace"],
      exists: async () => true,
      getContent: async () => ({ type: "doc", content: [{ type: "paragraph" }] }),
      getContentContext: async () =>
        ({
          fullContent: { type: "doc", content: [{ type: "paragraph" }] },
          contentMarkdown: "",
        }) as ContentContext,
      setContent: async () => {},
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: {
          create: async () => {},
          update: async () => {},
        },
      } as unknown as DatabaseAccess,
      {
        get: async () => undefined,
      } as unknown as ProviderRegistry,
      {
        resolve: async () => target,
      } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({} as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "lock" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        live_stream: true,
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result).toEqual({
      success: false,
      message: "instruction required when live_stream is true",
      error: {
        code: "MISSING_INSTRUCTION",
        message: "instruction required when live_stream is true",
      },
    });
  });

  test("handleToolCall blocks writes on workspace mismatch", async () => {
    const setContent = mock(async () => {});
    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace"],
      exists: async () => true,
      getContent: async () => ({ type: "doc", content: [{ type: "paragraph" }] }),
      getContentContext: async () =>
        ({
          fullContent: { type: "doc", content: [{ type: "paragraph" }] },
          contentMarkdown: "",
        }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-2" }),
    };

    const service = new ContentEditorService(
      {
        tasks: {
          create: async () => {},
          update: async () => {},
        },
      } as unknown as DatabaseAccess,
      {
        get: async () => undefined,
      } as unknown as ProviderRegistry,
      {
        resolve: async () => target,
      } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({} as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "lock" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        content: "Updated content",
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result).toEqual({
      success: false,
      message: "Active target belongs to a different workspace",
      error: {
        code: "WORKSPACE_MISMATCH",
        message: "Active target belongs to a different workspace",
      },
    });
    expect(setContent).not.toHaveBeenCalled();
  });

  test("handleToolCall repairs missing snapshot table and retries once", async () => {
    let currentDoc: TiptapDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before repair" }],
        },
      ],
    };

    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });
    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({
          fullContent: currentDoc,
          contentMarkdown: "Before repair",
        }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    let snapshotAttempts = 0;
    const snapshotRepo = {
      createSnapshot: mock(async () => {
        snapshotAttempts += 1;
        if (snapshotAttempts === 1) {
          throw new Error("ContentEditSnapshot.createSnapshot: no such table: content_edit_snapshot");
        }
        return {
          id: "snapshot-1",
          editId: "edit-1",
          targetType: "writer.document",
          targetId: "doc-1",
          contentBefore: currentDoc,
          mode: "replace",
          selectionInfo: null,
          instruction: "Rewrite",
          provider: "test-provider",
          model: "test-model",
          workspaceId: "ws-1",
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown;
      }),
      markActive: mock(async () => {}),
      completeEdit: mock(async () => {}),
      failEdit: mock(async () => {}),
      markRolledBack: mock(async () => {}),
    } as unknown as ContentEditSnapshotRepository;

    const lockRepo = {
      acquireLock: mock(async () => ({ id: "lock-1" })),
      releaseLock: mock(async () => {}),
      findLock: mock(async () => null),
    } as unknown as ContentEditLockRepository;

    const exec = mock(() => {});
    const dbStub = {
      getRawDb: () => ({ exec }),
      tasks: {
        create: async () => {},
        update: async () => {},
      },
    } as unknown as DatabaseAccess;

    const service = new ContentEditorService(
      dbStub,
      {
        get: async () => undefined,
      } as unknown as ProviderRegistry,
      {
        resolve: async () => target,
      } as unknown as ContentTargetRegistry,
      snapshotRepo,
      lockRepo,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        content: "# Updated after repair",
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result.success).toBe(true);
    expect(snapshotAttempts).toBe(2);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(setContent).toHaveBeenCalledTimes(1);
  });

  test("handleToolCall returns CONTENT_EDIT_SCHEMA_UNAVAILABLE when repair fails", async () => {
    const setContent = mock(async () => {});
    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      description: "Writer target",
      supportedModes: ["replace"],
      exists: async () => true,
      getContent: async () => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Before" }] }],
      }),
      getContentContext: async () =>
        ({
          fullContent: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Before" }] }],
          },
          contentMarkdown: "Before",
        }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const snapshotRepo = {
      createSnapshot: mock(async () => {
        throw new Error("ContentEditSnapshot.createSnapshot: no such table: content_edit_snapshot");
      }),
      markActive: mock(async () => {}),
      completeEdit: mock(async () => {}),
      failEdit: mock(async () => {}),
      markRolledBack: mock(async () => {}),
    } as unknown as ContentEditSnapshotRepository;

    const dbStub = {
      getRawDb: () => ({
        exec: () => {
          throw new Error("repair failed");
        },
      }),
      tasks: {
        create: async () => {},
        update: async () => {},
      },
    } as unknown as DatabaseAccess;

    const service = new ContentEditorService(
      dbStub,
      {
        get: async () => undefined,
      } as unknown as ProviderRegistry,
      {
        resolve: async () => target,
      } as unknown as ContentTargetRegistry,
      snapshotRepo,
      {
        acquireLock: mock(async () => ({ id: "lock-1" })),
        releaseLock: mock(async () => {}),
        findLock: mock(async () => null),
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        mode: "replace",
        content: "# Updated after failed repair",
      },
      {
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      },
      {
        provider: "test-provider",
        model: "test-model",
      },
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "CONTENT_EDIT_SCHEMA_UNAVAILABLE",
        }),
      }),
    );
    expect(setContent).not.toHaveBeenCalled();
  });

  test("smart generate: resolves to replace for empty doc", async () => {
    const emptyDoc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = emptyDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      { mode: "generate", content: "# Fresh content\n\nHello world" },
      {
        workspaceId: "ws-1",
        activeTarget: { targetType: "writer.document", targetId: "doc-1" },
      },
      { provider: "p", model: "m" },
    );

    expect(result.success).toBe(true);
    expect(setContent).toHaveBeenCalledTimes(1);
    // For empty doc, generate → replace, so setContent receives full doc (not merged)
    expect(extractText(currentDoc)).toContain("Hello world");
  });

  test("smart generate: resolves to append for non-empty doc", async () => {
    const nonEmptyDoc: TiptapDocument = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Existing" }] },
      ],
    };

    let currentDoc: TiptapDocument = nonEmptyDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "Existing" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      { mode: "generate", content: "# New section" },
      {
        workspaceId: "ws-1",
        activeTarget: { targetType: "writer.document", targetId: "doc-1" },
      },
      { provider: "p", model: "m" },
    );

    expect(result.success).toBe(true);
    expect(result.message).toBe("Content appended successfully");
    // For non-empty doc, generate → append, so content is merged
    const text = extractText(currentDoc);
    expect(text).toContain("Existing");
    expect(text).toContain("New section");
  });

  test("handleToolCall rejects knowledge.page target outside active page scope", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };

    let currentDoc: TiptapDocument = doc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "knowledge.page",
      label: "Knowledge Page",
      supportedModes: ["replace", "append", "selection", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "Original" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1", parentId: null }),
    };

    const createSnapshot = mock(async () => ({ id: "s1" } as unknown));
    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot,
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        target_type: "knowledge.page",
        target_id: "outside-page",
        mode: "replace",
        content: "# Outside",
      },
      {
        workspaceId: "ws-1",
        activeTarget: { targetType: "knowledge.page", targetId: "page-1" },
      },
      { provider: "p", model: "m" },
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("PAGE_ACCESS_DENIED");
    expect(setContent).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  test("handleToolCall allows exactly mentioned knowledge.page target outside subtree", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Original" }] }],
    };

    let currentDoc: TiptapDocument = doc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "knowledge.page",
      label: "Knowledge Page",
      supportedModes: ["replace", "append", "selection", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "Original" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1", parentId: null }),
    };

    const createSnapshot = mock(async () => ({ id: "s1" } as unknown));
    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot,
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const result = await service.handleToolCall(
      {
        target_type: "knowledge.page",
        target_id: "outside-page",
        mode: "replace",
        content: "# Allowed",
      },
      {
        workspaceId: "ws-1",
        activeTarget: { targetType: "knowledge.page", targetId: "page-1" },
        knowledgeScope: {
          rootPageId: "page-1",
          mentionedPageIds: ["outside-page"],
          grantMode: "exact",
          grantLifetime: "turn",
        },
      },
      { provider: "p", model: "m" },
    );

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(setContent).toHaveBeenCalledTimes(1);
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });

  test("duplicate edit guardrail blocks second replace on same target", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = doc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const chatSpec = { provider: "p", model: "m", taskId: "task-1" };
    const ctx = {
      workspaceId: "ws-1",
      activeTarget: { targetType: "writer.document", targetId: "doc-1" },
    };

    // First replace succeeds
    const r1 = await service.handleToolCall(
      { mode: "replace", content: "# First" },
      ctx,
      chatSpec,
    );
    expect(r1.success).toBe(true);

    // Second replace on same target in same task is blocked
    const r2 = await service.handleToolCall(
      { mode: "replace", content: "# Second" },
      ctx,
      chatSpec,
    );
    expect(r2.success).toBe(false);
    expect(r2.error?.code).toBe("DUPLICATE_EDIT_BLOCKED");
  });

  test("duplicate edit guardrail blocks second generate (append) after first generate (replace)", async () => {
    const emptyDoc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = emptyDoc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const chatSpec = { provider: "p", model: "m", taskId: "task-dup" };
    const ctx = {
      workspaceId: "ws-1",
      activeTarget: { targetType: "writer.document", targetId: "doc-1" },
    };

    // First generate on empty doc → resolves to replace → succeeds
    const r1 = await service.handleToolCall(
      { mode: "generate", content: "# Physics Guide" },
      ctx,
      chatSpec,
    );
    expect(r1.success).toBe(true);

    // Second generate on same target (now non-empty → would resolve to append) → blocked
    const r2 = await service.handleToolCall(
      { mode: "generate", content: "# More content" },
      ctx,
      chatSpec,
    );
    expect(r2.success).toBe(false);
    expect(r2.error?.code).toBe("DUPLICATE_EDIT_BLOCKED");
  });

  test("duplicate edit guardrail blocks append after replace in same task", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = doc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const chatSpec = { provider: "p", model: "m", taskId: "task-mix" };
    const ctx = {
      workspaceId: "ws-1",
      activeTarget: { targetType: "writer.document", targetId: "doc-1" },
    };

    // First call: replace → succeeds
    const r1 = await service.handleToolCall(
      { mode: "replace", content: "# Content" },
      ctx,
      chatSpec,
    );
    expect(r1.success).toBe(true);

    // Second call: append on same target in same task → blocked
    const r2 = await service.handleToolCall(
      { mode: "append", content: "# More" },
      ctx,
      chatSpec,
    );
    expect(r2.success).toBe(false);
    expect(r2.error?.code).toBe("DUPLICATE_EDIT_BLOCKED");
  });

  test("duplicate edit guardrail skipped when no taskId", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = doc;
    const setContent = mock(async (_id: string, content: TiptapDocument) => {
      currentDoc = content;
    });

    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent,
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const chatSpec = { provider: "p", model: "m" }; // no taskId
    const ctx = {
      workspaceId: "ws-1",
      activeTarget: { targetType: "writer.document", targetId: "doc-1" },
    };

    // Both replaces succeed without taskId
    const r1 = await service.handleToolCall({ mode: "replace", content: "# First" }, ctx, chatSpec);
    expect(r1.success).toBe(true);

    const r2 = await service.handleToolCall({ mode: "replace", content: "# Second" }, ctx, chatSpec);
    expect(r2.success).toBe(true);
  });

  test("clearTaskEdits allows new edit after clearing", async () => {
    const doc: TiptapDocument = {
      type: "doc",
      content: [{ type: "paragraph" }],
    };

    let currentDoc: TiptapDocument = doc;
    const target: ContentTarget = {
      targetType: "writer.document",
      label: "Writer Document",
      supportedModes: ["replace", "append", "generate"],
      exists: async () => true,
      getContent: async () => currentDoc,
      getContentContext: async () =>
        ({ fullContent: currentDoc, contentMarkdown: "" }) as ContentContext,
      setContent: async (_id, content) => { currentDoc = content; },
      applySelectionUpdate: async () => {},
      getMetadata: async () => ({ workspaceId: "ws-1" }),
    };

    const service = new ContentEditorService(
      {
        tasks: { create: async () => {}, update: async () => {} },
      } as unknown as DatabaseAccess,
      { get: async () => undefined } as unknown as ProviderRegistry,
      { resolve: async () => target } as unknown as ContentTargetRegistry,
      {
        createSnapshot: async () => ({ id: "s1" } as unknown),
        markActive: async () => {},
        completeEdit: async () => {},
        failEdit: async () => {},
        markRolledBack: async () => {},
      } as unknown as ContentEditSnapshotRepository,
      {
        acquireLock: async () => ({ id: "l1" }),
        releaseLock: async () => {},
        findLock: async () => null,
      } as unknown as ContentEditLockRepository,
    );

    const chatSpec = { provider: "p", model: "m", taskId: "task-2" };
    const ctx = {
      workspaceId: "ws-1",
      activeTarget: { targetType: "writer.document", targetId: "doc-1" },
    };

    await service.handleToolCall({ mode: "replace", content: "# A" }, ctx, chatSpec);
    service.clearTaskEdits("task-2");

    const r = await service.handleToolCall({ mode: "replace", content: "# B" }, ctx, chatSpec);
    expect(r.success).toBe(true);
  });
});

describe("isEmptyTiptapContent", () => {
  test("undefined is empty", () => expect(isEmptyTiptapContent(undefined)).toBe(true));
  test("null is empty", () => expect(isEmptyTiptapContent(null)).toBe(true));
  test("[] is empty", () => expect(isEmptyTiptapContent([])).toBe(true));
  test("[{ type: 'paragraph' }] is empty", () =>
    expect(isEmptyTiptapContent([{ type: "paragraph" }])).toBe(true));
  test("[{ type: 'paragraph', content: [] }] is empty", () =>
    expect(isEmptyTiptapContent([{ type: "paragraph", content: [] }])).toBe(true));
  test("paragraph with text is not empty", () =>
    expect(isEmptyTiptapContent([{ type: "paragraph", content: [{ type: "text", text: "hi" }] }])).toBe(false));
  test("multiple nodes is not empty", () =>
    expect(isEmptyTiptapContent([{ type: "paragraph" }, { type: "paragraph" }])).toBe(false));
  test("heading node is not empty", () =>
    expect(isEmptyTiptapContent([{ type: "heading" }])).toBe(false));
});
