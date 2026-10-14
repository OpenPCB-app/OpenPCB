// @vitest-environment happy-dom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { TiptapEditor } from "../components/Editor/TiptapEditor";
import { usePage } from "../hooks/usePage";
import { PageEditor } from "../components/Editor/PageEditor";
import type { EditorContent, Page } from "../../shared/types";
import { getPageSaveCoordinator } from "../lib/page-save-coordinator";
import { createKnowledgeApi } from "../hooks/useKnowledgeApi";
import { useDialogHostStore } from "@shared/frontend/ui/dialog-host-store";

let api = createKnowledgeApi("http://test", "knowledge");
let testId = 0;
vi.mock("../KnowledgeApiContext", () => ({ useKnowledgeApi: () => api }));
vi.mock("../components/Editor/PdfViewer", () => ({
  PdfViewer: () => <div>PDF</div>,
}));

export const content = (text: string): EditorContent => ({
  engine: "tiptap",
  version: 1,
  data: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(text ? { content: [{ type: "text", text }] } : {}),
      },
    ],
  },
});
const page = (id: string, text: string, revision = 1): Page => ({
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
  revision,
  created_at: new Date(0),
  updated_at: new Date(revision),
  deleted_at: null,
});
let root: Root;
let host: HTMLDivElement;
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};
const currentEditor = () =>
  (host.querySelector(".tiptap") as HTMLElement & { editor: Editor }).editor;
const renderPage = async (value: Page) => {
  await act(async () =>
    root.render(
      <PageEditor
        pageId={value.id}
        page={value}
        isLoading={false}
        error={null}
        refreshPage={async () => {}}
      />,
    ),
  );
  await settle();
};

let refreshLoader: () => Promise<void>;
function PageLoader({ id }: { id: string }) {
  const loaded = usePage(id);
  refreshLoader = loaded.refresh;
  return (
    <PageEditor
      pageId={id}
      page={loaded.page}
      isLoading={loaded.isLoading}
      error={loaded.error}
      refreshPage={loaded.refresh}
    />
  );
}

