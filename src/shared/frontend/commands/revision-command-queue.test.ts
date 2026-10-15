import { describe, expect, it, vi } from "vitest";
import {
  AcknowledgementUnknownError,
  CommandDeclinedError,
  CommandNotSentError,
  CommandRejectedError,
  LaneBlockedError,
  RevisionCommandQueue,
  RevisionConflictError,
  type QueueAck,
  type QueueExecute,
  type RetainedCommand,
  type RetainedState,
} from "./revision-command-queue";

type Input = { op: string };
type Execute = QueueExecute<Input, QueueAck>;
type ExclusiveRun = (revision: number | null) => Promise<QueueAck>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const ack = (revision: number | null): QueueAck => ({ revision });
const ok = (revision: number | null) => vi.fn<Execute>(async () => ack(revision));
const exclusiveOk = (revision: number | null) =>
  vi.fn<ExclusiveRun>(async () => ack(revision));
const fail = (error: unknown) =>
  vi.fn<Execute>(async () => {
    throw error;
  });
const tick = () => new Promise<void>((done) => setTimeout(done, 0));
const states = (queue: RevisionCommandQueue<Input>, lane = "a") =>
  queue.snapshot(lane).retained.map((item) => item.state);
const recovered = (
  id: string,
  state: RetainedState,
): RetainedCommand<Input> => ({
  id,
  commandId: id,
  input: { op: id },
  state,
  message: `recovered ${state}`,
  origin: "recovered",
});
async function retainedAs(
  queue: RevisionCommandQueue<Input>,
  error: Error,
  commandId = "c1",
) {
  await expect(
    queue.submit("a", { op: "x" }, fail(error), { commandId }),
  ).rejects.toBe(error);
}

describe("error classification", () => {
  it.each([
    ["RevisionConflictError", new RevisionConflictError("c"), "conflicted"],
    ["CommandRejectedError", new CommandRejectedError("r"), "failed"],
    ["CommandNotSentError", new CommandNotSentError("n"), "cancelled"],
    ["AcknowledgementUnknownError", new AcknowledgementUnknownError("u"), "unknown"],
  ] as const)("%s is retained as %s and blocks the lane", async (_, error, state) => {
    const queue = new RevisionCommandQueue<Input>();
    await retainedAs(queue, error);
    expect(states(queue)).toEqual([state]);
    expect(queue.snapshot("a").state).toBe(state);
    expect(queue.isBlocked("a")).toBe(true);
  });

  it("a declined confirmation is neither retained nor blocking", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const error = new CommandDeclinedError("declined");
    await expect(queue.submit("a", { op: "x" }, fail(error))).rejects.toBe(
      error,
    );
    expect(queue.snapshot("a")).toMatchObject({ state: null, retained: [] });
    expect(queue.isBlocked("a")).toBe(false);
  });

  it("an unclassified error is failed by default and unknown when configured", async () => {
    const legacy = new RevisionCommandQueue<Input>();
    await retainedAs(legacy, new Error("boom"));
    expect(states(legacy)).toEqual(["failed"]);
    const recovering = new RevisionCommandQueue<Input>({
      defaultUnclassified: "unknown",
    });
    await retainedAs(recovering, new Error("boom"));
    expect(states(recovering)).toEqual(["unknown"]);
    await expect(recovering.submit("b", { op: "x" }, fail("bare"))).rejects.toBe(
      "bare",
    );
    expect(recovering.snapshot("b").retained[0]?.message).toBe("Command failed");
  });

  it("retains the submitted id, the last id actually sent and its envelope", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const attempt = { commandId: "c2", baseRevision: 4, issuedAt: 1 };
    const input = { op: "x" };
    const error = Object.assign(new AcknowledgementUnknownError("lost"), {
      attemptCommandId: "c2",
      attempt,
    });
    const submitted = queue.submit("a", input, fail(error), {
      commandId: "c1",
    });
    input.op = "mutated after submit";
    await expect(submitted).rejects.toBe(error);
    expect(queue.snapshot("a").retained).toEqual([
      {
        id: "c1",
        commandId: "c2",
        input: { op: "x" },
        state: "unknown",
        message: "lost",
        origin: "session",
        attempt,
      },
    ]);
  });
});

