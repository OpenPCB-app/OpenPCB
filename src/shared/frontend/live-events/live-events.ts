/**
 * A resilient Server-Sent Events subscription for backend change streams
 * (`/api/modules/assistant/events`, `/api/modules/designer/events`).
 *
 * Both streams carry small JSON events whose job is to say "refetch". This
 * controller coalesces bursts (one MCP tool call emits several events) into a
 * single callback and reconnects with backoff when the browser gives up on
 * the stream — `EventSource` retries network blips itself but stops for good
 * on some failures, e.g. when the backend restarted. React-free so the
 * frontend Vitest project (no DOM harness) can drive it directly.
 */

export interface EventSourceLike {
  readyState: number;
  addEventListener(
    type: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
  close(): void;
}

export type EventSourceCtor = new (url: string) => EventSourceLike;

export interface LiveEventOptions<T> {
  url: string;
  /** SSE `event:` names to listen for; each data frame is parsed as JSON. */
  eventTypes: readonly string[];
  /** Called once per coalesced burst. */
  onEvents: (events: T[]) => void;
  /** Coalescing window; 0 delivers each event on its own. */
  debounceMs?: number;
  EventSourceImpl?: EventSourceCtor;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const CLOSED = 2;

/** Open the stream; returns a disposer. */
export function createLiveEventController<T>(
  options: LiveEventOptions<T>,
): () => void {
  const EventSourceImpl =
    options.EventSourceImpl ?? (EventSource as unknown as EventSourceCtor);
  const debounceMs = options.debounceMs ?? 250;

  let disposed = false;
  let source: EventSourceLike | null = null;
  let pending: T[] = [];
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
      pending.push(JSON.parse(event.data) as T);
    } catch {
      return;
    }
    if (debounceMs <= 0) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, debounceMs);
  };

  const connect = () => {
    if (disposed) return;
    const current = new EventSourceImpl(options.url);
    source = current;
    current.addEventListener("open", () => {
      backoff = RECONNECT_MIN_MS;
    });
    for (const type of options.eventTypes) {
      current.addEventListener(type, onMessage);
    }
    current.addEventListener("error", () => {
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
