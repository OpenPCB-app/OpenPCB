import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePage } from "@modules/knowledge/react/hooks/usePage";
import type { Page } from "@modules/knowledge/shared/types";

type GetPageFn = (
  pageId: string,
  options?: { signal?: AbortSignal },
) => Promise<Page | null>;

const { mockGetPage } = vi.hoisted(() => ({
  mockGetPage: vi.fn<GetPageFn>(),
}));

vi.mock("@modules/knowledge/react/hooks/useKnowledgeApi", () => ({
  useKnowledgeApi: () => ({
    getPage: mockGetPage,
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

function Harness({ pageId }: { pageId: string | null }) {
  const { page, refresh } = usePage(pageId);
  return (
    <div>
      <button data-testid="refresh" onClick={() => void refresh()}>
        Refresh
      </button>
      <div data-testid="title">{page?.title ?? "none"}</div>
    </div>
  );
}

describe("usePage stale request protection", () => {
  beforeEach(() => {
    mockGetPage.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("ignores older same-page response when a newer refresh resolves first", async () => {
    const user = userEvent.setup();
    const pending: Array<(value: Page | null) => void> = [];
    mockGetPage.mockImplementation(
      () =>
        new Promise<Page | null>((resolve) => {
          pending.push(resolve);
        }),
    );

    render(<Harness pageId="page-1" />);

    await user.click(screen.getByTestId("refresh"));
    expect(pending.length).toBeGreaterThanOrEqual(2);

    const oldest = pending[0];
    const newest = pending[pending.length - 1];

    await act(async () => {
      newest?.(makePage({ title: "New version" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("title")).toHaveTextContent("New version");

    await act(async () => {
      oldest?.(makePage({ title: "Old version" }));
      await Promise.resolve();
    });

    expect(screen.getByTestId("title")).toHaveTextContent("New version");
  });
});
