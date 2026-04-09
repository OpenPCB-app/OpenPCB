import type { TransactionRunner } from "../ports/transaction-runner";

export class InMemoryTransactionRunner implements TransactionRunner {
  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}
