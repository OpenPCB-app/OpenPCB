import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Space } from "@modules/knowledge/react/Space";
import type { Page } from "@modules/knowledge/shared/types";
import type { EditAppliedEvent, EditLifecycleEvent } from "@modules/knowledge/react/hooks/usePageChat";

const {
  mockRefreshPage,
  mockSetPage,
  mockRefreshTree,
  mockRequestRefresh,
  mockSetRightTopButtons,
  mockClearButtons,
} = vi.hoisted(() => ({
  mockRefreshPage: vi.fn(async () => {}),
  mockSetPage: vi.fn(),
  mockRefreshTree: vi.fn(async () => {}),
  mockRequestRefresh: vi.fn(),
  mockSetRightTopButtons: vi.fn(),
  mockClearButtons: vi.fn(),
}));

function makePage(id: string): Page {
  return {
    id,
    workspace_id: "ws-1",
    project_id: null,
    parent_id: null,
    is_project_root: false,
    order_key: "a0",
    title: `Page ${id}`,
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
  };
}

vi.mock("@/stores/app-store", () => ({
  useAppStore: (selector: (state: { activeWorkspaceId: string }) => unknown) =>
    selector({ activeWorkspaceId: "ws-1" }),
}));

vi.mock("@modules/knowledge/react/stores/tree-store", () => {
  const tree = [
    {
      id: "page-1",
      workspace_id: "ws-1",
      title: "Page 1",
      icon: null,
      parent_id: null,
      project_id: null,
      is_project_root: false,
      order_key: "a1",
      content_json: null,
      properties_json: {},
      children: [],
    },
    {
      id: "page-2",
      workspace_id: "ws-1",
      title: "Page 2",
      icon: null,
      parent_id: null,
      project_id: null,
      is_project_root: false,
      order_key: "a2",
      content_json: null,
      properties_json: {},
      children: [],
    },
  ];

  return {
    useTreeStore: (
      selector: (state: { tree: typeof tree; requestRefresh: () => void }) => unknown,
    ) => selector({ tree, requestRefresh: mockRequestRefresh }),
    isDescendant: () => false,
  };
});

vi.mock("@/contexts/SidebarButtonsContext", () => ({
  useRegisterSidebarButtons: () => ({
    setRightTopButtons: mockSetRightTopButtons,
    clearButtons: mockClearButtons,
  }),
}));

vi.mock("@modules/knowledge/react/hooks", () => ({
  usePage: (pageId: string | null) => ({
    page: pageId ? makePage(pageId) : null,
    isLoading: false,
    error: null,
    refresh: mockRefreshPage,
    setPage: mockSetPage,
  }),
  useKnowledgeApi: () => ({
    deletePage: vi.fn(),
    restorePage: vi.fn(),
  }),
  usePageTree: () => ({
    refresh: mockRefreshTree,
  }),
  useKnowledgePageUpdates: vi.fn(() => ({ isConnected: false })),
}));

vi.mock("@modules/knowledge/react/components/Sidebar/Sidebar", () => ({
  Sidebar: ({
    selectedPageId,
    onSelectPage,
    lockedPageIds,
  }: {
    selectedPageId: string | null;
    onSelectPage: (pageId: string) => void;
    lockedPageIds?: ReadonlySet<string>;
  }) => (
    <div>
      <button data-testid="select-page-1" onClick={() => onSelectPage("page-1")}>
        Select Page 1
      </button>
      <button data-testid="select-page-2" onClick={() => onSelectPage("page-2")}>
        Select Page 2
      </button>
      <div data-testid="sidebar-selected">{selectedPageId ?? "none"}</div>
      <div data-testid="sidebar-locked">
        {Array.from(lockedPageIds ?? []).join(",")}
      </div>
    </div>
  ),
}));

