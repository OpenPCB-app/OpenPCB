import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageChatPanel } from "@modules/knowledge/react/components/Chat/PageChatPanel";
import type { Page } from "@modules/knowledge/shared/types";

const { mockUsePageChat, mockChatInterface } = vi.hoisted(() => ({
  mockUsePageChat: vi.fn(),
  mockChatInterface: vi.fn(),
}));

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    workspace_id: "ws-1",
    project_id: null,
    parent_id: null,
    is_project_root: false,
    order_key: "a0",
    title: "Page",
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

vi.mock("@modules/knowledge/react/hooks/usePageChat", () => ({
  usePageChat: (...args: unknown[]) => mockUsePageChat(...args),
}));

vi.mock("@/components/ChatInterface", () => ({
  ChatInterface: ({ config }: { config: { behavior?: { inputDisabled?: boolean } } }) => {
    mockChatInterface(config);
    return <div data-testid="chat-interface">Chat Interface</div>;
  },
}));

describe("PageChatPanel lifecycle wiring", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("forwards edit callbacks to usePageChat and disables chat input when locked", () => {
    const onEditApplied = vi.fn();
    const onEditLifecycleEvent = vi.fn();

    mockUsePageChat.mockReturnValue({
      chatId: "chat-1",
      isInitializing: false,
      provider: "openai",
      model: "gpt-4o-mini",
      toolsEnabled: true,
      setToolsEnabled: vi.fn(),
      systemPrompt: "prompt",
      messages: [],
      status: "ready",
      modelLoadingState: null,
      submitMessage: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
      reset: vi.fn(),
    });

    render(
      <PageChatPanel
        pageId="page-1"
        page={makePage()}
        workspaceId="ws-1"
        onClose={() => {}}
        onEditApplied={onEditApplied}
        onEditLifecycleEvent={onEditLifecycleEvent}
        inputDisabled
      />,
    );

    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
    expect(mockUsePageChat).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: "page-1",
        workspaceId: "ws-1",
        onEditApplied,
        onEditLifecycleEvent,
      }),
    );
    expect(mockChatInterface).toHaveBeenCalledWith(
      expect.objectContaining({
        behavior: expect.objectContaining({
          inputDisabled: true,
        }),
      }),
    );
  });
});
