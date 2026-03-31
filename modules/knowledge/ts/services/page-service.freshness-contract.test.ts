import { describe, it, expect, mock } from "bun:test";
import { PageEventService } from "./page-event-service";
import type { PageUpdateEvent } from "../../shared/types";

function makeEvent(overrides: Partial<PageUpdateEvent> = {}): PageUpdateEvent {
  return {
    type: "content_updated",
    pageId: "page-1",
    workspaceId: "ws-1",
    updatedAt: "2026-02-23T10:00:00.000Z",
    revision: 2,
    source: "user",
    ...overrides,
  };
}

describe("PageEventService contract", () => {
  it("publishes events to workspace subscribers", () => {
    const service = new PageEventService();
    const callback = mock(() => {});
    const event = makeEvent();

    service.subscribe("ws-1", callback);
    service.publish(event);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(event);
  });

  it("does not cross-publish between workspaces", () => {
    const service = new PageEventService();
    const callback = mock(() => {});

    service.subscribe("ws-1", callback);
    service.publish(makeEvent({ workspaceId: "ws-2" }));

    expect(callback).not.toHaveBeenCalled();
  });

  it("unsubscribe stops event delivery", () => {
    const service = new PageEventService();
    const callback = mock(() => {});
    const unsubscribe = service.subscribe("ws-1", callback);

    unsubscribe();
    service.publish(makeEvent());

    expect(callback).not.toHaveBeenCalled();
  });

  it("handles subscriber errors gracefully", () => {
    const service = new PageEventService();
    const throwingSubscriber = mock(() => {
      throw new Error("subscriber failed");
    });
    const healthySubscriber = mock(() => {});

    service.subscribe("ws-1", throwingSubscriber);
    service.subscribe("ws-1", healthySubscriber);

    expect(() => service.publish(makeEvent())).not.toThrow();
    expect(throwingSubscriber).toHaveBeenCalledTimes(1);
    expect(healthySubscriber).toHaveBeenCalledTimes(1);
  });
});

describe("PageUpdateEvent type contract", () => {
  it("event has all required fields", () => {
    const event: PageUpdateEvent = makeEvent({
      type: "meta_updated",
      source: "system",
    });

    expect(event.type).toBe("meta_updated");
    expect(event.pageId).toBe("page-1");
    expect(event.workspaceId).toBe("ws-1");
    expect(event.updatedAt).toBe("2026-02-23T10:00:00.000Z");
    expect(event.revision).toBe(2);
    expect(event.source).toBe("system");
  });

  it("requestId is optional", () => {
    const withoutRequestId: PageUpdateEvent = makeEvent();
    const withRequestId: PageUpdateEvent = makeEvent({ requestId: "req-123" });

    expect(withoutRequestId.requestId).toBeUndefined();
    expect(withRequestId.requestId).toBe("req-123");
  });

  it("source accepts user, ai, system", () => {
    const userEvent: PageUpdateEvent = makeEvent({ source: "user" });
    const aiEvent: PageUpdateEvent = makeEvent({ source: "ai" });
    const systemEvent: PageUpdateEvent = makeEvent({ source: "system" });

    expect(userEvent.source).toBe("user");
    expect(aiEvent.source).toBe("ai");
    expect(systemEvent.source).toBe("system");
  });
});