vi.mock("@modules/knowledge/react/components/Editor/PageEditor", () => ({
  PageEditor: ({
    pageId,
    isAiLocked,
  }: {
    pageId: string | null;
    isAiLocked?: boolean;
  }) => (
    <div>
      <div data-testid="editor-page">{pageId ?? "none"}</div>
      <div data-testid="editor-locked">{String(Boolean(isAiLocked))}</div>
    </div>
  ),
}));

vi.mock("@modules/knowledge/react/components/Properties/PropertiesPanel", () => ({
  PropertiesPanel: ({
    isReadOnly,
  }: {
    isReadOnly?: boolean;
  }) => <div data-testid="properties-readonly">{String(Boolean(isReadOnly))}</div>,
}));

vi.mock("@modules/knowledge/react/components/Chat/PageChatPanel", () => ({
  PageChatPanel: ({
    pageId,
    inputDisabled,
    onEditLifecycleEvent,
    onEditApplied,
  }: {
    pageId: string;
    inputDisabled?: boolean;
    onEditLifecycleEvent?: (event: EditLifecycleEvent) => void;
    onEditApplied?: (event: EditAppliedEvent) => void;
  }) => (
    <div>
      <div data-testid="chat-page">{pageId}</div>
      <div data-testid="chat-input-disabled">{String(Boolean(inputDisabled))}</div>
      <button
        data-testid="chat-start-current"
        onClick={() =>
          onEditLifecycleEvent?.({
            chatId: "chat-1",
            documentId: pageId,
            toolCallId: "tool-1",
            toolName: "edit_content",
            status: "started",
          })
        }
      >
        Start Current
      </button>
      <button
        data-testid="chat-complete-page-1"
        onClick={() =>
          onEditLifecycleEvent?.({
            chatId: "chat-1",
            documentId: "page-1",
            toolCallId: "tool-1",
            toolName: "edit_content",
            status: "completed",
          })
        }
      >
        Complete Page 1
      </button>
      <button
        data-testid="chat-apply-current"
        onClick={() =>
          onEditApplied?.({
            chatId: "chat-1",
            documentId: pageId,
            toolCallId: "tool-1",
            result: { success: true },
          })
        }
      >
        Apply Current
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

describe("Knowledge Space chat lifecycle integration", () => {
  beforeEach(() => {
    localStorage.setItem("knowledge:panel:state", "chat");
    localStorage.setItem("knowledge:panel:width", "320");
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("applies per-page lock from chat lifecycle and keeps other pages writable", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    expect(screen.getByTestId("editor-page")).toHaveTextContent("page-1");
    fireEvent.keyDown(window, { metaKey: true, key: "." });
    fireEvent.keyDown(window, { metaKey: true, key: "." });
    await screen.findByTestId("chat-start-current");

    await user.click(screen.getByTestId("chat-start-current"));

    await waitFor(() => {
      expect(screen.getByTestId("editor-locked")).toHaveTextContent("true");
      expect(screen.getByTestId("chat-input-disabled")).toHaveTextContent("true");
      expect(screen.getByTestId("sidebar-locked")).toHaveTextContent("page-1");
    });

    await user.click(screen.getByTestId("select-page-2"));

    await waitFor(() => {
      expect(screen.getByTestId("editor-page")).toHaveTextContent("page-2");
      expect(screen.getByTestId("editor-locked")).toHaveTextContent("false");
      expect(screen.getByTestId("chat-input-disabled")).toHaveTextContent("false");
      expect(screen.getByTestId("sidebar-locked")).toHaveTextContent("page-1");
    });

    await user.click(screen.getByTestId("chat-complete-page-1"));

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-locked")).toHaveTextContent("");
    });
  });

  it("refreshes selected page after chat edit is applied", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    fireEvent.keyDown(window, { metaKey: true, key: "." });
    fireEvent.keyDown(window, { metaKey: true, key: "." });
    await screen.findByTestId("chat-apply-current");
    await user.click(screen.getByTestId("chat-apply-current"));

    await waitFor(() => {
      expect(mockRefreshPage).toHaveBeenCalledTimes(1);
    });
  });
});