describe("ordering and revisions", () => {
  it("runs one item at a time in submission order when responses resolve out of order", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const first = deferred<QueueAck>();
    const second = deferred<QueueAck>();
    const calls: string[] = [];
    const run =
      (response: Promise<QueueAck>): Execute =>
      async (input, revision) => {
        calls.push(`${input.op}@${revision}`);
        return response;
      };
    const a = queue.submit("a", { op: "1" }, run(first.promise));
    const b = queue.submit("a", { op: "2" }, run(second.promise));
    const other = queue.submit("b", { op: "b" }, run(Promise.resolve(ack(40))));
    expect(queue.snapshot("a").pending).toBe(2);
    second.resolve(ack(9));
    await other;
    await tick();
    expect(calls).toEqual(["1@null", "b@null"]);
    first.resolve(ack(5));
    await Promise.all([a, b]);
    expect(calls).toEqual(["1@null", "b@null", "2@5"]);
    expect(queue.snapshot("a")).toMatchObject({
      revision: 9,
      pending: 0,
      state: "acknowledged",
    });
  });

  it("acknowledgements only move the lane revision forward", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const revisions: (number | null)[] = [];
    for (const revision of [5, 3, null, 7]) {
      await queue.submit("a", { op: "x" }, ok(revision));
      revisions.push(queue.snapshot("a").revision);
    }
    expect(revisions).toEqual([5, 5, 5, 7]);
  });

  it("an observation during a reserved slot never changes the revision it executes with", async () => {
    const gate = deferred<void>();
    const queue = new RevisionCommandQueue<Input>({ gate: () => gate.promise });
    queue.observe("a", 10);
    const execute = ok(11);
    const submitted = queue.submit("a", { op: "x" }, execute);
    expect(queue.snapshot("a").pending).toBe(1);
    queue.observe("a", 20);
    expect(queue.snapshot("a").revision).toBe(10);
    gate.resolve();
    await submitted;
    expect(execute.mock.calls[0]?.[1]).toBe(10);
    expect(queue.snapshot("a").revision).toBe(11);
    queue.observe("a", 20);
    expect(queue.snapshot("a").revision).toBe(20);
  });
});

describe("gate", () => {
  it("cancels an item reserved before the gate opens once adoption blocks its lane", async () => {
    const gate = deferred<void>();
    const queue = new RevisionCommandQueue<Input>({ gate: () => gate.promise });
    const execute = ok(1);
    const submitted = queue.submit("a", { op: "x" }, execute);
    const exclusiveRun = exclusiveOk(2);
    const exclusive = queue.exclusive("a", exclusiveRun);
    queue.adopt("a", [recovered("r1", "unknown")]);
    gate.resolve();
    await expect(submitted).rejects.toBeInstanceOf(CommandNotSentError);
    await expect(exclusive).rejects.toBeInstanceOf(LaneBlockedError);
    expect(execute).not.toHaveBeenCalled();
    expect(exclusiveRun).not.toHaveBeenCalled();
    expect(states(queue)).toEqual(["unknown", "cancelled"]);
  });

  it("a failing gate means not sent", async () => {
    const queue = new RevisionCommandQueue<Input>({
      gate: () => Promise.reject(new Error("hydrate crashed")),
    });
    const execute = ok(1);
    await expect(queue.submit("a", { op: "x" }, execute)).rejects.toThrow(
      "Not sent: hydrate crashed",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(states(queue)).toEqual(["cancelled"]);
    queue.observe("b", 7);
    const run = exclusiveOk(8);
    await expect(queue.exclusive("b", run)).rejects.toBeInstanceOf(
      CommandNotSentError,
    );
    expect(run).not.toHaveBeenCalled();
    expect(queue.snapshot("b")).toMatchObject({ revision: 7, retained: [] });
  });
});

describe("explicit re-send", () => {
  it("retrySameId resends an unknown attempt with its command id and envelope", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const attempt = { commandId: "c1", baseRevision: 7, issuedAt: 1 };
    await retainedAs(
      queue,
      Object.assign(new AcknowledgementUnknownError("lost"), { attempt }),
    );
    queue.observe("a", 9);
    const execute = ok(8);
    await queue.retrySameId("a", "c1", execute);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]).toEqual([{ op: "x" }, 9, "c1", attempt]);
    expect(execute.mock.calls[0]?.[3]).toBe(attempt);
    expect(queue.snapshot("a")).toMatchObject({ revision: 9, retained: [] });
    expect(queue.isBlocked("a")).toBe(false);
  });

  it.each(["conflicted", "failed", "cancelled"] as const)(
    "retrySameId refuses a %s edit",
    async (state) => {
      const queue = new RevisionCommandQueue<Input>();
      queue.adopt("a", [recovered("r1", state)]);
      const execute = ok(1);
      await expect(queue.retrySameId("a", "r1", execute)).rejects.toThrow(
        "unknown outcome",
      );
      expect(execute).not.toHaveBeenCalled();
      expect(states(queue)).toEqual([state]);
    },
  );

  it("a same-id retry that was not sent stays unknown with the original attempt", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const attempt = { commandId: "c1", baseRevision: 7, issuedAt: 1 };
    await retainedAs(
      queue,
      Object.assign(new AcknowledgementUnknownError("lost"), { attempt }),
    );
    await expect(
      queue.retrySameId("a", "c1", fail(new CommandNotSentError("journal down"))),
    ).rejects.toThrow("journal down");
    expect(queue.snapshot("a").retained).toEqual([
      expect.objectContaining({
        id: "c1",
        commandId: "c1",
        state: "unknown",
        attempt,
      }),
    ]);
    await expect(queue.reapply("a", "c1", ok(1))).rejects.toThrow(
      "Only a confirmed",
    );
  });

  it("reapply re-sends a conflict under a fresh id and keeps the retained id", async () => {
    const queue = new RevisionCommandQueue<Input>();
    await retainedAs(queue, new RevisionConflictError("changed"));
    queue.observe("a", 16);
    const again = vi.fn<Execute>(async () => {
      throw new RevisionConflictError("changed again");
    });
    await expect(queue.reapply("a", "c1", again)).rejects.toThrow(
      "changed again",
    );
    const [input, revision, commandId, attempt] = again.mock.calls[0]!;
    expect([input, revision, attempt]).toEqual([{ op: "x" }, 16, undefined]);
    expect(commandId).not.toBe("c1");
    expect(queue.snapshot("a").retained).toEqual([
      expect.objectContaining({ id: "c1", commandId, state: "conflicted" }),
    ]);
    await queue.reapply("a", "c1", ok(17));
    expect(queue.snapshot("a")).toMatchObject({ revision: 17, retained: [] });
  });

  it.each(["unknown", "failed"] as const)(
    "reapply refuses a %s edit",
    async (state) => {
      const queue = new RevisionCommandQueue<Input>();
      queue.adopt("a", [recovered("r1", state)]);
      const execute = ok(1);
      await expect(queue.reapply("a", "r1", execute)).rejects.toThrow(
        "Only a confirmed",
      );
      expect(execute).not.toHaveBeenCalled();
      expect(states(queue)).toEqual([state]);
    },
  );

  it("refuses an explicit re-send while the lane has pending work", async () => {
    const queue = new RevisionCommandQueue<Input>();
    queue.adopt("a", [recovered("u", "unknown"), recovered("c", "cancelled")]);
    const held = queue.submit("a", { op: "x" }, ok(1));
    const retry = queue.retrySameId("a", "u", ok(1));
    const reapply = queue.reapply("a", "c", ok(1));
    await expect(retry).rejects.toThrow("unknown outcome");
    await expect(reapply).rejects.toThrow("Only a confirmed");
    await expect(held).rejects.toBeInstanceOf(CommandNotSentError);
    expect(states(queue)).toEqual(["unknown", "cancelled", "cancelled"]);
  });
});

