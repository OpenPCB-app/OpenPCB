/**
 * In-process change bus for the assistant module.
 *
 * The panel otherwise only updates live during its own task runs (streamed
 * over the tasks SSE). Anything that changes a chat from outside a run — an
 * MCP client's tool calls, a proposal approved in another window, an
 * auto-applied write — publishes here, and `GET /events` (SSE) relays it so
 * the panel can refetch. It also lets `assistant_await_proposal` wake the
 * moment the user decides instead of polling the database.
 *
 * Events carry ids, never content: subscribers refetch through the normal
 * routes, so there is one read path and nothing sensitive on the stream.
 */

export type AssistantEvent =
  | {
      type: "chat.activity";
      chatId: string;
      /** The design the chat is bound to, when known — lets a design dock filter. */
      designId: string | null;
    }
  | {
      type: "proposal.updated";
      chatId: string;
      proposalId: string;
      status: string;
      designId: string | null;
    };

type Listener = (event: AssistantEvent) => void;

export class AssistantEventBus {
  private readonly listeners = new Set<Listener>();

  publish(event: AssistantEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must not stop delivery to the others.
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

  /**
   * Resolve with the next `proposal.updated` for `proposalId` whose status
   * `isDone` accepts, or null on timeout / abort.
   */
  waitForProposal(
    proposalId: string,
    isDone: (status: string) => boolean,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        options.signal?.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onAbort = () => finish(null);
      const unsubscribe = this.subscribe((event) => {
        if (
          event.type === "proposal.updated" &&
          event.proposalId === proposalId &&
          isDone(event.status)
        ) {
          finish(event.status);
        }
      });
      const timer = setTimeout(() => finish(null), options.timeoutMs);
      if (options.signal?.aborted) finish(null);
      else options.signal?.addEventListener("abort", onAbort);
    });
  }
}

/** Server-Sent Events framing for one event. */
export function sseFrame(event: AssistantEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * `GET /events` body: relays the bus as SSE, with a comment-frame keepalive so
 * idle proxies and the browser keep the stream open.
 */
export function assistantEventStream(
  bus: AssistantEventBus,
  signal: AbortSignal,
  keepAliveMs = 15_000,
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
      const unsubscribe = bus.subscribe((event) => write(sseFrame(event)));
      const keepAlive = setInterval(() => write(": keepalive\n\n"), keepAliveMs);
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
