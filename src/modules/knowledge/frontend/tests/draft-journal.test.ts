import { afterEach, expect, test, vi } from "vitest";
import type {
  DraftJournal,
  DraftJournalRecord,
} from "../../../../core/contracts/app/draft-journal";
import { PageDraftJournal } from "../lib/page-draft-journal";
import { PageSaveCoordinator } from "../lib/page-save-coordinator";
import {
  parseRetainedPageDraft,
  type RetainedPageDraft,
} from "../lib/draft-recovery-content";
import { createKnowledgeApi } from "../hooks/useKnowledgeApi";
import type { Page, EditorContent } from "../../shared/types";

function memoryJournal() {
  const records = new Map<string, DraftJournalRecord>();
  const bridge: DraftJournal = {
    read: vi.fn(async (key) => records.get(key) ?? null),
    write: vi.fn(async (input) => {
      const previous = records.get(input.key);
      if (previous?.token === input.token && previous.value === input.value)
        return previous;
      if ((previous?.token ?? null) !== input.expectedToken)
        throw new Error("CAS conflict");
      const record = { token: input.token, value: input.value };
      records.set(input.key, record);
      return record;
    }),
    remove: vi.fn(async ({ key, expectedToken }) => {
      if (!records.has(key)) return false;
      if (records.get(key)?.token !== expectedToken)
        throw new Error("CAS conflict");
      return records.delete(key);
    }),
    list: async () => ({
      records: [...records].map(([key, record]) => ({
        key,
        token: record.token,
      })),
      unreadableCount: 0,
    }),
  };
  return { bridge, records };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const content = (text: string): EditorContent => ({
  engine: "tiptap",
  version: 1,
  data: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});
const page = (revision = 1): Page => ({
  id: "a",
  title: "A",
  workspace_id: "default",
  project_id: null,
  parent_id: null,
  is_project_root: false,
  order_key: "a",
  icon: null,
  properties_json: {},
  content_engine: "tiptap",
  content_version: 1,
  content_json: content("stored"),
  revision,
  created_at: new Date(0),
  updated_at: new Date(revision),
  deleted_at: null,
});
const retained = (): RetainedPageDraft => ({
  schemaVersion: 1,
  pageId: "a",
  workspaceId: "default",
  base: {
    revision: 1,
    updatedAt: new Date(1).toISOString(),
    contentEngine: "tiptap",
    contentVersion: 1,
  },
  pending: { content: content("recovered") },
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("delayed old acknowledgement cannot erase a newer desired draft", async () => {
  const { bridge, records } = memoryJournal();
  const pending = deferred<DraftJournalRecord>();
  const write = bridge.write;
  let first = true;
  bridge.write = async (input) => {
    const result = await write(input);
    if (first) {
      first = false;
      await pending.promise;
    }
    return result;
  };
  const session = new PageDraftJournal(bridge, "a", () => {});
  await session.load();
  session.set('"old"');
  session.set('"new"');
  expect(session.status).toBe("writing");
  pending.resolve({ token: "ignored", value: "ignored" });
  await session.flush();
  expect(records.get("a")?.value).toBe('"new"');
  expect(session.status).toBe("durable");
});

test("lost write acknowledgement retries the exact CAS before publishing a newer draft", async () => {
  const { bridge, records } = memoryJournal();
  const write = bridge.write;
  const calls: Parameters<DraftJournal["write"]>[0][] = [];
  bridge.write = async (input) => {
    calls.push(input);
    const result = await write(input);
    if (calls.length === 1) throw new Error("IPC lost");
    return result;
  };
  const session = new PageDraftJournal(bridge, "a", () => {});
  await session.load();
  session.set('"old"');
  await expect(session.flush()).rejects.toThrow("IPC lost");
  session.set('"latest"');
  expect(calls).toHaveLength(1);
  session.retry();
  await session.flush();
  expect(calls[1]).toEqual(calls[0]);
  expect(records.get("a")?.value).toBe('"latest"');
});

test("delayed conditional cleanup publishes a newer draft afterward", async () => {
  const { bridge, records } = memoryJournal();
  const wait = deferred<void>();
  const remove = bridge.remove;
  bridge.remove = async (input) => {
    await wait.promise;
    return remove(input);
  };
  const session = new PageDraftJournal(bridge, "a", () => {});
  await session.load();
  session.set('"saved"');
  await session.flush();
  session.set(null);
  session.set('"newer"');
  wait.resolve();
  await session.flush();
  expect(records.get("a")?.value).toBe('"newer"');
});

test("foreign CAS conflict retains foreign bytes and never reports durability", async () => {
  const { bridge, records } = memoryJournal();
  const session = new PageDraftJournal(bridge, "a", () => {});
  await session.load();
  records.set("a", { token: "foreign", value: '"foreign"' });
  session.set('"mine"');
  await expect(session.flush()).rejects.toThrow("CAS conflict");
  expect(session.status).toBe("error");
  expect(records.get("a")?.value).toBe('"foreign"');
});

test("read failure remains blocked and cannot overwrite an unknown retained record", async () => {
  const { bridge } = memoryJournal();
  bridge.read = async () => {
    throw new Error("Unreadable future record");
  };
  const session = new PageDraftJournal(bridge, "a", () => {});
  await expect(session.load()).rejects.toThrow();
  session.set('"new"');
  session.retry();
  await expect(session.flush()).rejects.toThrow("Unreadable");
  expect(bridge.write).not.toHaveBeenCalled();
});

test("restoration gates hydration, performs no HTTP writes, and requires explicit retry", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const waiting = deferred<DraftJournalRecord | null>();
  records.set("a", { token: "retained", value: JSON.stringify(retained()) });
  bridge.read = () => waiting.promise;
  const fetch = vi.fn(async () =>
    Response.json({ page: { ...page(2), content_json: content("recovered") } }),
  );
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  const opening = coordinator.prepareRemote(page());
  expect(coordinator.snapshot("a")).toBeNull();
  waiting.resolve(records.get("a")!);
  await opening;
  expect(coordinator.snapshot("a")?.content).toEqual(content("recovered"));
  expect(coordinator.snapshot("a")?.recovered).toBe(true);
  expect(coordinator.safeToClose()).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetch).not.toHaveBeenCalled();
  coordinator.retry("a");
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(records.has("a")).toBe(false);
});

test("changed remote baseline blocks ordinary retry and keeps recovery bytes", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const original = JSON.stringify(retained());
  records.set("a", { token: "retained", value: original });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page(4));
  coordinator.retry("a");
  await vi.advanceTimersByTimeAsync(2000);
  expect(coordinator.snapshot("a")?.conflict).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  expect(records.get("a")?.value).toBe(original);
});