describe("retained edits", () => {
  it("retain and adopt block the lane until every item is removed", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const id = queue.retain("a", { op: "x" }, "cancelled", "Not sent: journal");
    expect(queue.snapshot("a").retained).toEqual([
      {
        id,
        commandId: id,
        input: { op: "x" },
        state: "cancelled",
        message: "Not sent: journal",
        origin: "session",
      },
    ]);
    const execute = ok(1);
    await expect(queue.submit("a", { op: "y" }, execute)).rejects.toThrow(
      "Not sent: an earlier command needs review. Edit retained.",
    );
    expect(execute).not.toHaveBeenCalled();
    queue.adopt("b", [recovered("r1", "unknown")]);
    queue.adopt("b", [recovered("r1", "unknown")]);
    queue.adopt("c", []);
    expect(queue.snapshot("b").retained).toHaveLength(1);
    expect([queue.isBlocked("b"), queue.isBlocked("c")]).toEqual([true, false]);
    expect(queue.aggregates()).toEqual(["a", "b", "c"]);
    queue.removeRetained("a", id);
    expect(queue.isBlocked("a")).toBe(true);
    queue.removeRetained("a", queue.snapshot("a").retained[0]!.id);
    expect(queue.snapshot("a")).toMatchObject({ state: null, retained: [] });
    expect(queue.isBlocked("a")).toBe(false);
    await queue.submit("a", { op: "z" }, execute);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("removeRetained throws while the lane has pending work", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const id = queue.retain("a", { op: "x" }, "cancelled", "Not sent");
    const held = queue.submit("a", { op: "y" }, ok(1));
    expect(() => queue.removeRetained("a", id)).toThrow("Wait for pending");
    await expect(held).rejects.toBeInstanceOf(CommandNotSentError);
    queue.removeRetained("a", id);
    expect(states(queue)).toEqual(["cancelled"]);
  });

  it("resolveRetained applies late evidence", () => {
    const queue = new RevisionCommandQueue<Input>();
    queue.observe("a", 4);
    queue.adopt("a", [recovered("r1", "unknown"), recovered("r2", "unknown")]);
    queue.resolveRetained("a", "r1", { state: "acknowledged", revision: 6 });
    expect(queue.snapshot("a").revision).toBe(6);
    expect(queue.isBlocked("a")).toBe(true);
    queue.resolveRetained("a", "r2", {
      state: "conflicted",
      message: "Design changed",
    });
    expect(queue.snapshot("a").retained).toEqual([
      expect.objectContaining({
        id: "r2",
        state: "conflicted",
        message: "Design changed",
      }),
    ]);
    queue.resolveRetained("a", "gone", { state: "acknowledged", revision: 99 });
    queue.resolveRetained("a", "r2", { state: "acknowledged", revision: 5 });
    expect(queue.snapshot("a")).toMatchObject({ revision: 6, retained: [] });
    expect(queue.isBlocked("a")).toBe(false);
  });
});

