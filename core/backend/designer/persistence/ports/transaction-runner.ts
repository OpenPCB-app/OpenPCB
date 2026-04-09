export interface TransactionRunner {
  runInTransaction<T>(work: () => Promise<T>): Promise<T>;
}
