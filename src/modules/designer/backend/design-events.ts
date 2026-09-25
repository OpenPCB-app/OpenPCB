/**
 * Design change notifications.
 *
 * The designer frontend reloads its projection and history after its own
 * commands, and after an in-app assistant run tells it to. Nothing told it
 * about edits from anywhere else — an MCP client (Claude Code) driving the
 * design through the assistant module, an undo in another window, an
 * auto-layout apply — so the canvas silently went stale and the user's next
 * command raced a revision they had never seen.
 *
 * The store publishes here after every committed change; `GET /events` (SSE)
 * relays it; the frontend refetches the open design when the event revision
 * is newer than what it shows. Events carry ids and revisions only.
 *
 * One bus per database (keyed by the module's db client, like the undo
 * histories), because the designer builds two store instances — routes and
 * SDK — that must feed the same stream.
 */

export type DesignEvent =
  | {
      type: "design.changed";
      designId: string;
      revision: number;
      /** Undo session the change was made in (`designer-ui-session` for UI + agents). */
      sessionId: string | null;
      /** Who made it: "user", "assistant", "autolayout_apply", "import", or null. */
      actor: string | null;
      source: "command" | "undo" | "redo";
      commandType: string | null;
    }
  | { type: "design.created"; designId: string; name: string }
  | { type: "design.updated"; designId: string; name: string }
  | { type: "design.deleted"; designId: string }
  /** Ask the UI to open and focus a design (an agent switched what it works on). */
  | { type: "design.focus"; designId: string };

type Listener = (event: DesignEvent) => void;

export class DesignEventBus {
  private readonly listeners = new Set<Listener>();

  publish(event: DesignEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One broken subscriber must not starve the others.
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

const buses = new WeakMap<object, DesignEventBus>();

export function designEventsFor(dbKey: object): DesignEventBus {
  let bus = buses.get(dbKey);
  if (!bus) {
    bus = new DesignEventBus();
    buses.set(dbKey, bus);
  }
  return bus;
}

/** `GET /events` body: the bus as SSE, optionally filtered to one design. */
export function designEventStream(
  bus: DesignEventBus,
  signal: AbortSignal,
  options: { designId?: string | null; keepAliveMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const unsubscribe = bus.subscribe((event) => {
        if (options.designId && event.designId !== options.designId) return;
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const keepAlive = setInterval(
        () => write(": keepalive\n\n"),
        options.keepAliveMs ?? 15_000,
      );
      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      cleanup = close;
      write(": connected\n\n");
      signal.addEventListener("abort", close);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
