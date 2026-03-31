import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageEditor } from "@modules/knowledge/react/components/Editor/PageEditor";
import type { EditorContent, Page } from "@modules/knowledge/shared/types";
import { KnowledgeApiError } from "@modules/knowledge/react/hooks/useKnowledgeApi";

const {
  mockUpdatePageMeta,
  mockUpdatePageContent,
  mockRefreshTree,
  mockResetPending,
  mockToast,
} = vi.hoisted(() => ({
  mockUpdatePageMeta: vi.fn(),
  mockUpdatePageContent: vi.fn(),
  mockRefreshTree: vi.fn(async () => {}),
  mockResetPending: vi.fn(),
  mockToast: vi.fn(),
}));

vi.mock("@modules/knowledge/react/hooks", async () => {
  const actual = await vi.importActual<typeof import("@modules/knowledge/react/hooks")>(
    "@modules/knowledge/react/hooks",
  );

  return {
    ...actual,
    usePage: () => {
      throw new Error("PageEditor must use canonical page prop, not usePage hook");
    },
    useKnowledgeApi: () => ({
      createPage: vi.fn(),
      getPage: vi.fn(),
      updatePageMeta: mockUpdatePageMeta,
      updatePageContent: mockUpdatePageContent,
      movePage: vi.fn(),
      deletePage: vi.fn(),
      restorePage: vi.fn(),
      getWorkspaceTree: vi.fn(),
      getProjectTree: vi.fn(),
      searchPages: vi.fn(),
      ensureProjectRoot: vi.fn(),
      bulkDeletePages: vi.fn(),
      bulkMovePages: vi.fn(),
    }),
    usePageTree: () => ({
      tree: [],
      isLoading: false,
      error: null,
      refresh: mockRefreshTree,
    }),
    useAutosave: ({
      onSave,
      saveKey,
    }: {
      onSave: (content: EditorContent, saveKey: string) => Promise<void>;
      saveKey: string;
    }) => ({
      status: "idle" as const,
      triggerSave: (content: EditorContent) => {
        void onSave(content, saveKey).catch(() => {});
      },
      flushSave: () => {},
      resetPending: mockResetPending,
      hasUnsavedChanges: false,
    }),
  };
});

vi.mock("@modules/knowledge/react/components/Editor/TiptapEditor", async () => {
  const React = await import("react");
  const editorInstance = {
    isDestroyed: false,
    getJSON: () => ({ type: "doc", content: [{ type: "paragraph" }] }),
  };

  return {
    TiptapEditor: ({
      onChange,
      onReady,
      readOnly,
    }: {
      onChange?: (content: EditorContent) => void;
      onReady?: (editor: unknown) => void;
      readOnly?: boolean;
    }) => {
      React.useEffect(() => {
        onReady?.(editorInstance);
      }, []);

      return (
        <div>
          <div data-testid="editor-readonly">{String(Boolean(readOnly))}</div>
          <button
            data-testid="emit-change"
            onClick={() =>
              onChange?.({
                engine: "tiptap",
                version: 1,
                data: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "local-edit" }],
                    },
                  ],
                },
              })
            }
          >
            Emit Change
          </button>
        </div>
      );
    },
  };
});

vi.mock("@modules/knowledge/react/components/Editor/FixedToolbar", () => ({
  FixedToolbar: () => null,
}));

vi.mock("@modules/knowledge/react/components/Editor/LinkDialog", () => ({
  LinkDialog: () => null,
}));

vi.mock("@modules/knowledge/react/components/Editor/AiEditDialog", () => ({
  AiEditDialog: () => null,
}));

vi.mock("@/hooks/useContentEditor", () => ({
  useContentEditor: () => ({
    status: "idle",
    streamedText: "",
    error: null,
    startEdit: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    isEditing: false,
  }),
}));

