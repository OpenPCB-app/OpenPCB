import type { EditorContent, Page } from "../../shared/types";
import { KnowledgeApiError, type KnowledgeApi } from "../hooks/useKnowledgeApi";
import type { DraftJournal } from "../../../../core/contracts/app/draft-journal";
import { PageDraftJournal } from "./page-draft-journal";
import { nativeDraftJournal } from "./native-draft-journal";
import {
  recoveredState,
  type PageDraft,
  type Entry,
  type Pending,
} from "./page-draft-state";
export type { PageSaveStatus, PageDraft } from "./page-draft-state";
import {
  parseRetainedPageDraft,
  type RetainedPageDraft,
} from "./draft-recovery-content";

export const normalizedTitle = (title: string): string =>
  title.trim() || "Untitled";
const token = (page: Page): string => new Date(page.updated_at).toISOString();
const sameContent = (a: EditorContent, b: EditorContent): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
export const OFFLINE_SAVE_ERROR =
  "You are offline. Your draft is retained; retry when you are back online.";
// Saves are still attempted offline: the backend is loopback and usually stays reachable.
const isOfflineFailure = (error: unknown): boolean =>
  error instanceof KnowledgeApiError &&
  error.status === 0 &&
  typeof navigator !== "undefined" &&
  navigator.onLine === false;

/** Pending fields survive navigation; the optional native journal also survives renderer restart. */
export class PageSaveCoordinator {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private titleSaveListeners = new Set<() => void>();
  private requestIds = new Set<string>();
  private pageSubscribers = new Map<string, number>();
  private inactivePages = new Set<string>();
  private preparing = new Map<string, Promise<boolean>>();

  constructor(
    private api: KnowledgeApi,
    private journal?: DraftJournal,
  ) {}

  prepareRemote(
    page: Page,
    observedVersion = this.version(page.id),
  ): Promise<boolean> {
    if (!this.journal || this.entries.has(page.id))
      return Promise.resolve(this.acceptRemote(page, observedVersion));
    const existing = this.preparing.get(page.id);
    if (existing) return existing.then(() => this.acceptRemote(page));
    const preparation = this.restore(page, observedVersion).finally(() =>
      this.preparing.delete(page.id),
    );
    this.preparing.set(page.id, preparation);
    return preparation;
  }

  private async restore(page: Page, observedVersion: number): Promise<boolean> {
    const journal = new PageDraftJournal(this.journal, page.id, () => {
      const entry = this.entries.get(page.id);
      if (entry) {
        this.update(entry, {
          durability: journal.status,
          durabilityError: journal.error,
        });
        this.releaseCleanPage(page.id);
      }
    });
    let retained: RetainedPageDraft | null = null;
    try {
      const record = await journal.load();
      if (record) retained = parseRetainedPageDraft(record.value, page);
    } catch (error) {
      journal.block(error);
    }
    if (!this.acceptRemote(page, observedVersion)) return false;
    const entry = this.requireEntry(page.id);
    entry.journal = journal;
    this.update(entry, {
      durability: journal.status,
      durabilityError: journal.error,
      ...recoveredState(entry, retained),
    });
    return true;
  }

  safeToClose(): boolean {
    return [...this.entries].every(
      ([id, entry]) =>
        entry.snapshot.durability === "durable" ||
        (!this.isDirty(id) && entry.snapshot.durability !== "writing"),
    );
  }

