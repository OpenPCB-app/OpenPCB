// @vitest-environment happy-dom
import React, { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { PageEditor } from "../components/Editor/PageEditor";
import { createKnowledgeApi } from "../hooks/useKnowledgeApi";
import { getPageSaveCoordinator } from "../lib/page-save-coordinator";
import type { EditorContent, Page } from "../../shared/types";

let api = createKnowledgeApi("http://ownership", "knowledge");
let testId = 0;
vi.mock("../KnowledgeApiContext", () => ({ useKnowledgeApi: () => api }));
vi.mock("../components/Editor/FixedToolbar", () => ({
  FixedToolbar: ({ editor }: { editor: Editor & { label: string } }) => (
    <div data-testid="toolbar">{editor.label}</div>
  ),
}));
vi.mock("../components/Editor/LinkDialog", () => ({ LinkDialog: () => null }));

const textOf = (value?: EditorContent): string =>
  JSON.stringify(value?.data ?? "").match(/"text":"([^"]*)"/)?.[1] ?? "";

// A live (never destroyed) stand-in makes a retained or evicted parent reference
// observable; its release arrives after the replacement editor reported ready.
vi.mock("../components/Editor/TiptapEditor", () => ({
  TiptapEditor: ({
    initialContent,
    onReady,
  }: {
    initialContent?: EditorContent;
    onReady?: (editor: Editor | null, departed?: Editor) => void;
  }) => {
    const ready = useRef(onReady);
    ready.current = onReady;
    useEffect(() => {
      const text = textOf(initialContent);
      const editor = {
        label: text,
        isDestroyed: false,
        getText: () => text,
        on: () => {},
        off: () => {},
      } as unknown as Editor;
      ready.current?.(editor);
      return () => {
        const release = ready.current;
        setTimeout(() => release?.(null, editor), 0);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div className="fake-editor" />;
  },
}));

const content = (text: string): EditorContent => ({
  engine: "tiptap",
  version: 1,
  data: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});
const page = (id: string, text: string): Page => ({
  id,
  title: id,
  workspace_id: "default",
  project_id: null,
  parent_id: null,
  is_project_root: false,
  order_key: "a",
  icon: null,
  properties_json: {},
  content_engine: "tiptap",
  content_version: 1,
  content_json: content(text),
  revision: 1,
  created_at: new Date(0),
  updated_at: new Date(1),
  deleted_at: null,
});

let root: Root;
let host: HTMLDivElement;
const render = async (pageId: string | null, value: Page | null) => {
  await act(async () =>
    root.render(
      <PageEditor
        pageId={pageId}
        page={value}
        isLoading={false}
        error={null}
        refreshPage={async () => {}}
      />,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
};
const toolbar = () => host.querySelector('[data-testid="toolbar"]');

beforeEach(() => {
  api = createKnowledgeApi(`http://ownership-${++testId}`, "knowledge");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "unexpected" }, { status: 500 })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Docs editor ownership", () => {
  it("a late release of a replaced editor never evicts the live editor", async () => {
    await render("a", page("a", "first"));
    expect(toolbar()?.textContent).toBe("first");
    // A remote body change remounts the same page's editor (new document generation).
    await act(async () => {
      getPageSaveCoordinator(api).acceptRemote({
        ...page("a", "second"),
        revision: 2,
        updated_at: new Date(2),
      });
    });
    await render("a", page("a", "first"));
    expect(host.querySelectorAll(".fake-editor")).toHaveLength(1);
    expect(toolbar()?.textContent).toBe("second");
    expect(host.textContent).toContain("1 word");
  });
});