beforeEach(() => {
  api = createKnowledgeApi(`http://test-${++testId}`, "knowledge");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ page: page("a", "initial") })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    getPageSaveCoordinator(api).flush("a");
    getPageSaveCoordinator(api).flush("b");
  });
  await act(async () => root.unmount());
  await settle();
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("real Docs editor lifecycle", () => {
  it("mount and editable changes never emit document writes", async () => {
    const changes = vi.fn();
    await act(async () =>
      root.render(
        <TiptapEditor initialContent={content("initial")} onChange={changes} />,
      ),
    );
    await settle();
    expect(changes).not.toHaveBeenCalled();
  });
  it("switching documents creates independent undo history", async () => {
    await renderPage(page("a", "Alpha"));
    await act(async () => currentEditor().commands.insertContent(" edited"));
    await renderPage(page("b", "Beta"));
    expect(currentEditor().can().undo()).toBe(false);
    await act(async () => currentEditor().commands.undo());
    expect(currentEditor().getText()).toBe("Beta");
  });
  it("unmount clears parent references without manually destroying Tiptap", async () => {
    const ready = vi.fn();
    await act(async () =>
      root.render(
        <TiptapEditor initialContent={content("initial")} onReady={ready} />,
      ),
    );
    await settle();
    await act(async () => root.render(null));
    await settle();
    expect(ready.mock.calls.at(-1)?.[0] === null).toBe(true);
    // The departing instance lets owners drop it by identity, not by page id.
    expect(ready.mock.calls.at(-1)?.[1]).toBe(ready.mock.calls[0]?.[0]);
  });
  it("toolbar follows selection and history transactions immediately", async () => {
    await renderPage(page("a", "Alpha"));
    await act(async () => currentEditor().commands.toggleBold());
    expect(
      host.querySelector('button[title="Bold"]')?.getAttribute("aria-pressed"),
    ).toBe("true");
    await act(async () => currentEditor().commands.insertContent(" edit"));
    expect(
      (host.querySelector('button[title="Undo"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
  it("text/PDF/text and deleted-page navigation never use destroyed editors", async () => {
    await renderPage(page("a", "Alpha"));
    const previous = currentEditor();
    await renderPage({
      ...page("pdf", ""),
      content_engine: "pdf",
      content_json: {
        engine: "pdf",
        version: 1,
        data: {
          sha256: "abc",
          fileName: "test.pdf",
          byteSize: 3,
          mimeType: "application/pdf",
        },
      },
    });
    expect(host.textContent).toContain("PDF");
    expect(host.querySelector('button[title="Undo"]')).toBeNull();
    await renderPage(page("b", "Beta"));
    expect(previous.isDestroyed).toBe(true);
    expect(currentEditor().getText()).toBe("Beta");
    await act(async () =>
      root.render(
        <PageEditor
          pageId={null}
          page={null}
          isLoading={false}
          error={null}
          refreshPage={async () => {}}
        />,
      ),
    );
    await renderPage(page("a", "Alpha"));
    expect(currentEditor().can().undo()).toBe(false);
  });
  it("development remount leaves one live editor and zero mount writes", async () => {
    const changes = vi.fn();
    const ready = vi.fn();
    await act(async () =>
      root.render(
        <StrictMode>
          <TiptapEditor
            initialContent={content("initial")}
            onChange={changes}
            onReady={ready}
          />
        </StrictMode>,
      ),
    );
    await settle();
    expect(host.querySelectorAll(".tiptap")).toHaveLength(1);
    expect(currentEditor().isDestroyed).toBe(false);
    expect(changes).not.toHaveBeenCalled();
    expect(ready.mock.calls.at(-1)?.[0]).toBe(currentEditor());
  });
  it("delayed title acknowledgement never wipes continuously typed body", async () => {
    let releaseMeta!: (response: Response) => void;
    const delayedMeta = new Promise<Response>((resolve) => {
      releaseMeta = resolve;
    });
    let serverPage = page("a", "Alpha");
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        requests.push(url);
        if (url.endsWith("meta")) return delayedMeta;
        serverPage = {
          ...serverPage,
          content_json: JSON.parse(options.body as string) as EditorContent,
          revision: 3,
          updated_at: new Date(),
        };
        return Response.json({ page: serverPage });
      }),
    );
    await renderPage(serverPage);
    const coordinator = getPageSaveCoordinator(api);
    await act(async () => {
      coordinator.setTitle("a", "Renamed");
      coordinator.flush("a");
    });
    expect(host.textContent).toContain("Saving…");
    const letters = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (const letter of letters)
      await act(async () => currentEditor().commands.insertContent(letter));
    const expected = currentEditor().getJSON();
    serverPage = {
      ...serverPage,
      title: "Renamed",
      revision: 2,
      updated_at: new Date(),
    };
    await act(async () => releaseMeta(Response.json({ page: serverPage })));
    await settle();
    expect(currentEditor().getJSON()).toEqual(expected);
    expect(serverPage.content_json.data).toEqual(expected);
    expect(requests).toHaveLength(2);
    expect(host.textContent).toContain("Saved");
    expect(host.textContent).toContain("edited just now");
  });
  it("metadata word count resets on document switch", async () => {
    await renderPage(page("a", "one two three"));
    expect(host.textContent).toContain("3 words");
    await renderPage(page("b", ""));
    expect(host.textContent).toContain("0 words");
  });

  it("failed body survives module unmount/reopen and explicit UI retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "offline" }, { status: 500 })),
    );
    await renderPage(page("a", "Alpha"));
    await act(async () => {
      currentEditor().commands.insertContent("retained ");
      getPageSaveCoordinator(api).flush("a");
    });
    await settle();
    expect(host.textContent).toContain("Not saved");
    await act(async () => root.render(null));
    await settle();
    const namespace = api.draftNamespace!;
    api = createKnowledgeApi(
      namespace.replace("/api/modules/knowledge", ""),
      "knowledge",
    );
    await renderPage(page("a", "Alpha"));
    expect(currentEditor().getText()).toBe("retained Alpha");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) =>
        Response.json({
          page: {
            ...page("a", "Alpha"),
            content_json: JSON.parse(options.body as string) as EditorContent,
            revision: 2,
            updated_at: new Date(),
          },
        }),
      ),
    );
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry save",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(host.textContent).toContain("Saved");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
  it.each([
    [false, "You are offline."],
    [true, "Could not save."],
  ])(
    "network failure with navigator.onLine=%s shows its own retained-draft state",
    async (onLine, message) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(onLine);
      const fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
      await renderPage(page("a", "Alpha"));
      await act(async () => {
        currentEditor().commands.insertContent("kept ");
        getPageSaveCoordinator(api).flush("a");
      });
      await settle();
      const alert = host.querySelector('[role="alert"]')?.textContent ?? "";
      expect(host.textContent).toContain("Not saved");
      expect(alert).toContain(message);
      expect(alert).toContain("Draft retained");
      expect(alert.includes("You are offline.")).toBe(!onLine);
      expect(currentEditor().getText()).toBe("kept Alpha");
      expect(
        [...host.querySelectorAll("button")].some(
          (button) => button.textContent === "Retry save",
        ),
      ).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it("page deletion asks through the kit dialog and cancel sends nothing", async () => {
    const fetchMock = vi.fn(async () => Response.json({ page: page("a", "") }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPage(page("a", "Alpha"));
    await act(async () =>
      (
        host.querySelector('button[title="Delete page"]') as HTMLElement
      ).click(),
    );
    const [request] = useDialogHostStore.getState().queue;
    expect(request?.kind).toBe("confirm");
    expect(request?.options.title).toBe('Delete "a"?');
    await act(async () => request!.settle(false));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useDialogHostStore.getState().queue).toHaveLength(0);
  });
  it("refresh response started before typing cannot overwrite the live editor", async () => {
    let release!: (response: Response) => void;
    let delayed = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        delayed
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : Response.json({ page: page("a", "Alpha") }),
      ),
    );
    await act(async () => root.render(<PageLoader id="a" />));
    await settle();
    delayed = true;
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = refreshLoader();
    });
    await act(async () => currentEditor().commands.insertContent("local "));
    await act(async () => {
      release(Response.json({ page: page("a", "stale remote", 2) }));
      await refresh;
    });
    expect(currentEditor().getText()).toBe("local Alpha");
    expect(host.textContent).toContain("Unsaved");
    // Keep teardown's pending write deterministic too.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "offline" }, { status: 500 })),
    );
  });

  it("failed silent refresh keeps the editor mounted with an inline retry", async () => {
    let failing = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        failing
          ? Response.json({ error: "down" }, { status: 500 })
          : Response.json({ page: page("a", "Alpha") }),
      ),
    );
    await act(async () => root.render(<PageLoader id="a" />));
    await settle();
    failing = true;
    await act(async () => {
      await refreshLoader();
    });
    await settle();
    expect(currentEditor().getText()).toBe("Alpha");
    expect(host.textContent).toContain("Could not refresh this page");
    expect(host.textContent).toContain("Retry");
    failing = false;
    const retry = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "Retry",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(host.textContent).not.toContain("Could not refresh this page");
  });

  it("keeping a title draft displays remote body before subsequent typing", async () => {
    const initial = page("a", "old body");
    let server = {
      ...page("a", "remote body retained"),
      revision: 2,
      updated_at: new Date(2),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: RequestInit) => {
        if (options.method === "PATCH") {
          server = {
            ...server,
            revision: server.revision + 1,
            updated_at: new Date(),
          };
          if (url.endsWith("meta"))
            server.title = (
              JSON.parse(options.body as string) as { title: string }
            ).title;
          else
            server.content_json = JSON.parse(
              options.body as string,
            ) as EditorContent;
        }
        return Response.json({ page: server });
      }),
    );
    await renderPage(initial);
    const coordinator = getPageSaveCoordinator(api);
    await act(async () => {
      coordinator.setTitle("a", "local title");
      coordinator.remoteChanged("a");
    });
    const keep = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Keep draft and retry",
    )!;
    await act(async () => keep.click());
    await settle();
    expect(currentEditor().getText()).toBe("remote body retained");
    expect(currentEditor().can().undo()).toBe(false);
    await act(async () => {
      currentEditor().commands.insertContent("new ");
      coordinator.flush("a");
    });
    await settle();
    expect(currentEditor().getText()).toBe("new remote body retained");
    expect(server.content_json.data).toEqual(currentEditor().getJSON());
    expect(server.title).toBe("local title");
  });
  it("clean remote PDF change refreshes silently over stale text-page props", async () => {
    const remote: Page = {
      ...page("a", ""),
      content_engine: "pdf",
      revision: 2,
      content_json: {
        engine: "pdf",
        version: 1,
        data: {
          sha256: "remote",
          fileName: "remote.pdf",
          byteSize: 10,
          mimeType: "application/pdf",
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ page: remote })),
    );
    await renderPage(page("a", "old text"));
    const coordinator = getPageSaveCoordinator(api);
    await act(async () => {
      coordinator.remoteChanged("a");
    });
    expect(host.querySelector('[role="alert"]')).toBeNull();
    // Space refreshes a clean page after the event; the refresh lands here.
    await act(async () => {
      coordinator.acceptRemote(remote);
    });
    await settle();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("PDF");
    expect(host.querySelector(".tiptap")).toBeNull();
    expect(host.querySelector('button[title="Undo"]')).toBeNull();
  });
  it("keeping an unchanged local body draft preserves its editor and undo history", async () => {
    await renderPage(page("a", "original"));
    const previous = currentEditor();
    const coordinator = getPageSaveCoordinator(api);
    await act(async () => {
      previous.commands.insertContent("local ");
      coordinator.remoteChanged("a");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, options: RequestInit) =>
        Response.json({
          page: {
            ...page("a", "remote", 2),
            ...(options.method === "PATCH"
              ? {
                  content_json: JSON.parse(
                    options.body as string,
                  ) as EditorContent,
                }
              : {}),
          },
        }),
      ),
    );
    const keep = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Keep draft and retry",
    )!;
    await act(async () => keep.click());
    await settle();
    expect(currentEditor()).toBe(previous);
    expect(currentEditor().getText()).toBe("local original");
    expect(currentEditor().can().undo()).toBe(true);
  });
});
