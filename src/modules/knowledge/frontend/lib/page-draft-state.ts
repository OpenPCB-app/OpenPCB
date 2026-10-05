import type { EditorContent, Page } from "../../shared/types";
import type { PageDraftJournal, DraftDurability } from "./page-draft-journal";
import type { RetainedPageDraft } from "./draft-recovery-content";

export type PageSaveStatus = "idle" | "pending" | "saving" | "saved" | "error";
export interface PageDraft {
  page: Page;
  title: string;
  content: EditorContent;
  status: PageSaveStatus;
  error: string | null;
  conflict: boolean;
  version: number;
  documentGeneration: number;
  durability: DraftDurability;
  durabilityError: string | null;
  ready: boolean;
  recovered: boolean;
}
export interface Pending<T> {
  value: T;
  version: number;
}
export interface Entry {
  snapshot: PageDraft;
  title?: Pending<string>;
  content?: Pending<EditorContent>;
  saving: boolean;
  suspended?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  journal?: PageDraftJournal;
}

export function recoveredState(
  entry: Entry,
  retained: RetainedPageDraft | null,
): Partial<PageDraft> {
  if (!retained) return { ready: true };
  const { page } = entry.snapshot;
  if (retained.pending.title)
    entry.title = { value: retained.pending.title.normalized, version: 1 };
  if (retained.pending.content)
    entry.content = { value: retained.pending.content, version: 1 };
  return {
    ready: true,
    recovered: true,
    title: retained.pending.title?.raw ?? page.title,
    content: retained.pending.content ?? page.content_json,
    version: 1,
    documentGeneration: 1,
    status: "error",
    conflict:
      retained.base.revision !== page.revision ||
      retained.base.updatedAt !== new Date(page.updated_at).toISOString(),
    error: "Recovered draft. Review it before explicitly retrying the save.",
  };
}
