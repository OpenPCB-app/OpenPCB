import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKnowledgeApi } from "../hooks/useKnowledgeApi";
import {
  OFFLINE_SAVE_ERROR,
  PageSaveCoordinator,
} from "../lib/page-save-coordinator";
import type { EditorContent, Page } from "../../shared/types";

const content = (text: string): EditorContent => ({
  engine: "tiptap",
  version: 1,
  data: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});
const page = (id = "a", text = "old", revision = 1): Page => ({
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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = async () => {
  await vi.advanceTimersByTimeAsync(1100);
};
let coordinator: PageSaveCoordinator;
let requests: { url: string; options: RequestInit }[];
beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://test", "knowledge"),
  );
  coordinator.acceptRemote(page());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const respond = (
  handler: (url: string, options: RequestInit) => Promise<Response>,
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, options: RequestInit) => {
      requests.push({ url, options });
      return handler(url, options);
    }),
  );
};

describe("page-scoped title/body save coordination", () => {
  it("serializes delayed metadata/body, retains every character, advances acknowledged token", async () => {
    const meta = deferred<Response>();
    respond(async (url) =>
      url.endsWith("meta")
        ? meta.promise
        : Response.json({
            page: page("a", "abcdefghijklmnopqrstuvwxyz0123456789", 3),
          }),
    );
    coordinator.setTitle("a", "Renamed");
    coordinator.flush("a");
    coordinator.setContent(
      "a",
      content("abcdefghijklmnopqrstuvwxyz0123456789"),
    );
    await tick();
    expect(requests).toHaveLength(1);
    expect(coordinator.snapshot("a")?.status).toBe("saving");
    meta.resolve(
      Response.json({ page: { ...page("a", "old", 2), title: "Renamed" } }),
    );
    await tick();
    expect(requests).toHaveLength(2);
    expect(
      new Headers(requests[1]!.options.headers).get("If-Unmodified-Since"),
    ).toBe(new Date(2).toISOString());
    expect(coordinator.snapshot("a")?.content).toEqual(
      content("abcdefghijklmnopqrstuvwxyz0123456789"),
    );
    expect(coordinator.snapshot("a")?.status).toBe("saved");
    requests.forEach((request) =>
      expect(
        coordinator.isOwnRequest(
          new Headers(request.options.headers).get("X-Request-Id")!,
        ),
      ).toBe(true),
    );
  });
  it("body first, title second use the same acknowledged token", async () => {
    const body = deferred<Response>();
    respond(async (url) =>
      url.endsWith("content")
        ? body.promise
        : Response.json({ page: { ...page("a", "new", 3), title: "Rename" } }),
    );
    coordinator.setContent("a", content("new"));
    coordinator.flush("a");
    coordinator.setTitle("a", "Rename");
    await tick();
    expect(requests).toHaveLength(1);
    body.resolve(Response.json({ page: page("a", "new", 2) }));
    await tick();
    expect(
      new Headers(requests[1]!.options.headers).get("If-Unmodified-Since"),
    ).toBe(new Date(2).toISOString());
    expect(coordinator.snapshot("a")?.content).toEqual(content("new"));
  });
  it("page switches and late completions never retarget writes", async () => {
    const save = deferred<Response>();
    respond(async () => save.promise);
    coordinator.setTitle("a", "Left early");
    coordinator.acceptRemote(page("b", "other"));
    await tick();
    expect(requests[0]!.url).toContain("/pages/a/meta");
    expect(coordinator.snapshot("b")?.status).toBe("idle");
    save.resolve(
      Response.json({ page: { ...page("a", "old", 2), title: "Left early" } }),
    );
    await tick();
    expect(coordinator.snapshot("b")?.title).toBe("b");
  });
  it.each([0, 409, 500])(
    "retains newest failed body/title (%s), never replays automatically",
    async (status) => {
      respond(async () => {
        if (!status) throw new TypeError("offline");
        return Response.json({ error: "failure" }, { status });
      });
      coordinator.setContent("a", content("retained"));
      coordinator.setTitle("a", "retained title");
      await tick();
      await tick();
      expect(requests).toHaveLength(1);
      expect(coordinator.snapshot("a")?.status).toBe("error");
      coordinator.acceptRemote(page("b"));
      coordinator.acceptRemote(page());
      expect(coordinator.snapshot("a")?.content).toEqual(content("retained"));
      expect(coordinator.snapshot("a")?.title).toBe("retained title");
      coordinator.setContent("a", content("newer retained"));
      await tick();
      expect(requests).toHaveLength(1);
      respond(async () =>
        Response.json({
          page: { ...page("a", "newer retained", 2), title: "retained title" },
        }),
      );
      if (status === 409) {
        coordinator.retry("a");
        await tick();
        expect(requests).toHaveLength(1);
        respond(async (url) =>
          Response.json({
            page: {
              ...page("a", url.endsWith("/a") ? "remote" : "newer retained", 3),
              title: "retained title",
            },
          }),
        );
        await coordinator.reload("a", true);
        await tick();
      } else {
        coordinator.retry("a");
        await tick();
      }
      expect(coordinator.snapshot("a")?.content).toEqual(
        content("newer retained"),
      );
      expect(coordinator.snapshot("a")?.status).toBe("saved");
    },
  );
  it("remote changes block pending autosave without overwriting local text", async () => {
    respond(async () => Response.json({ page: page("a", "remote", 2) }));
    coordinator.setContent("a", content("local"));
    coordinator.remoteChanged("a");
    await tick();
    expect(requests).toHaveLength(0);
    expect(coordinator.acceptRemote(page("a", "remote", 2))).toBe(false);
    expect(coordinator.snapshot("a")?.content).toEqual(content("local"));
    await coordinator.reload("a", false);
    expect(coordinator.snapshot("a")?.content).toEqual(content("remote"));
  });
  it("reconnect after an outage flags a dirty page only if the server advanced", async () => {
    respond(async () => Response.json({ page: page("a", "old", 1) }));
    coordinator.setContent("a", content("local"));
    await coordinator.verifyAfterReconnect("a");
    expect(coordinator.snapshot("a")).toMatchObject({ conflict: false });
    expect(coordinator.snapshot("a")?.error).toBeNull();
    respond(async () => Response.json({ page: page("a", "remote", 2) }));
    await coordinator.verifyAfterReconnect("a");
    expect(coordinator.snapshot("a")).toMatchObject({ conflict: true });
    expect(coordinator.snapshot("a")?.content).toEqual(content("local"));
  });
  it("remote change to a clean page invalidates fetches without a conflict", async () => {
    respond(async () => Response.json({ page: page("a", "remote", 2) }));
    const beforeEvent = coordinator.version("a");
    coordinator.remoteChanged("a");
    expect(coordinator.snapshot("a")).toMatchObject({
      conflict: false,
      error: null,
      status: "idle",
      version: beforeEvent + 1,
    });
    expect(
      coordinator.acceptRemote(page("a", "stale fetch", 2), beforeEvent),
    ).toBe(false);
    expect(coordinator.acceptRemote(page("a", "remote", 2))).toBe(true);
    expect(coordinator.snapshot("a")?.content).toEqual(content("remote"));
    await tick();
    expect(requests).toHaveLength(0);
  });
  it.each([
    ["offline", false, OFFLINE_SAVE_ERROR],
    [
      "connection refused",
      true,
      "Could not save. Your draft is retained; retry when the service is available.",
    ],
  ])(
    "%s save failure keeps the draft and sends nothing until explicit retry",
    async (_label, onLine, message) => {
      vi.stubGlobal("navigator", { onLine });
      respond(async () => {
        throw new TypeError("Failed to fetch");
      });
      coordinator.setContent("a", content("draft"));
      await tick();
      await tick();
      expect(requests).toHaveLength(1);
      expect(coordinator.snapshot("a")).toMatchObject({
        status: "error",
        conflict: false,
        error: message,
        content: content("draft"),
      });
      coordinator.setContent("a", content("draft more"));
      await tick();
      expect(requests).toHaveLength(1);
      vi.stubGlobal("navigator", { onLine: true });
      respond(async () => Response.json({ page: page("a", "draft more", 2) }));
      coordinator.retry("a");
      await tick();
      expect(requests).toHaveLength(2);
      expect(coordinator.snapshot("a")).toMatchObject({
        status: "saved",
        error: null,
        content: content("draft more"),
      });
    },
  );
  it("ignores fetch started before edits, acknowledgements or newer remote event", async () => {
    const beforeEdit = coordinator.version("a");
    coordinator.setContent("a", content("local"));
    expect(coordinator.acceptRemote(page(), beforeEdit)).toBe(false);
    respond(async () => Response.json({ page: page("a", "local", 2) }));
    const duringSave = coordinator.version("a");
    coordinator.flush("a");
    await tick();
    expect(coordinator.acceptRemote(page(), duringSave)).toBe(false);
    const beforeEvent = coordinator.version("a");
    coordinator.remoteChanged("a");
    expect(
      coordinator.acceptRemote(page("a", "older fetch", 2), beforeEvent),
    ).toBe(false);
  });
  it("failed reload retains local draft; input during reload cannot be discarded", async () => {
    const get = deferred<Response>();
    respond(async () => get.promise);
    coordinator.setContent("a", content("local"));
    coordinator.remoteChanged("a");
    const reload = coordinator.reload("a", false);
    coordinator.setContent("a", content("new local"));
    get.resolve(Response.json({ page: page("a", "remote", 2) }));
    expect(await reload).toBe(false);
    expect(coordinator.snapshot("a")?.content).toEqual(content("new local"));
  });
  it("viewing and reopening sends zero writes; whitespace title explicitly becomes Untitled", async () => {
    respond(async () =>
      Response.json({ page: { ...page("a", "old", 2), title: "Untitled" } }),
    );
    coordinator.acceptRemote(page());
    await tick();
    expect(requests).toHaveLength(0);
    coordinator.setTitle("a", "  ");
    await tick();
    expect(JSON.parse(requests[0]!.options.body as string)).toEqual({
      title: "Untitled",
    });
    expect(coordinator.snapshot("a")?.title).toBe("Untitled");
  });
  it("unmounted clean pages release memory; unsaved module drafts remain", async () => {
    const unsubscribeA = coordinator.subscribePage("a", () => {});
    coordinator.setContent("a", content("draft"));
    unsubscribeA();
    expect(coordinator.snapshot("a")?.content).toEqual(content("draft"));
    coordinator.acceptRemote(page("b"));
    const unsubscribeB = coordinator.subscribePage("b", () => {});
    unsubscribeB();
    expect(coordinator.snapshot("b")).toBeNull();
    respond(async () => Response.json({ page: page("a", "draft", 2) }));
    coordinator.flush("a");
    await tick();
    expect(coordinator.snapshot("a")).toBeNull();
  });
});
