import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  createAssistantEventsController,
  type AssistantLiveEvent,
} from "./useAssistantEvents";

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 1;
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }

  /** The browser gave up on the stream for good. */
  die(): void {
    this.readyState = 2;
    for (const listener of this.listeners.get("error") ?? []) listener({ data: "" });
  }
}

const Impl = FakeEventSource as never;

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("assistant live events", () => {
  test("coalesces a burst into one callback", () => {
    const batches: AssistantLiveEvent[][] = [];
    const dispose = createAssistantEventsController({
      backendUrl: "http://127.0.0.1:3000",
      onEvents: (events) => batches.push(events),
      EventSourceImpl: Impl,
    });
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("http://127.0.0.1:3000/api/modules/assistant/events");
    source.emit("chat.activity", { type: "chat.activity", chatId: "c1", designId: "d1" });
    source.emit("proposal.updated", {
      type: "proposal.updated",
      chatId: "c1",
      proposalId: "p1",
      status: "pending",
      designId: "d1",
    });
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((e) => e.type)).toEqual(["chat.activity", "proposal.updated"]);
    dispose();
    expect(source.closed).toBe(true);
  });

  test("reconnects with backoff after the stream dies", () => {
    const dispose = createAssistantEventsController({
      backendUrl: "http://x",
      onEvents: () => undefined,
      EventSourceImpl: Impl,
    });
    FakeEventSource.instances[0]!.die();
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances[1]!.die();
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(3);
    dispose();
  });

  test("delivers nothing after dispose", () => {
    const batches: AssistantLiveEvent[][] = [];
    const dispose = createAssistantEventsController({
      backendUrl: "http://x",
      onEvents: (events) => batches.push(events),
      EventSourceImpl: Impl,
    });
    FakeEventSource.instances[0]!.emit("chat.activity", {
      type: "chat.activity",
      chatId: "c",
      designId: null,
    });
    dispose();
    vi.advanceTimersByTime(1_000);
    expect(batches).toHaveLength(0);
  });
});