  private retain(entry: Entry): void {
    const { page } = entry.snapshot;
    const record: RetainedPageDraft = {
      schemaVersion: 1,
      pageId: page.id,
      workspaceId: page.workspace_id,
      base: {
        revision: page.revision,
        updatedAt: token(page),
        contentEngine: page.content_engine,
        contentVersion: page.content_version,
      },
      pending: {
        ...(entry.title
          ? {
              title: {
                raw: entry.snapshot.title,
                normalized: entry.title.value,
              },
            }
          : {}),
        ...(entry.content ? { content: entry.content.value } : {}),
      },
    };
    entry.journal?.set(
      entry.title || entry.content ? JSON.stringify(record) : null,
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeTitleSaves = (listener: () => void): (() => void) => {
    this.titleSaveListeners.add(listener);
    return () => {
      this.titleSaveListeners.delete(listener);
    };
  };

  subscribePage = (id: string | null, listener: () => void): (() => void) => {
    const unsubscribe = this.subscribe(listener);
    if (id) {
      this.inactivePages.delete(id);
      this.pageSubscribers.set(id, (this.pageSubscribers.get(id) ?? 0) + 1);
    }
    return () => {
      unsubscribe();
      if (!id) return;
      const remaining = (this.pageSubscribers.get(id) ?? 1) - 1;
      if (remaining) this.pageSubscribers.set(id, remaining);
      else {
        this.pageSubscribers.delete(id);
        this.inactivePages.add(id);
        this.releaseCleanPage(id);
      }
    };
  };

  snapshot = (id: string | null): PageDraft | null =>
    id ? (this.entries.get(id)?.snapshot ?? null) : null;
  version = (id: string): number => this.snapshot(id)?.version ?? 0;
  isDirty = (id: string): boolean => {
    const entry = this.entries.get(id);
    return !!entry && (!!entry.title || !!entry.content || entry.saving);
  };
  isOwnRequest = (id?: string): boolean => !!id && this.requestIds.has(id);

  acceptRemote(page: Page, observedVersion = this.version(page.id)): boolean {
    const entry = this.entries.get(page.id);
    if (!entry) {
      this.entries.set(page.id, {
        saving: false,
        snapshot: {
          page,
          title: page.title,
          content: page.content_json,
          status: "idle",
          error: null,
          conflict: false,
          version: 0,
          documentGeneration: 0,
          durability: this.journal ? "loading" : "volatile",
          durabilityError: null,
          ready: !this.journal,
          recovered: false,
        },
      });
      this.emit();
      return true;
    }
    if (
      entry.snapshot.version !== observedVersion ||
      page.revision < entry.snapshot.page.revision
    )
      return false;
    if (this.isDirty(page.id)) {
      if (
        token(page) !== token(entry.snapshot.page) ||
        page.revision > entry.snapshot.page.revision
      )
        this.remoteChanged(page.id);
      return false;
    }
    const changed =
      !sameContent(page.content_json, entry.snapshot.content) ||
      page.content_engine !== entry.snapshot.page.content_engine;
    this.update(entry, {
      page,
      title: page.title,
      content: page.content_json,
      conflict: false,
      error: null,
      status: "idle",
      documentGeneration: entry.snapshot.documentGeneration + Number(changed),
    });
    return true;
  }

  // After an SSE outage events may have been missed; flag a conflict only if the server really advanced past our base.
  async verifyAfterReconnect(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || !this.isDirty(id)) return;
    try {
      const page = await this.api.getPage(id);
      if (page) this.acceptRemote(page);
    } catch {
      // Still unreachable: the next reconnect or save attempt reports it.
    }
  }

  remoteChanged(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Clean pages have nothing to protect: invalidate in-flight fetches and let the caller refresh.
    if (!this.isDirty(id)) {
      this.update(entry, { version: entry.snapshot.version + 1 });
      return;
    }
    this.cancelTimer(entry);
    this.update(entry, {
      version: entry.snapshot.version + 1,
      conflict: true,
      status: entry.saving ? "saving" : "error",
      error: "This page changed remotely. Your draft is retained.",
    });
  }

  setTitle(id: string, title: string): void {
    const entry = this.requireEntry(id);
    const version = entry.snapshot.version + 1;
    entry.title = { value: normalizedTitle(title), version };
    if (!entry.saving && entry.title.value === entry.snapshot.page.title)
      entry.title = undefined;
    this.update(entry, { title, version });
    this.retain(entry);
    this.schedule(entry, 1000);
  }

  finishTitle(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.update(entry, { title: normalizedTitle(entry.snapshot.title) });
    this.flush(id);
  }

  setContent(id: string, content: EditorContent): void {
    const entry = this.requireEntry(id);
    if (sameContent(content, entry.snapshot.content)) return;
    const version = entry.snapshot.version + 1;
    entry.content = { value: content, version };
    if (!entry.saving && sameContent(content, entry.snapshot.page.content_json))
      entry.content = undefined;
    this.update(entry, { content, version });
    this.retain(entry);
    this.schedule(entry, 500);
  }

  flush(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.cancelTimer(entry);
    void this.save(entry);
  }

  retry(id: string): void {
    const entry = this.requireEntry(id);
    if (entry.suspended || entry.snapshot.conflict || entry.saving) return;
    entry.journal?.retry();
    this.update(entry, { error: null, status: "pending", recovered: false });
    this.flush(id);
  }

  async reload(id: string, keepDraft: boolean): Promise<boolean> {
    const entry = this.requireEntry(id);
    if (entry.suspended || entry.saving) return false;
    const version = entry.snapshot.version;
    try {
      const page = await this.api.getPage(id);
      if (!page)
        throw new Error("This page is unavailable. Your draft is retained.");
      if (entry.suspended || entry.saving || entry.snapshot.version !== version)
        return false;
      if (!keepDraft) {
        entry.title = undefined;
        entry.content = undefined;
      }
      const content = entry.content?.value ?? page.content_json;
      const changed = !sameContent(content, entry.snapshot.content);
      this.update(entry, {
        page,
        title: entry.title?.value ?? page.title,
        content,
        conflict: false,
        error: null,
        recovered: false,
        version: version + 1,
        status: keepDraft && this.isDirty(id) ? "pending" : "idle",
        documentGeneration:
          entry.snapshot.documentGeneration + Number(!keepDraft || changed),
      });
      this.retain(entry);
      entry.journal?.retry();
      if (keepDraft) this.flush(id);
      return true;
    } catch (error) {
      this.update(entry, {
        error:
          error instanceof Error
            ? error.message
            : "Could not reload. Your draft is retained.",
      });
      return false;
    }
  }

  private releaseCleanPage(id: string): void {
    if (
      this.inactivePages.has(id) &&
      !this.isDirty(id) &&
      this.snapshot(id)?.durability !== "writing" &&
      this.snapshot(id)?.durability !== "error" &&
      !this.snapshot(id)?.conflict
    ) {
      this.entries.delete(id);
      this.inactivePages.delete(id);
    }
  }

  private requireEntry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("Page must be loaded before editing");
    return entry;
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
  private update(entry: Entry, patch: Partial<PageDraft>): void {
    entry.snapshot = { ...entry.snapshot, ...patch };
    this.emit();
  }
  private cancelTimer(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  private schedule(entry: Entry, delay: number): void {
    this.cancelTimer(entry);
    if (!this.isDirty(entry.snapshot.page.id) && !entry.snapshot.conflict) {
      this.update(entry, { status: "idle", error: null });
      return;
    }
    if (entry.snapshot.error || entry.snapshot.conflict) return;
    this.update(entry, {
      status: entry.saving
        ? "saving"
        : this.isDirty(entry.snapshot.page.id)
          ? "pending"
          : "idle",
    });
    if (this.isDirty(entry.snapshot.page.id))
      entry.timer = setTimeout(() => void this.save(entry), delay);
  }

  private async save(entry: Entry): Promise<void> {
    if (
      entry.suspended ||
      entry.saving ||
      entry.snapshot.error ||
      entry.snapshot.conflict
    )
      return;
    const title = entry.title;
    const content = title ? undefined : entry.content;
    if (!title && !content) return;
    this.cancelTimer(entry);
    entry.saving = true;
    const id = entry.snapshot.page.id;
    const requestId = crypto.randomUUID();
    this.requestIds.add(requestId);
    if (this.requestIds.size > 256)
      this.requestIds.delete(this.requestIds.values().next().value!);
    this.update(entry, { status: "saving" });
    try {
      if (entry.journal) await entry.journal.flush();
      if (entry.suspended || entry.snapshot.error || entry.snapshot.conflict)
        return;
      const options = {
        requestId,
        ifUnmodifiedSince: token(entry.snapshot.page),
      };
      const page = title
        ? await this.api.updatePageMeta(id, { title: title.value }, options)
        : (await this.api.updatePageContent(id, content!.value, options))?.page;
      if (!page || page.id !== id)
        throw new Error("Save was not acknowledged. Your draft is retained.");
      this.acknowledge(entry, page, title, content);
      if (title) this.titleSaveListeners.forEach((listener) => listener());
    } catch (error) {
      const conflict =
        error instanceof KnowledgeApiError && error.status === 409;
      this.update(entry, {
        status: "error",
        conflict: entry.snapshot.conflict || conflict,
        error: conflict
          ? "This page changed remotely. Your draft is retained."
          : isOfflineFailure(error)
            ? OFFLINE_SAVE_ERROR
            : "Could not save. Your draft is retained; retry when the service is available.",
      });
    } finally {
      entry.saving = false;
      if (!entry.snapshot.error && !entry.snapshot.conflict) {
        this.update(entry, { status: this.isDirty(id) ? "pending" : "saved" });
        if (this.isDirty(id)) void this.save(entry);
      } else this.update(entry, { status: "error" });
      this.releaseCleanPage(id);
    }
  }

  private acknowledge(
    entry: Entry,
    page: Page,
    title?: Pending<string>,
    content?: Pending<EditorContent>,
  ): void {
    if (entry.suspended) return;
    const current = entry.snapshot.page;
    // Metadata acknowledgements carry a potentially stale server body.
    const acknowledged = {
      ...current,
      title: page.title,
      icon: page.icon,
      properties_json: page.properties_json,
      updated_at: page.updated_at,
      revision: page.revision,
      ...(content
        ? {
            content_json: content.value,
            content_engine: content.value.engine,
            content_version: content.value.version,
          }
        : {}),
    };
    if (title && entry.title?.version === title.version)
      entry.title = undefined;
    if (content && entry.content?.version === content.version)
      entry.content = undefined;
    this.update(entry, {
      page: acknowledged,
      version: entry.snapshot.version + 1,
      title: entry.title ? entry.snapshot.title : acknowledged.title,
      content: entry.content?.value ?? acknowledged.content_json,
    });
    this.retain(entry);
  }

  suspendDeletion(ids: readonly string[]): () => void {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.suspended = true;
      this.cancelTimer(entry);
      this.update(entry, {
        status: "error",
        error:
          "This page is being deleted. Any pending draft remains retained.",
      });
    }
    // A failed delete restores explicit retry, never automatic replay of pending writes.
    return () => {
      for (const id of ids) {
        const entry = this.entries.get(id);
        if (entry) entry.suspended = false;
      }
    };
  }
}

const coordinators = new Map<string, PageSaveCoordinator>();
const anonymousCoordinators = new WeakMap<KnowledgeApi, PageSaveCoordinator>();
export function getPageSaveCoordinator(api: KnowledgeApi): PageSaveCoordinator {
  const key = api.draftNamespace;
  const existing = key ? coordinators.get(key) : anonymousCoordinators.get(api);
  if (existing) return existing;
  const coordinator = new PageSaveCoordinator(api, nativeDraftJournal());
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", (event) => {
      if (!coordinator.safeToClose()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  if (key) coordinators.set(key, coordinator);
  else anonymousCoordinators.set(api, coordinator);
  return coordinator;
}
