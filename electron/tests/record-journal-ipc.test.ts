import { afterEach, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AtomicRecordStore } from "../../src/core/backend/storage/atomic-record-store";
import type { CredentialSender, CredentialTrust } from "../src/main/credential-ipc";
import {
  DESIGNER_RECOVERY_JOURNAL,
  DOCS_DRAFT_JOURNAL,
  journalDirectory,
  registerRecordJournalIpc,
  sweepStaleTemporaries,
  type RecordJournalDeps,
  type RecordJournalNamespace,
} from "../src/main/record-journal-ipc";

type Listener = (event: CredentialSender, ...arguments_: unknown[]) => unknown;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function profile() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "openpcb-record-journal-")));
  temporaries.push(root);
  const dbPath = join(root, "openpcb.sqlite");
  await writeFile(dbPath, "");
  return { root, dbPath };
}

function fixture(env: { root?: string; dbPath?: string } = {}) {
  const frame = { url: "http://127.0.0.1:1420/docs" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const event: CredentialSender = { sender, senderFrame: frame };
  const trust: CredentialTrust = { mainContents: () => sender, rendererOrigin: () => "http://127.0.0.1:1420" };
  const handlers = new Map<string, Listener>();
  const swept: string[] = [];
  const state = { ready: true };
  const deps: RecordJournalDeps = {
    ipc: { handle: (channel, listener) => { handlers.set(channel, listener); } },
    trust,
    backendReady: () => state.ready,
    env: () => env,
    realpath: (path) => path,
    createStore: (directory) => new AtomicRecordStore(directory),
    sweep: async (directory) => { swept.push(directory); return sweepStaleTemporaries(directory); },
  };
  const call = (ns: RecordJournalNamespace, operation: string, ...arguments_: unknown[]) =>
    Promise.resolve().then(() => handlers.get(`${ns.channel}:${operation}`)!(event, ...arguments_));
  return { event, sender, trust, deps, handlers, swept, state, call };
}

function staleTemporary(): string {
  return `${sha("some-key")}.json.${randomUUID()}.tmp`;
}

describe("journalDirectory", () => {
  test("namespaces share the DB scope hash but never the directory", () => {
    const docs = journalDirectory("/data", "/data/openpcb.sqlite", DOCS_DRAFT_JOURNAL);
    const designer = journalDirectory("/data", "/data/openpcb.sqlite", DESIGNER_RECOVERY_JOURNAL);
    const scope = sha("/data/openpcb.sqlite");
    expect(docs).toBe(`/data/knowledge-drafts-${scope}`);
    expect(designer).toBe(`/data/designer-recovery-${scope}`);
  });
});

describe("registerRecordJournalIpc", () => {
  test("registers exactly the namespace's four channels", () => {
    const { deps, handlers } = fixture();
    registerRecordJournalIpc(deps, DOCS_DRAFT_JOURNAL);
    registerRecordJournalIpc(deps, DESIGNER_RECOVERY_JOURNAL);
    expect([...handlers.keys()].sort()).toEqual([
      "designer-recovery-journal:list",
      "designer-recovery-journal:read",
      "designer-recovery-journal:remove",
      "designer-recovery-journal:write",
      "draft-journal:list",
      "draft-journal:read",
      "draft-journal:remove",
      "draft-journal:write",
    ]);
  });

  test("untrusted senders and a backend that is not ready fail with the namespace message", async () => {
    const paths = await profile();
    for (const ns of [DOCS_DRAFT_JOURNAL, DESIGNER_RECOVERY_JOURNAL]) {
      const { event, trust, deps, handlers, state } = fixture(paths);
      registerRecordJournalIpc(deps, ns);
      const list = handlers.get(`${ns.channel}:list`)!;
      const candidates: Array<{ event: CredentialSender; trust: CredentialTrust }> = [
        { event: { ...event, sender: { ...event.sender } }, trust },
        { event: { ...event, senderFrame: { url: event.sender.mainFrame.url } }, trust },
        { event: { ...event, senderFrame: null }, trust },
        { event, trust: { ...trust, mainContents: () => null } },
        { event, trust: { ...trust, rendererOrigin: () => null } },
        { event, trust: { ...trust, rendererOrigin: () => "http://127.0.0.1:54321" } },
      ];
      for (const candidate of candidates) {
        deps.trust = candidate.trust;
        await expect(Promise.resolve().then(() => list(candidate.event))).rejects.toThrow(ns.unavailableMessage);
      }
      deps.trust = trust;
      const destroyed = { ...event.sender, isDestroyed: () => true };
      deps.trust = { ...trust, mainContents: () => destroyed };
      await expect(Promise.resolve().then(() => list({ sender: destroyed, senderFrame: destroyed.mainFrame })))
        .rejects.toThrow(ns.unavailableMessage);
      deps.trust = trust;
      state.ready = false;
      await expect(Promise.resolve().then(() => list(event))).rejects.toThrow(ns.unavailableMessage);
      state.ready = true;
      expect(await list(event)).toEqual({ records: [], unreadableCount: 0 });
    }
    expect(DOCS_DRAFT_JOURNAL.unavailableMessage).toBe("Draft journal unavailable to this frame");
    expect(DESIGNER_RECOVERY_JOURNAL.unavailableMessage).not.toBe(DOCS_DRAFT_JOURNAL.unavailableMessage);
  });

  test("missing database scope fails with the namespace scope message", async () => {
    for (const ns of [DOCS_DRAFT_JOURNAL, DESIGNER_RECOVERY_JOURNAL]) {
      const { deps, call } = fixture({ root: "/data" });
      registerRecordJournalIpc(deps, ns);
      await expect(call(ns, "list")).rejects.toThrow(ns.scopeUnavailableMessage);
    }
  });

  test("two namespaces write two directories and never see each other's keys", async () => {
    const paths = await profile();
    const { deps, call } = fixture(paths);
    registerRecordJournalIpc(deps, DOCS_DRAFT_JOURNAL);
    registerRecordJournalIpc(deps, DESIGNER_RECOVERY_JOURNAL);
    const docsKey = "page-1";
    await call(DOCS_DRAFT_JOURNAL, "write", { key: docsKey, token: "t1", expectedToken: null, value: "{\"docs\":true}" });
    await call(DESIGNER_RECOVERY_JOURNAL, "write", { key: "v1/d/r", token: "t2", expectedToken: null, value: "{\"designer\":true}" });

    expect(await call(DESIGNER_RECOVERY_JOURNAL, "list")).toEqual({ records: [{ key: "v1/d/r", token: "t2" }], unreadableCount: 0 });
    expect(await call(DESIGNER_RECOVERY_JOURNAL, "read", docsKey)).toBeNull();
    expect(await call(DOCS_DRAFT_JOURNAL, "list")).toEqual({ records: [{ key: docsKey, token: "t1" }], unreadableCount: 0 });

    const docsDir = journalDirectory(paths.root, paths.dbPath, DOCS_DRAFT_JOURNAL);
    const designerDir = journalDirectory(paths.root, paths.dbPath, DESIGNER_RECOVERY_JOURNAL);
    expect((await readdir(paths.root)).sort()).toEqual(
      [`designer-recovery-${sha(paths.dbPath)}`, `knowledge-drafts-${sha(paths.dbPath)}`, "openpcb.sqlite"],
    );
    expect(await readdir(docsDir)).toEqual([`${sha(docsKey)}.json`]);
    expect(await readdir(designerDir)).toEqual([`${sha("v1/d/r")}.json`]);
  });

  test("designer namespace sweeps stale temporaries before first use; Docs leaves them", async () => {
    const paths = await profile();
    const docsDir = journalDirectory(paths.root, paths.dbPath, DOCS_DRAFT_JOURNAL);
    const designerDir = journalDirectory(paths.root, paths.dbPath, DESIGNER_RECOVERY_JOURNAL);
    const docsTemporary = staleTemporary();
    const designerTemporary = staleTemporary();
    for (const [directory, name] of [[docsDir, docsTemporary], [designerDir, designerTemporary]] as const) {
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, name), "partial", { mode: 0o600 });
      await writeFile(join(directory, "keep-me.txt"), "user file", { mode: 0o600 });
    }
    const { deps, call, swept } = fixture(paths);
    registerRecordJournalIpc(deps, DOCS_DRAFT_JOURNAL);
    registerRecordJournalIpc(deps, DESIGNER_RECOVERY_JOURNAL);

    expect(await call(DESIGNER_RECOVERY_JOURNAL, "list")).toEqual({ records: [], unreadableCount: 1 });
    expect((await readdir(designerDir)).sort()).toEqual(["keep-me.txt"]);
    expect(await call(DOCS_DRAFT_JOURNAL, "list")).toEqual({ records: [], unreadableCount: 2 });
    expect((await readdir(docsDir)).sort()).toEqual([docsTemporary, "keep-me.txt"].sort());
    expect(swept).toEqual([designerDir]);

    // Swept once per store: a later temporary is not this open's concern.
    await call(DESIGNER_RECOVERY_JOURNAL, "list");
    expect(swept).toEqual([designerDir]);
  });

  test("a failed sweep is retried before the store is used", async () => {
    const paths = await profile();
    const { deps, call } = fixture(paths);
    let attempts = 0;
    deps.sweep = async () => {
      attempts++;
      if (attempts === 1) throw new Error("sweep failed");
      return 0;
    };
    registerRecordJournalIpc(deps, DESIGNER_RECOVERY_JOURNAL);
    await expect(call(DESIGNER_RECOVERY_JOURNAL, "list")).rejects.toThrow("sweep failed");
    expect(await call(DESIGNER_RECOVERY_JOURNAL, "list")).toEqual({ records: [], unreadableCount: 0 });
    expect(attempts).toBe(2);
  });
});

describe("sweepStaleTemporaries", () => {
  test("missing and symlinked directories are left alone", async () => {
    const paths = await profile();
    expect(await sweepStaleTemporaries(join(paths.root, "absent"))).toBe(0);
    const target = join(paths.root, "target");
    await mkdir(target, { mode: 0o700 });
    const name = staleTemporary();
    await writeFile(join(target, name), "partial");
    await symlink(target, join(paths.root, "link"));
    expect(await sweepStaleTemporaries(join(paths.root, "link"))).toBe(0);
    expect(await readdir(target)).toEqual([name]);
    expect(await sweepStaleTemporaries(target)).toBe(1);
    expect(await readdir(target)).toEqual([]);
  });
});
