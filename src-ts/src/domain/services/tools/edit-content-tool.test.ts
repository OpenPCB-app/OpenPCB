import { describe, expect, it, mock } from "bun:test";
import { createEditContentHandler } from "./edit-content-tool";
import type { ContentEditorService } from "../content-editor";

describe("edit-content-tool handler", () => {
  it("allows explicit target edits without activeContext when workspace is provided", async () => {
    const handleToolCall = mock(async () => ({
      success: true,
      message: "Content updated successfully",
      editId: "edit-1",
    }));
    const service = { handleToolCall } as unknown as ContentEditorService;
    const handler = createEditContentHandler(service);

    const result = await handler.execute(
      {
        target_type: "knowledge.page",
        target_id: "page-1",
        mode: "replace",
        content: "# Updated",
        workspace_id: "ws-1",
        project_id: "proj-1",
      },
      {
        taskId: "task-1",
        provider: "ollama",
        model: "qwen3:8b",
      },
    );

    expect(handleToolCall).toHaveBeenCalledTimes(1);
    expect(handleToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        target_type: "knowledge.page",
        target_id: "page-1",
        mode: "replace",
        content: "# Updated",
      }),
      {
        workspaceId: "ws-1",
        projectId: "proj-1",
        activeTarget: undefined,
        selection: undefined,
      },
      {
        provider: "ollama",
        model: "qwen3:8b",
      },
    );
    expect(result).toEqual({
      success: true,
      message: "Content updated successfully",
      editId: "edit-1",
    });
  });

  it("fails when workspace cannot be resolved from args or active context", async () => {
    const handleToolCall = mock(async () => ({
      success: true,
      message: "unexpected",
    }));
    const service = { handleToolCall } as unknown as ContentEditorService;
    const handler = createEditContentHandler(service);

    const result = await handler.execute({
      target_type: "knowledge.page",
      target_id: "page-1",
      mode: "replace",
      content: "# Updated",
    });

    expect(result).toEqual({
      success: false,
      message: "workspaceId required",
      error: { code: "MISSING_WORKSPACE", message: "workspaceId required" },
    });
    expect(handleToolCall).not.toHaveBeenCalled();
  });

  it("accepts live_stream instruction-driven edits without content", async () => {
    const handleToolCall = mock(async () => ({
      success: true,
      message: "Content updated successfully",
      editId: "edit-live-1",
    }));
    const service = { handleToolCall } as unknown as ContentEditorService;
    const handler = createEditContentHandler(service);

    const result = await handler.execute(
      {
        mode: "replace",
        instruction: "Rewrite this document to be concise.",
        live_stream: true,
      },
      {
        taskId: "task-live-1",
        provider: "openai",
        model: "gpt-4o",
        activeContext: {
          workspaceId: "ws-1",
          activeTarget: {
            targetType: "writer.document",
            targetId: "doc-1",
          },
        },
      },
    );

    expect(handleToolCall).toHaveBeenCalledTimes(1);
    expect(handleToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "replace",
        instruction: "Rewrite this document to be concise.",
        live_stream: true,
      }),
      expect.objectContaining({
        workspaceId: "ws-1",
        activeTarget: {
          targetType: "writer.document",
          targetId: "doc-1",
        },
      }),
      {
        provider: "openai",
        model: "gpt-4o",
      },
    );
    expect(result).toEqual({
      success: true,
      message: "Content updated successfully",
      editId: "edit-live-1",
    });
  });
});
