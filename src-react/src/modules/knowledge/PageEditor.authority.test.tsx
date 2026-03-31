import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PageEditor } from "@modules/knowledge/react/components/Editor/PageEditor";
import type { EditorContent, Page } from "@modules/knowledge/shared/types";

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
                      content: [
                        { type: "text", text: "local-edit" }
                      ],
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

describe("PageEditor authority and sequencing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("stale save response does not overwrite newer local edits", async () => {
    const onPageChange = vi.fn();
    
    let resolveFirstSave: (value: { page: Page }) => void;
    const firstSavePromise = new Promise<{ page: Page }>((resolve) => {
      resolveFirstSave = resolve;
    });
    
    mockUpdatePageContent.mockReturnValueOnce(firstSavePromise);
    mockUpdatePageContent.mockResolvedValue({ page: makePage({ title: "Second Save" }) });

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

    fireEvent.click(screen.getByTestId("emit-change"));
    expect(mockUpdatePageContent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("emit-change"));
    expect(mockUpdatePageContent).toHaveBeenCalledTimes(2);

    const staleServerPage = makePage({ title: "Stale Server Content" });
    resolveFirstSave!({ page: staleServerPage });

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();
    
    expect(onPageChange).not.toHaveBeenCalledWith(staleServerPage);
  });

  it("latest save response applies when no newer edits occurred", async () => {
    const onPageChange = vi.fn();
    const updatedPage = makePage({ title: "Updated" });
    
    let resolveSave: (value: { page: Page }) => void;
    const savePromise = new Promise<{ page: Page }>((resolve) => {
      resolveSave = resolve;
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

    fireEvent.click(screen.getByTestId("emit-change"));

    vi.advanceTimersByTime(3500);

    resolveSave!({ page: updatedPage });

    await Promise.resolve();
    await Promise.resolve();

    expect(onPageChange).toHaveBeenCalledWith(updatedPage);
  });

  it("manual authority mode blocks backend content apply", async () => {
    const onPageChange = vi.fn();
    const onAuthorityModeChange = vi.fn();
    const updatedPage = makePage({ title: "Updated" });
    
    let resolveSave: (value: { page: Page }) => void;
    const savePromise = new Promise<{ page: Page }>((resolve) => {
      resolveSave = resolve;
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
        onAuthorityModeChange={onAuthorityModeChange}
        workspaceId="ws-1"
      />,
    );

    fireEvent.click(screen.getByTestId("emit-change"));
    expect(onAuthorityModeChange).toHaveBeenCalledWith("manual");
    
    resolveSave!({ page: updatedPage });

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    await Promise.resolve();

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("continuous typing: only the latest save response applies", async () => {
    const onPageChange = vi.fn();
    
    let resolveFirstSave: (value: { page: Page }) => void;
    const firstSavePromise = new Promise<{ page: Page }>((resolve) => {
      resolveFirstSave = resolve;
    });
    
    let resolveSecondSave: (value: { page: Page }) => void;
    const secondSavePromise = new Promise<{ page: Page }>((resolve) => {
      resolveSecondSave = resolve;
    });

    mockUpdatePageContent.mockReturnValueOnce(firstSavePromise);
    mockUpdatePageContent.mockReturnValueOnce(secondSavePromise);

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

    fireEvent.click(screen.getByTestId("emit-change"));
    fireEvent.click(screen.getByTestId("emit-change"));

    const stalePage = makePage({ title: "Stale" });
    const latestPage = makePage({ title: "Latest" });

    resolveFirstSave!({ page: stalePage });
    await Promise.resolve();
    await Promise.resolve();
    expect(onPageChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3500);
    
    resolveSecondSave!({ page: latestPage });
    await Promise.resolve();
    await Promise.resolve();
    
    expect(onPageChange).toHaveBeenCalledWith(latestPage);
  });
});
