export interface DraftJournalRecord {
  readonly token: string;
  readonly value: string;
}

/**
 * Opaque JSON records scoped by the native host to one profile and database.
 * Two independent namespaces implement it: Docs drafts (`electronAPI.draftJournal`,
 * `knowledge-drafts-<dbhash>`) and Designer edit recovery (`electronAPI.designerRecoveryJournal`,
 * `designer-recovery-<dbhash>`). Neither can list or touch the other's records.
 */
export interface DraftJournal {
  read(key: string): Promise<DraftJournalRecord | null>;
  write(
    input: DraftJournalRecord & { key: string; expectedToken: string | null },
  ): Promise<DraftJournalRecord>;
  remove(input: { key: string; expectedToken: string }): Promise<boolean>;
  list(): Promise<{
    records: Array<{ key: string; token: string }>;
    unreadableCount: number;
  }>;
}
