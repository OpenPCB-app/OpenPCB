export type CommandState =
  | "pending"
  | "acknowledged"
  | "conflicted"
  | "cancelled"
  | "failed"
  | "unknown";
export type RetainedState = "conflicted" | "cancelled" | "failed" | "unknown";
export interface RetainedCommand<T> {
  /** Stable across reapply and same-id retry (the designer's recovery record id). */
  id: string;
  /** The id a same-id retry must reuse: the last attempt actually sent. */
  commandId: string;
  input: T;
  state: RetainedState;
  message: string;
  origin: "session" | "recovered";
  /** Opaque exact sent envelope; a same-id retry resends it unchanged. */
  attempt?: unknown;
}
export interface CommandQueueSnapshot<T> {
  revision: number | null;
  pending: number;
  state: CommandState | null;
  retained: readonly RetainedCommand<T>[];
}
export interface QueueAck {
  revision: number | null;
}
export type QueueExecute<T, R> = (
  input: T,
  revision: number | null,
  commandId: string,
  attempt?: unknown,
) => Promise<R>;
/** "unknown-only": form surfaces keep definitive failures themselves; only an unknown outcome blocks. */
export type RetainPolicy = "all" | "unknown-only";
export interface SubmitOptions {
  commandId?: string;
  retainPolicy?: RetainPolicy;
}
export interface QueueOptions {
  /** Awaited before each item decides whether its lane is blocked. */
  gate?: () => Promise<void>;
  /** State for an error of no known class; "failed" is the pre-recovery behaviour. */
  defaultUnclassified?: "failed" | "unknown";
}
interface Lane<T> extends CommandQueueSnapshot<T> {
  tail: Promise<void>;
  blocked: boolean;
}
interface Job<T> {
  input: T;
  retainedId: string;
  commandId: string;
  attempt: unknown;
  origin: RetainedCommand<T>["origin"];
  reviewed: boolean;
  /** Re-sends an attempt whose outcome is unknown; a not-sent retry leaves it unknown. */
  sameId: boolean;
  policy: RetainPolicy;
}

export class RevisionConflictError extends Error {}
/** The user declined a confirmation; nothing was written, so nothing is retained. */
export class CommandDeclinedError extends Error {}
/** The server definitively did not apply the command. */
export class CommandRejectedError extends Error {}
/** The command was definitively never sent. */
export class CommandNotSentError extends Error {}
/** The command may have applied; only evidence or a same-id retry can settle it. */
export class AcknowledgementUnknownError extends Error {}
/** Retained edits block the lane; nothing ran and nothing is retained. */
export class LaneBlockedError extends Error {}

const BLOCKED_MESSAGE = "Not sent: an earlier command needs review.";

function advance(lane: { revision: number | null }, revision: number | null) {
  if (typeof revision !== "number") return;
  lane.revision =
    lane.revision === null ? revision : Math.max(lane.revision, revision);
}

/** The coordinator attaches the id and envelope it actually sent to send errors. */
function sentAttempt(error: unknown): {
  commandId?: string;
  attempt?: unknown;
} {
  if (typeof error !== "object" || error === null) return {};
  const { attemptCommandId, attempt } = error as {
    attemptCommandId?: unknown;
    attempt?: unknown;
  };
  return {
    commandId:
      typeof attemptCommandId === "string" ? attemptCommandId : undefined,
    attempt,
  };
}

