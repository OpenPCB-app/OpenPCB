import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { Space } from "@modules/knowledge/react/Space";
import type { Page, PageUpdateEvent } from "@modules/knowledge/shared/types";
import type { AuthorityMode } from "@modules/knowledge/react/components/Editor/PageEditor";

const { mockRefreshPage, mockSetPage, mockRefreshTree, mockRequestRefresh } = vi.hoisted(() => ({
  mockRefreshPage: vi.fn(async () => {}),
  mockSetPage: vi.fn(),
  mockRefreshTree: vi.fn(async () => {}),
  mockRequestRefresh: vi.fn(),
}));

const sseState = vi.hoisted(() => ({
  onPageUpdate: null as ((event: PageUpdateEvent) => void) | null,
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
    created_at: new Date("2026-02-20T10:00:00.000Z"),
    updated_at: new Date("2026-02-20T10:00:00.000Z"),
    deleted_at: null,
  };
}

function emitSSE(event: PageUpdateEvent) {
  if (!sseState.onPageUpdate) {
    throw new Error("SSE callback not registered");
  }
  sseState.onPageUpdate(event);
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
    setRightTopButtons: vi.fn(),
    clearButtons: vi.fn(),
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
  useKnowledgePageUpdates: vi.fn(
    (_workspaceId: string | null, onPageUpdate: (event: PageUpdateEvent) => void) => {
      sseState.onPageUpdate = onPageUpdate;
      return { isConnected: false };
    },
  ),
}));

vi.mock("@modules/knowledge/react/components/Sidebar/Sidebar", () => ({
  Sidebar: ({
    selectedPageId,
    onSelectPage,
  }: {
    selectedPageId: string | null;
    onSelectPage: (pageId: string) => void;
  }) => (
    <div>
      <button data-testid="select-page-1" onClick={() => onSelectPage("page-1")}>
        Select Page 1
      </button>
      <button data-testid="select-page-2" onClick={() => onSelectPage("page-2")}>
        Select Page 2
      </button>
      <div data-testid="sidebar-selected">{selectedPageId ?? "none"}</div>
    </div>
  ),
}));

vi.mock("@modules/knowledge/react/components/Editor/PageEditor", () => ({
  PageEditor: ({
    onAuthorityModeChange,
    onSaveRequestId,
  }: {
    onAuthorityModeChange?: (mode: AuthorityMode) => void;
    onSaveRequestId?: (requestId: string) => void;
  }) => (
    <div>
      <button data-testid="authority-manual" onClick={() => onAuthorityModeChange?.("manual")}>
        Manual
      </button>
      <button data-testid="authority-idle" onClick={() => onAuthorityModeChange?.("idle")}>
        Idle
      </button>
      <button data-testid="authority-ai" onClick={() => onAuthorityModeChange?.("ai")}>
        AI
      </button>
      <button data-testid="track-request" onClick={() => onSaveRequestId?.("req-1")}>
        Track Request
      </button>
    </div>
  ),
}));

vi.mock("@modules/knowledge/react/components/Properties/PropertiesPanel", () => ({
  PropertiesPanel: () => null,
}));

vi.mock("@modules/knowledge/react/components/Chat/PageChatPanel", () => ({
  PageChatPanel: () => null,
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div />,
}));

describe("Knowledge Space external update sync", () => {
  beforeEach(() => {
    localStorage.setItem("knowledge:panel:state", "none");
    localStorage.setItem("knowledge:panel:width", "320");
    sseState.onPageUpdate = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sseState.onPageUpdate = null;
  });

  it("idle mode applies SSE update immediately", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
    });

    await waitFor(() => {
      expect(mockRefreshPage).toHaveBeenCalledTimes(1);
    });
  });

  it("manual mode defers SSE update", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("authority-manual"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
    });

    await waitFor(() => {
      expect(mockRefreshPage).not.toHaveBeenCalled();
    });
  });

  it("deferred update is applied on transition back to idle", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("authority-manual"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
    });

    await user.click(screen.getByTestId("authority-idle"));

    await waitFor(() => {
      expect(mockRefreshPage).toHaveBeenCalledTimes(1);
    });
  });

  it("ai mode defers SSE update", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("authority-ai"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "ai",
    });

    await waitFor(() => {
      expect(mockRefreshPage).not.toHaveBeenCalled();
    });
  });

  it("deferred update applies after AI completion (ai → idle)", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("authority-ai"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "ai",
    });

    await user.click(screen.getByTestId("authority-idle"));

    await waitFor(() => {
      expect(mockRefreshPage).toHaveBeenCalledTimes(1);
    });
  });

  it("manual → ai transition preserves deferred update until ai completes", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("authority-manual"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
    });

    await user.click(screen.getByTestId("authority-ai"));
    expect(mockRefreshPage).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("authority-idle"));

    await waitFor(() => {
      expect(mockRefreshPage).toHaveBeenCalledTimes(1);
    });
  });

  it("suppresses self-echo event when requestId matches tracked save", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));
    await user.click(screen.getByTestId("track-request"));

    emitSSE({
      type: "content_updated",
      pageId: "page-1",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
      requestId: "req-1",
    });

    await waitFor(() => {
      expect(mockRefreshPage).not.toHaveBeenCalled();
    });
  });

  it("ignores updates for non-selected pages", async () => {
    const user = userEvent.setup();
    render(<Space />);

    await user.click(screen.getByTestId("select-page-1"));

    emitSSE({
      type: "content_updated",
      pageId: "page-2",
      workspaceId: "ws-1",
      updatedAt: "2026-02-20T10:01:00.000Z",
      revision: 2,
      source: "user",
    });

    await waitFor(() => {
      expect(mockRefreshPage).not.toHaveBeenCalled();
    });
  });
});