test("journal failure blocks HTTP and close; successful explicit retry stores before HTTP", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const write = bridge.write;
  let denied = true;
  bridge.write = async (input) => {
    if (denied) throw new Error("disk full");
    return write(input);
  };
  const fetch = vi.fn(async () => {
    expect(records.has("a")).toBe(true);
    return new Response("failed", { status: 500 });
  });
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page());
  coordinator.setContent("a", content("new"));
  await vi.advanceTimersByTimeAsync(1100);
  expect(fetch).not.toHaveBeenCalled();
  expect(coordinator.safeToClose()).toBe(false);
  denied = false;
  coordinator.retry("a");
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(coordinator.safeToClose()).toBe(true);
});

test("deletion suspends pending autosave without removing the retained body", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page());
  coordinator.setContent("a", content("new"));
  coordinator.suspendDeletion(["a"]);
  coordinator.retry("a");
  await vi.advanceTimersByTimeAsync(1100);
  expect(fetch).not.toHaveBeenCalled();
  expect(records.has("a")).toBe(true);
});

test("unknown content/version/identity cannot hydrate or normalize a recovery record", () => {
  expect(
    parseRetainedPageDraft(JSON.stringify(retained()), page()).pending.content,
  ).toEqual(content("recovered"));
  for (const value of [
    { ...retained(), schemaVersion: 2 },
    { ...retained(), workspaceId: "other" },
    { ...retained(), pending: { content: { ...content("x"), version: 2 } } },
    {
      ...retained(),
      pending: {
        content: {
          engine: "tiptap",
          version: 1,
          data: { type: "future-node" },
        },
      },
    },
    {
      ...retained(),
      pending: {
        content: {
          engine: "tiptap",
          version: 1,
          data: {
            type: "doc",
            attrs: { future: 1 },
            content: [{ type: "paragraph" }],
          },
        },
      },
    },
  ])
    expect(() =>
      parseRetainedPageDraft(JSON.stringify(value), page()),
    ).toThrow();
});

