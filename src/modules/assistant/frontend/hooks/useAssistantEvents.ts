import { useEffect, useRef } from "react";

/**
 * Live change notifications from `GET /api/modules/assistant/events`.
 *
 * The panel streams its own runs over the tasks SSE, but chats also change
 * from outside a run — above all when Claude Code (or another MCP client)
 * drives OpenPCB: each tool call lands in an MCP chat, and a deletion it
 * proposes waits there for the user's approval. This hook lets the panel
 * refetch when that happens instead of showing a stale transcript.
 *
 * Events carry only ids; callers refetch through the normal routes. Bursts
 * are coalesced (an MCP call produces a begin and an end event) so one tool
 * call costs one refetch.
 */

export type AssistantLiveEvent =
  | { type: "chat.activity"; chatId: string; designId: string | null }
  | {
      type: "proposal.updated";
      chatId: string;
      proposalId: string;
      status: string;
      designId: string | null;
    };

export interface UseAssistantEventsOptions {
  backendUrl: string | null | undefined;
  /** Called once per coalesced burst with every event in it. */
  onEvents: (events: AssistantLiveEvent[]) => void;
  /** Coalescing window. */
  debounceMs?: number;
  enabled?: boolean;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface EventSourceLike {
  readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

type EventSourceCtor = new (url: string) => EventSourceLike;

/**
 * The React-free half: opens the stream, coalesces bursts, reconnects with
 * backoff when the browser gives up. Returns a disposer. Exported for tests
 * (the frontend Vitest project has no DOM harness).
 */
export function createAssistantEventsController(options: {
  backendUrl: string;
  onEvents: (events: AssistantLiveEvent[]) => void;
  debounceMs?: number;
  EventSourceImpl?: EventSourceCtor;
}): () => void {
  const EventSourceImpl =
    options.EventSourceImpl ?? (EventSource as unknown as EventSourceCtor);
  const debounceMs = options.debounceMs ?? 250;
  const CLOSED = 2;

  let disposed = false;
  let source: EventSourceLike | null = null;
  let pending: AssistantLiveEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoff = RECONNECT_MIN_MS;

  const flush = () => {
    flushTimer = null;
    if (disposed || pending.length === 0) return;
    const batch = pending;
    pending = [];
    options.onEvents(batch);
  };

  const onMessage = (event: MessageEvent<string>) => {
    try {
      pending.push(JSON.parse(event.data) as AssistantLiveEvent);
    } catch {
      return;
    }
    if (!flushTimer) flushTimer = setTimeout(flush, debounceMs);
  };

  const connect = () => {
    if (disposed) return;
    const current = new EventSourceImpl(
      `${options.backendUrl}/api/modules/assistant/events`,
    );
    source = current;
    current.addEventListener("open", () => {
      backoff = RECONNECT_MIN_MS;
    });
    current.addEventListener("chat.activity", onMessage);
    current.addEventListener("proposal.updated", onMessage);
    current.addEventListener("error", () => {
      // EventSource retries network blips on its own but gives up for good
      // on some failures (e.g. the backend restarted); reconnect ourselves
      // with backoff so the panel does not silently go stale.
      if (current.readyState !== CLOSED || disposed) return;
      source = null;
      reconnectTimer = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    });
  };

  connect();
  return () => {
    disposed = true;
    source?.close();
    if (flushTimer) clearTimeout(flushTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}

export function useAssistantEvents({
  backendUrl,
  onEvents,
  debounceMs = 250,
  enabled = true,
}: UseAssistantEventsOptions): void {
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;

  useEffect(() => {
    if (!enabled || !backendUrl || typeof EventSource === "undefined") return;
    return createAssistantEventsController({
      backendUrl,
      debounceMs,
      onEvents: (events) => onEventsRef.current(events),
    });
  }, [backendUrl, debounceMs, enabled]);
}
