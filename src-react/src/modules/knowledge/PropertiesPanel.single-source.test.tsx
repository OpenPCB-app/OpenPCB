import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PropertiesPanel } from "@modules/knowledge/react/components/Properties/PropertiesPanel";
import type { Page } from "@modules/knowledge/shared/types";

const { mockUpdatePageMeta } = vi.hoisted(() => ({
  mockUpdatePageMeta: vi.fn(),
}));

vi.mock("@modules/knowledge/react/hooks/usePage", () => ({
  usePage: () => {
    throw new Error(
      "PropertiesPanel must use canonical page prop, not usePage hook",
    );
  },
}));

vi.mock("@modules/knowledge/react/hooks/useKnowledgeApi", () => ({
  useKnowledgeApi: () => ({
    updatePageMeta: mockUpdatePageMeta,
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

describe("PropertiesPanel canonical page source", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders from provided page prop without calling usePage", () => {
    render(
      <PropertiesPanel
        pageId="page-1"
        page={makePage()}
        isLoading={false}
        error={null}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Properties")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
  });

  it("propagates metadata updates via onPageChange callback", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const page = makePage();
    const updated = makePage({
      properties_json: {
        prop1: {
          id: "prop1",
          name: "Text",
          type: "text",
          value: "",
        },
      },
      updated_at: new Date("2026-02-19T09:01:00.000Z"),
    });

    mockUpdatePageMeta.mockResolvedValueOnce(updated);

    render(
      <PropertiesPanel
        pageId={page.id}
        page={page}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onPageChange={onPageChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /add property/i }));
    await user.click(screen.getByRole("menuitem", { name: "Text" }));

    await waitFor(() => {
      expect(mockUpdatePageMeta).toHaveBeenCalledTimes(1);
    });
    expect(onPageChange).toHaveBeenCalledWith(updated);
  });
});