describe("retainPolicy unknown-only", () => {
  it.each([
    ["conflict", new RevisionConflictError("changed")],
    ["rejection", new CommandRejectedError("invalid rule")],
    ["not sent", new CommandNotSentError("journal down")],
    ["unclassified (default failed)", new Error("boom")],
  ] as const)("a %s is rethrown, not retained and not blocking", async (_, error) => {
    const queue = new RevisionCommandQueue<Input>();
    await expect(
      queue.submit("a", { op: "x" }, fail(error), {
        retainPolicy: "unknown-only",
      }),
    ).rejects.toBe(error);
    expect(queue.snapshot("a")).toMatchObject({ state: null, retained: [] });
    expect(queue.isBlocked("a")).toBe(false);
  });

  it("a blocked lane refuses with LaneBlockedError and retains nothing new", async () => {
    const queue = new RevisionCommandQueue<Input>();
    queue.adopt("a", [recovered("r1", "unknown")]);
    const execute = ok(1);
    await expect(
      queue.submit("a", { op: "x" }, execute, { retainPolicy: "unknown-only" }),
    ).rejects.toBeInstanceOf(LaneBlockedError);
    expect(execute).not.toHaveBeenCalled();
    expect(states(queue)).toEqual(["unknown"]);
  });

  it("an unknown outcome is always retained", async () => {
    const queue = new RevisionCommandQueue<Input>();
    await expect(
      queue.submit("a", { op: "x" }, fail(new AcknowledgementUnknownError("?")), {
        retainPolicy: "unknown-only",
      }),
    ).rejects.toBeInstanceOf(AcknowledgementUnknownError);
    expect(states(queue)).toEqual(["unknown"]);
    expect(queue.isBlocked("a")).toBe(true);
  });
});

describe("exclusive", () => {
  it("runs in FIFO order and sets the lane revision exactly", async () => {
    const queue = new RevisionCommandQueue<Input>();
    const calls: string[] = [];
    const first = queue.submit("a", { op: "x" }, async (_input, revision) => {
      calls.push(`submit@${revision}`);
      return ack(10);
    });
    const exclusive = queue.exclusive("a", async (revision) => {
      calls.push(`exclusive@${revision}`);
      return ack(null);
    });
    const next = queue.submit("a", { op: "y" }, async (_input, revision) => {
      calls.push(`submit@${revision}`);
      return ack(12);
    });
    await Promise.all([first, exclusive, next]);
    expect(calls).toEqual(["submit@null", "exclusive@10", "submit@null"]);
    await queue.exclusive("a", async () => ack(3));
    expect(queue.snapshot("a")).toMatchObject({
      revision: 3,
      state: "acknowledged",
      retained: [],
    });
  });

  it("is refused while blocked without running or retaining", async () => {
    const queue = new RevisionCommandQueue<Input>();
    queue.observe("a", 5);
    queue.adopt("a", [recovered("r1", "conflicted")]);
    const run = exclusiveOk(9);
    await expect(queue.exclusive("a", run)).rejects.toBeInstanceOf(
      LaneBlockedError,
    );
    expect(run).not.toHaveBeenCalled();
    expect(queue.snapshot("a")).toMatchObject({ revision: 5 });
    expect(states(queue)).toEqual(["conflicted"]);
  });

  it("a failing run clears the lane revision and retains nothing", async () => {
    const queue = new RevisionCommandQueue<Input>();
    queue.observe("a", 5);
    const error = new Error("apply failed");
    await expect(
      queue.exclusive("a", async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(queue.snapshot("a")).toMatchObject({
      revision: null,
      pending: 0,
      retained: [],
    });
    expect(queue.isBlocked("a")).toBe(false);
  });
});
