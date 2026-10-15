import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import type { AtomicRecordStore } from "../../../src/core/backend/storage/atomic-record-store";
import type { DraftJournal } from "../../../src/core/contracts/app/draft-journal";
import {
  requireTrustedCredentialSender,
  type CredentialIpcRegistrar,
  type CredentialSender,
  type CredentialTrust,
} from "./credential-ipc.js";

export interface RecordJournalNamespace {
  readonly channel: "draft-journal" | "designer-recovery-journal";
  readonly directoryPrefix: "knowledge-drafts" | "designer-recovery";
  readonly unavailableMessage: string;
  readonly scopeUnavailableMessage: string;
  readonly sweepStaleTemporaries: boolean;
}

/** Docs behaviour, messages and directory are unchanged from the original draft-journal IPC. */
export const DOCS_DRAFT_JOURNAL: RecordJournalNamespace = {
  channel: "draft-journal",
  directoryPrefix: "knowledge-drafts",
  unavailableMessage: "Draft journal unavailable to this frame",
  scopeUnavailableMessage: "Draft journal database scope unavailable",
  sweepStaleTemporaries: false,
};

export const DESIGNER_RECOVERY_JOURNAL: RecordJournalNamespace = {
  channel: "designer-recovery-journal",
  directoryPrefix: "designer-recovery",
  unavailableMessage: "Designer recovery journal unavailable to this frame",
  scopeUnavailableMessage: "Designer recovery journal database scope unavailable",
  sweepStaleTemporaries: true,
};

export interface RecordJournalDeps {
  ipc: CredentialIpcRegistrar;
  trust: CredentialTrust;
  backendReady(): boolean;
  env(): { root?: string | undefined; dbPath?: string | undefined };
  realpath(path: string): string;
  createStore(directory: string): AtomicRecordStore;
  /** Deletes unpublished `*.json.<uuid>.tmp` files; returns how many were removed. */
  sweep?(directory: string): Promise<number>;
}

/** `${root}/${prefix}-${sha256(realpath(dbPath))}` */
export function journalDirectory(
  root: string,
  dbRealPath: string,
  ns: RecordJournalNamespace,
): string {
  // Renderer origins change with the ephemeral backend port; the canonical DB path does not.
  const scope = createHash("sha256").update(dbRealPath).digest("hex");
  return join(root, `${ns.directoryPrefix}-${scope}`);
}

const STALE_TEMPORARY = /^[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/;
const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/**
 * The app holds the single-instance lock, so a temporary left at open belongs to a killed
 * process and was never acknowledged. Symlinked or non-directory paths are left for the
 * store's own directory check to refuse.
 */
export async function sweepStaleTemporaries(
  directory: string,
  io: Pick<typeof fs, "lstat" | "readdir" | "unlink"> = fs,
): Promise<number> {
  try {
    if (!(await io.lstat(directory)).isDirectory()) return 0;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let removed = 0;
  for (const name of await io.readdir(directory)) {
    if (!STALE_TEMPORARY.test(name)) continue;
    try {
      await io.unlink(join(directory, name));
      removed++;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return removed;
}

export function registerRecordJournalIpc(
  deps: RecordJournalDeps,
  ns: RecordJournalNamespace,
): void {
  let cached: { directory: string; store: Promise<AtomicRecordStore> } | undefined;

  function open(directory: string): Promise<AtomicRecordStore> {
    if (cached?.directory === directory) return cached.store;
    const sweep = ns.sweepStaleTemporaries ? deps.sweep : undefined;
    const store = sweep
      ? sweep(directory).then(() => deps.createStore(directory))
      : Promise.resolve(deps.createStore(directory));
    const entry = { directory, store };
    cached = entry;
    // A failed sweep must be retried before the store is ever used.
    store.catch(() => {
      if (cached === entry) cached = undefined;
    });
    return store;
  }

  function authorized(event: CredentialSender): Promise<AtomicRecordStore> {
    try {
      requireTrustedCredentialSender(event, deps.trust);
    } catch {
      throw new Error(ns.unavailableMessage);
    }
    if (!deps.backendReady()) throw new Error(ns.unavailableMessage);
    const { root, dbPath } = deps.env();
    if (!root || !dbPath) throw new Error(ns.scopeUnavailableMessage);
    return open(journalDirectory(root, deps.realpath(dbPath), ns));
  }

  deps.ipc.handle(`${ns.channel}:read`, async (event, key) =>
    (await authorized(event)).read(key as string),
  );
  deps.ipc.handle(`${ns.channel}:write`, async (event, input) =>
    (await authorized(event)).write(input as Parameters<DraftJournal["write"]>[0]),
  );
  deps.ipc.handle(`${ns.channel}:remove`, async (event, input) =>
    (await authorized(event)).remove(input as Parameters<DraftJournal["remove"]>[0]),
  );
  deps.ipc.handle(`${ns.channel}:list`, async (event) =>
    (await authorized(event)).list(),
  );
}