vi.mock("@/lib/storage/ai-settings", () => ({
  getDefaultAISettings: () => ({
    provider: "openai",
    model: "gpt-4o-mini",
  }),
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    workspace_id: "ws-1",
    project_id: null,
    parent_id: null,
    is_project_root: false,
    order_key: "a0",
    title: "Initial",
    icon: null,
    properties_json: {},
    content_engine: "tiptap",
    content_version: 1,
    content_json: {
      engine: "tiptap",
      version: 1,
      data: { type: "doc", content: [{ type: "paragraph" }] },
    },
    revision: 1,
    created_at: new Date("2026-02-19T09:00:00.000Z"),
    updated_at: new Date("2026-02-19T09:00:00.000Z"),
    deleted_at: null,
    ...overrides,
  };
}

describe("PageEditor conflict resolution", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows conflict toast in manual mode", async () => {
    const user = userEvent.setup();
    const serverPage = makePage({
      title: "Server Title",
      updated_at: new Date("2026-02-19T10:00:00.000Z"),
    });

    mockUpdatePageContent.mockRejectedValueOnce(
      new KnowledgeApiError({
        status: 409,
        code: "CONTENT_CONFLICT",
        payload: { error: "CONTENT_CONFLICT", page: serverPage },
      }),
    );

    render(
      <PageEditor
        pageId="page-1"
        page={makePage()}
        isLoading={false}
        error={null}
        refreshPage={vi.fn(async () => {})}
        workspaceId="ws-1"
      />,
    );

    await user.click(screen.getByTestId("emit-change"));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Conflict detected",
        }),
      );
    });
  });

  it("opens conflict dialog in idle mode and applies server snapshot on Reload Server", async () => {
    const onPageChange = vi.fn();
    const serverPage = makePage({
      title: "Server Title",
      updated_at: new Date("2026-02-19T10:00:00.000Z"),
    });

    // Create a deferred promise for the save operation
    let rejectSave: (err: any) => void;
    const savePromise = new Promise((_, reject) => {
      rejectSave = reject;
    });
    mockUpdatePageContent.mockReturnValueOnce(savePromise);

    render(
      <PageEditor
        pageId="page-1"
        page={makePage()}
        isLoading={false}
        error={null}
        refreshPage={vi.fn(async () => {})}
        onPageChange={onPageChange}
        workspaceId="ws-1"
      />,
    );

    // Trigger manual edit -> mode = manual
    await userEvent.click(screen.getByTestId("emit-change"));

    // Wait for idle timeout
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Now reject the save -> mode should be idle
    rejectSave!(
      new KnowledgeApiError({
        status: 409,
        code: "CONTENT_CONFLICT",
        payload: { error: "CONTENT_CONFLICT", page: serverPage },
      }),
    );

    await screen.findByText("Page changed on another source");
    await userEvent.click(screen.getByRole("button", { name: "Reload Server" }));

    expect(onPageChange).toHaveBeenCalledWith(serverPage);
    expect(mockResetPending).toHaveBeenCalled();
  });

  it("retries with latest server timestamp when Keep Local is chosen in idle mode", async () => {
    const onPageChange = vi.fn();
    const initialPage = makePage({
      updated_at: new Date("2026-02-19T09:00:00.000Z"),
    });
    const serverPage = makePage({
      title: "Server Newer",
      updated_at: new Date("2026-02-19T10:00:00.000Z"),
    });
    const mergedLocal = makePage({
      title: "Local Wins",
      updated_at: new Date("2026-02-19T10:01:00.000Z"),
    });

    // Create a deferred promise for the first save operation
    let rejectSave: (err: any) => void;
    const savePromise = new Promise((_, reject) => {
      rejectSave = reject;
    });

    mockUpdatePageContent
      .mockReturnValueOnce(savePromise)
      .mockResolvedValueOnce({ page: mergedLocal });

    render(
      <PageEditor
        pageId="page-1"
        page={initialPage}
        isLoading={false}
        error={null}
        refreshPage={vi.fn(async () => {})}
        onPageChange={onPageChange}
        workspaceId="ws-1"
      />,
    );

    // Trigger manual edit -> mode = manual
    await userEvent.click(screen.getByTestId("emit-change"));

    // Wait for idle timeout
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Now reject the save -> mode should be idle
    rejectSave!(
      new KnowledgeApiError({
        status: 409,
        code: "CONTENT_CONFLICT",
        payload: { error: "CONTENT_CONFLICT", page: serverPage },
      }),
    );

    await screen.findByText("Page changed on another source");
    await userEvent.click(screen.getByRole("button", { name: "Keep Local" }));

    await waitFor(() => {
      expect(mockUpdatePageContent).toHaveBeenCalledTimes(2);
    });

    const secondCall = mockUpdatePageContent.mock.calls[1];
    expect(secondCall?.[0]).toBe("page-1");
    expect(secondCall?.[2]).toMatchObject({
      ifUnmodifiedSince: "2026-02-19T10:00:00.000Z",
    });
    expect(onPageChange).toHaveBeenCalledWith(mergedLocal);
  });
});
