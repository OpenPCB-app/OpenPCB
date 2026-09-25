import { useEffect, useRef } from "react";
import { createLiveEventController } from "../../../../shared/frontend/live-events/live-events";

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
    return createLiveEventController<AssistantLiveEvent>({
      url: `${backendUrl}/api/modules/assistant/events`,
      eventTypes: ["chat.activity", "proposal.updated"],
      debounceMs,
      onEvents: (events) => onEventsRef.current(events),
    });
  }, [backendUrl, debounceMs, enabled]);
}
