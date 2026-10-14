export type CommandState =
  "pending" | "acknowledged" | "conflicted" | "cancelled" | "failed";
export interface RetainedCommand<T> {
  id: string;
  input: T;
  state: "conflicted" | "cancelled" | "failed";
  message: string;
}
export interface CommandQueueSnapshot<T> {
  revision: number | null;
  pending: number;
  state: CommandState | null;
  retained: readonly RetainedCommand<T>[];
}
interface Lane<T> extends CommandQueueSnapshot<T> {
  tail: Promise<void>;
  blocked: boolean;
}
export class RevisionConflictError extends Error {}
/** The user declined a confirmation; nothing was written, so nothing is retained. */
export class CommandDeclinedError extends Error {}

/** One FIFO per aggregate; only acknowledged writes advance an active lane. */
export class RevisionCommandQueue<T> {
  private lanes = new Map<string, Lane<T>>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
  private lane(id: string): Lane<T> {
    let lane = this.lanes.get(id);
    if (!lane) {
      lane = {
        revision: null,
        pending: 0,
        state: null,
        retained: [],
        tail: Promise.resolve(),
        blocked: false,
      };
      this.lanes.set(id, lane);
    }
    return lane;
  }
  snapshot(id: string): CommandQueueSnapshot<T> {
    const { revision, pending, state, retained } = this.lane(id);
    return { revision, pending, state, retained };
  }
  hasUnsettledEdits(): boolean {
    return [...this.lanes.values()].some(
      (lane) => lane.pending > 0 || lane.retained.length > 0,
    );
  }
  observe(id: string, revision: number): void {
    const lane = this.lane(id);
    if (!lane.pending && (lane.revision === null || revision > lane.revision)) {
      lane.revision = revision;
      this.emit();
    }
  }
  /** Explicit review/discard only; reads and subsequent submissions never unblock a failure. */
  discardRetained(id: string): void {
    const lane = this.lane(id);
    if (lane.pending)
      throw new Error(
        "Wait for pending commands before resolving retained edits",
      );
    lane.retained = [];
    lane.blocked = false;
    lane.state = null;
    this.emit();
  }
  submit<R extends { revision: number }>(
    aggregateId: string,
    input: T,
    execute: (
      input: T,
      revision: number | null,
      commandId: string,
    ) => Promise<R>,
  ): Promise<R> {
    return this.enqueue(aggregateId, input, execute, false);
  }
  reapply<R extends { revision: number }>(
    aggregateId: string,
    retainedId: string,
    execute: (
      input: T,
      revision: number | null,
      commandId: string,
    ) => Promise<R>,
  ): Promise<R> {
    const lane = this.lane(aggregateId);
    const retained = lane.retained.find((item) => item.id === retainedId);
    if (lane.pending || !retained || retained.state === "failed")
      return Promise.reject(
        new Error(
          "Only a confirmed rejected or unsent edit can be reapplied after review",
        ),
      );
    lane.retained = lane.retained.filter((item) => item.id !== retainedId);
    return this.enqueue(aggregateId, retained.input, execute, true);
  }
  private enqueue<R extends { revision: number }>(
    aggregateId: string,
    input: T,
    execute: (
      input: T,
      revision: number | null,
      commandId: string,
    ) => Promise<R>,
    reviewed: boolean,
  ): Promise<R> {
    const lane = this.lane(aggregateId);
    const retainedInput = structuredClone(input);
    const commandId = crypto.randomUUID();
    lane.pending += 1;
    lane.state = "pending";
    this.emit();
    const result = lane.tail.then(() =>
      this.execute(lane, retainedInput, commandId, execute, reviewed),
    );
    lane.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async execute<R extends { revision: number }>(
    lane: Lane<T>,
    input: T,
    id: string,
    execute: (
      input: T,
      revision: number | null,
      commandId: string,
    ) => Promise<R>,
    reviewed: boolean,
  ): Promise<R> {
    const cancelled = lane.blocked && !reviewed;
    const stateBefore = lane.state;
    try {
      if (cancelled)
        throw new Error(
          "Not sent: an earlier command needs review. Edit retained.",
        );
      const result = await execute(input, lane.revision, id);
      lane.revision = result.revision;
      lane.state = "acknowledged";
      lane.blocked = lane.retained.length > 0;
      return result;
    } catch (error) {
      if (!cancelled && error instanceof CommandDeclinedError) {
        lane.state = stateBefore === "pending" ? null : stateBefore;
        throw error;
      }
      const state = cancelled
        ? "cancelled"
        : error instanceof RevisionConflictError
          ? "conflicted"
          : "failed";
      lane.retained = [
        ...lane.retained,
        {
          id,
          input,
          state,
          message: error instanceof Error ? error.message : "Command failed",
        },
      ];
      lane.state = state;
      lane.blocked = true;
      throw error;
    } finally {
      lane.pending -= 1;
      this.emit();
    }
  }
}
