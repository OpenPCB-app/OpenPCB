export interface DraftJournalRecord {
  readonly token: string;
  readonly value: string;
}

/** Opaque JSON records scoped by the native host to one profile and database. */
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
