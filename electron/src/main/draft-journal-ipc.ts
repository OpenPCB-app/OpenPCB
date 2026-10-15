import {
  DOCS_DRAFT_JOURNAL,
  registerRecordJournalIpc,
  type RecordJournalDeps,
} from "./record-journal-ipc.js";

export function registerDraftJournalIpc(deps: RecordJournalDeps): void {
  registerRecordJournalIpc(deps, DOCS_DRAFT_JOURNAL);
}