test("a remote change during journal sync cancels the pending HTTP write", async () => {
  vi.useFakeTimers();
  const { bridge } = memoryJournal();
  const gate = deferred<void>();
  const write = bridge.write;
  bridge.write = async (input) => {
    await gate.promise;
    return write(input);
  };
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page());
  coordinator.setContent("a", content("local"));
  coordinator.flush("a");
  coordinator.remoteChanged("a");
  gate.resolve();
  await vi.advanceTimersByTimeAsync(1100);
  expect(fetch).not.toHaveBeenCalled();
  expect(coordinator.snapshot("a")?.conflict).toBe(true);
});

test("title acknowledgement retains the newer body with the advanced backend baseline", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const metadata = deferred<Response>();
  const fetch = vi.fn(async (url: string) =>
    url.endsWith("/meta")
      ? metadata.promise
      : new Response("failed", { status: 500 }),
  );
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page());
  coordinator.setTitle("a", "Renamed");
  coordinator.flush("a");
  await vi.advanceTimersByTimeAsync(10);
  coordinator.setContent("a", content("newer body"));
  metadata.resolve(Response.json({ page: { ...page(2), title: "Renamed" } }));
  await vi.advanceTimersByTimeAsync(1100);
  const record = parseRetainedPageDraft(records.get("a")!.value, page(2));
  expect(record.base.revision).toBe(2);
  expect(record.pending.title).toBeUndefined();
  expect(record.pending.content).toEqual(content("newer body"));
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("parallel opening requests apply the newer remote page after the shared journal lookup", async () => {
  const { bridge } = memoryJournal();
  const gate = deferred<DraftJournalRecord | null>();
  bridge.read = () => gate.promise;
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  const first = coordinator.prepareRemote(page());
  const newer = coordinator.prepareRemote(page(4));
  gate.resolve(null);
  await Promise.all([first, newer]);
  expect(coordinator.snapshot("a")?.page.revision).toBe(4);
  expect(coordinator.snapshot("a")?.ready).toBe(true);
});

test("a future payload remains intact while new volatile edits cannot overwrite it", async () => {
  vi.useFakeTimers();
  const { bridge, records } = memoryJournal();
  const future = JSON.stringify({ ...retained(), schemaVersion: 99 });
  records.set("a", { token: "future", value: future });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const coordinator = new PageSaveCoordinator(
    createKnowledgeApi("http://journal", "knowledge"),
    bridge,
  );
  await coordinator.prepareRemote(page());
  coordinator.setContent("a", content("new volatile"));
  await vi.advanceTimersByTimeAsync(1100);
  coordinator.retry("a");
  await vi.advanceTimersByTimeAsync(10);
  expect(fetch).not.toHaveBeenCalled();
  expect(coordinator.safeToClose()).toBe(false);
  expect(records.get("a")?.value).toBe(future);
  expect(bridge.write).not.toHaveBeenCalled();
});