/** One FIFO per aggregate; only acknowledged writes advance an active lane. */
export class RevisionCommandQueue<T> {
  private lanes = new Map<string, Lane<T>>();
  private listeners = new Set<() => void>();
  constructor(private readonly options: QueueOptions = {}) {}

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
  isBlocked(id: string): boolean {
    return this.lanes.get(id)?.blocked ?? false;
  }
  aggregates(): string[] {
    return [...this.lanes.keys()];
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
  submit<R extends QueueAck>(
    aggregateId: string,
    input: T,
    execute: QueueExecute<T, R>,
    options: SubmitOptions = {},
  ): Promise<R> {
    const commandId = options.commandId ?? crypto.randomUUID();
    return this.enqueue(aggregateId, execute, {
      input: structuredClone(input),
      retainedId: commandId,
      commandId,
      attempt: undefined,
      origin: "session",
      reviewed: false,
      sameId: false,
      policy: options.retainPolicy ?? "all",
    });
  }
  /** Re-sends a verified conflict or an unsent edit under a fresh command id. */
  reapply<R extends QueueAck>(
    aggregateId: string,
    retainedId: string,
    execute: QueueExecute<T, R>,
  ): Promise<R> {
    const item = this.claim(
      aggregateId,
      retainedId,
      (state) => state === "conflicted" || state === "cancelled",
    );
    if (!item)
      return Promise.reject(
        new Error(
          "Only a confirmed rejected or unsent edit can be reapplied after review",
        ),
      );
    return this.enqueue(aggregateId, execute, {
      input: item.input,
      retainedId: item.id,
      commandId: crypto.randomUUID(),
      attempt: undefined,
      origin: item.origin,
      reviewed: true,
      sameId: false,
      policy: "all",
    });
  }
  /** Re-sends an unknown-outcome attempt unchanged; the server's id guard keeps it at-most-once. */
  retrySameId<R extends QueueAck>(
    aggregateId: string,
    retainedId: string,
    execute: QueueExecute<T, R>,
  ): Promise<R> {
    const item = this.claim(
      aggregateId,
      retainedId,
      (state) => state === "unknown",
    );
    if (!item)
      return Promise.reject(
        new Error(
          "Only an edit with an unknown outcome can be retried with its original command ID",
        ),
      );
    return this.enqueue(aggregateId, execute, {
      input: item.input,
      retainedId: item.id,
      commandId: item.commandId,
      attempt: item.attempt,
      origin: item.origin,
      reviewed: true,
      sameId: true,
      policy: "all",
    });
  }
  /** Keeps an edit that was refused before submission (e.g. its journal write failed). */
  retain(
    aggregateId: string,
    input: T,
    state: "cancelled",
    message: string,
    extra: Partial<RetainedCommand<T>> = {},
  ): string {
    const lane = this.lane(aggregateId);
    const id = extra.id ?? crypto.randomUUID();
    const item: RetainedCommand<T> = {
      id,
      commandId: extra.commandId ?? id,
      input: structuredClone(input),
      state,
      message,
      origin: extra.origin ?? "session",
    };
    if (extra.attempt !== undefined) item.attempt = extra.attempt;
    lane.retained = [...lane.retained, item];
    lane.state = state;
    lane.blocked = true;
    this.emit();
    return id;
  }
  /** Adds recovered items; items already retained under the same id are ignored. */
  adopt(aggregateId: string, items: readonly RetainedCommand<T>[]): void {
    const lane = this.lane(aggregateId);
    const known = new Set(lane.retained.map((item) => item.id));
    const fresh = items.filter((item) => !known.has(item.id));
    const last = fresh[fresh.length - 1];
    if (!last) return;
    lane.retained = [...lane.retained, ...fresh];
    lane.state = last.state;
    lane.blocked = true;
    this.emit();
  }
  /** Applies evidence gathered after the fact; a missing item (already discarded) is a no-op. */
  resolveRetained(
    aggregateId: string,
    retainedId: string,
    resolution:
      | { state: "acknowledged"; revision: number }
      | { state: "conflicted" | "failed"; message: string },
  ): void {
    const lane = this.lanes.get(aggregateId);
    const item = lane?.retained.find((entry) => entry.id === retainedId);
    if (!lane || !item) return;
    if (resolution.state === "acknowledged") {
      lane.retained = lane.retained.filter((entry) => entry !== item);
      advance(lane, resolution.revision);
      lane.blocked = lane.retained.length > 0;
    } else {
      const { state, message } = resolution;
      lane.retained = lane.retained.map((entry) =>
        entry === item ? { ...entry, state, message } : entry,
      );
    }
    lane.state = resolution.state;
    this.emit();
  }
  removeRetained(aggregateId: string, retainedId: string): void {
    const lane = this.lane(aggregateId);
    if (lane.pending)
      throw new Error(
        "Wait for pending commands before resolving retained edits",
      );
    const next = lane.retained.filter((entry) => entry.id !== retainedId);
    if (next.length === lane.retained.length) return;
    lane.retained = next;
    lane.blocked = next.length > 0;
    if (!next.length) lane.state = null;
    this.emit();
  }
  /** Runs an external apply in FIFO order; refused while blocked, never retained. */
  exclusive<R extends QueueAck>(
    aggregateId: string,
    run: (revision: number | null) => Promise<R>,
  ): Promise<R> {
    return this.reserve(aggregateId, async (lane) => {
      let stateBefore = lane.state;
      let ran = false;
      try {
        if (this.options.gate) await this.passGate();
        stateBefore = lane.state;
        if (lane.blocked) throw new LaneBlockedError(BLOCKED_MESSAGE);
        ran = true;
        const result = await run(lane.revision);
        lane.revision = result.revision;
        lane.state = "acknowledged";
        return result;
      } catch (error) {
        // The run may have moved the head by an unknown amount; the next edit reads it.
        if (ran) lane.revision = null;
        lane.state = stateBefore === "pending" ? null : stateBefore;
        throw error;
      } finally {
        lane.pending -= 1;
        this.emit();
      }
    });
  }
  private claim(
    aggregateId: string,
    retainedId: string,
    allowed: (state: RetainedState) => boolean,
  ): RetainedCommand<T> | null {
    const lane = this.lane(aggregateId);
    const item = lane.retained.find((entry) => entry.id === retainedId);
    if (lane.pending || !item || !allowed(item.state)) return null;
    lane.retained = lane.retained.filter((entry) => entry !== item);
    return item;
  }
  private enqueue<R extends QueueAck>(
    aggregateId: string,
    execute: QueueExecute<T, R>,
    job: Job<T>,
  ): Promise<R> {
    return this.reserve(aggregateId, (lane) =>
      this.execute(lane, job, execute),
    );
  }
  /** Reserves the slot in the calling tick, so an observation cannot rebase it. */
  private reserve<R>(
    aggregateId: string,
    run: (lane: Lane<T>) => Promise<R>,
  ): Promise<R> {
    const lane = this.lane(aggregateId);
    lane.pending += 1;
    lane.state = "pending";
    this.emit();
    const result = lane.tail.then(() => run(lane));
    lane.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async passGate(): Promise<void> {
    try {
      await this.options.gate?.();
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "command queue unavailable";
      throw new CommandNotSentError(`Not sent: ${reason}`);
    }
  }
  private async execute<R extends QueueAck>(
    lane: Lane<T>,
    job: Job<T>,
    execute: QueueExecute<T, R>,
  ): Promise<R> {
    let cancelled = false;
    let stateBefore = lane.state;
    try {
      if (this.options.gate) await this.passGate();
      // Evaluated after the gate: items adopted meanwhile block earlier submissions too.
      cancelled = lane.blocked && !job.reviewed;
      stateBefore = lane.state;
      if (cancelled)
        throw job.policy === "unknown-only"
          ? new LaneBlockedError(BLOCKED_MESSAGE)
          : new CommandNotSentError(`${BLOCKED_MESSAGE} Edit retained.`);
      const result = await execute(
        job.input,
        lane.revision,
        job.commandId,
        job.attempt,
      );
      advance(lane, result.revision);
      lane.state = "acknowledged";
      lane.blocked = lane.retained.length > 0;
      return result;
    } catch (error) {
      const state = cancelled ? "cancelled" : this.classify(error, job);
      if (
        state === null ||
        (job.policy === "unknown-only" && state !== "unknown")
      ) {
        lane.state = stateBefore === "pending" ? null : stateBefore;
        throw error;
      }
      lane.retained = [...lane.retained, this.retained(job, error, state)];
      lane.state = state;
      lane.blocked = true;
      throw error;
    } finally {
      lane.pending -= 1;
      this.emit();
    }
  }
  private classify(error: unknown, job: Job<T>): RetainedState | null {
    if (error instanceof CommandDeclinedError) return null;
    if (error instanceof RevisionConflictError) return "conflicted";
    if (error instanceof CommandRejectedError) return "failed";
    // An unsent same-id retry leaves the original attempt's outcome unknown.
    if (error instanceof CommandNotSentError)
      return job.sameId ? "unknown" : "cancelled";
    if (error instanceof AcknowledgementUnknownError) return "unknown";
    return this.options.defaultUnclassified ?? "failed";
  }
  private retained(
    job: Job<T>,
    error: unknown,
    state: RetainedState,
  ): RetainedCommand<T> {
    const sent = sentAttempt(error);
    const item: RetainedCommand<T> = {
      id: job.retainedId,
      commandId: sent.commandId ?? job.commandId,
      input: job.input,
      state,
      message: error instanceof Error ? error.message : "Command failed",
      origin: job.origin,
    };
    const attempt = sent.attempt ?? job.attempt;
    if (attempt !== undefined) item.attempt = attempt;
    return item;
  }
}
