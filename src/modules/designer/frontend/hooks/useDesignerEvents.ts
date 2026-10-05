import { useEffect, useRef } from "react";
import { createLiveEventController } from "../../../../shared/frontend/live-events/live-events";

/**
 * Live design changes from `GET /api/modules/designer/events`.
 *
 * The workspace refetches after its own commands, and after an in-app
 * assistant run reports a change. Everything else — an MCP client (Claude
 * Code) editing through the assistant module, an undo from another window, a
 * rename or delete — arrives here, so the canvas never silently shows a
 * revision older than the database and the user's next command does not race
 * a change they never saw.
 */

export type DesignerLiveEvent =
  | {
      type: "design.changed";
      designId: string;
      revision: number;
      sessionId: string | null;
      actor: string | null;
      source: "command" | "undo" | "redo";
      commandType: string | null;
    }
  | { type: "design.created"; designId: string; name: string }
  | { type: "design.updated"; designId: string; name: string }
  | { type: "design.deleted"; designId: string }
  | { type: "design.focus"; designId: string };

export interface DesignEventReaction {
  /** Reload the design list (names, revisions, new/deleted designs). */
  refreshDesigns: boolean;
  /** Reload projection + history of the open design. */
  refreshSelected: boolean;
  /** Highest revision seen for the open design (for the optimistic revision guard). */
  selectedRevision: number | null;
  /** Open (or activate) this design's tab. */
  focusDesignId: string | null;
  /** Close these tabs: the designs were deleted. */
  closeDesignIds: string[];
}

/**
 * Decide what one burst of events means for the workspace. Pure, for tests.
 *
 * A `design.changed` from this UI's own command (`actor: "user"`) is skipped:
 * the workspace already applied it, and PCB commands deliberately avoid a
 * refetch per command. Anything else newer than the revision on screen
 * refreshes the open design.
 */
export function planDesignEventReaction(
  events: DesignerLiveEvent[],
  context: { selectedDesignId: string | null; knownRevision: number | null },
): DesignEventReaction {
  const reaction: DesignEventReaction = {
    refreshDesigns: false,
    refreshSelected: false,
    selectedRevision: null,
    focusDesignId: null,
    closeDesignIds: [],
  };
  for (const event of events) {
    switch (event.type) {
      case "design.created":
      case "design.updated":
        reaction.refreshDesigns = true;
        break;
      case "design.deleted":
        reaction.refreshDesigns = true;
        reaction.closeDesignIds.push(event.designId);
        break;
      case "design.focus":
        reaction.focusDesignId = event.designId;
        break;
      case "design.changed": {
        reaction.refreshDesigns = true;
        if (event.designId !== context.selectedDesignId) break;
        const ownCommand = event.actor === "user" && event.source === "command";
        if (ownCommand) break;
        if (
          context.knownRevision === null ||
          event.revision > context.knownRevision
        ) {
          reaction.refreshSelected = true;
          reaction.selectedRevision = Math.max(
            reaction.selectedRevision ?? 0,
            event.revision,
          );
        }
        break;
      }
    }
  }
  return reaction;
}

export interface UseDesignerEventsOptions {
  backendUrl: string | null | undefined;
  selectedDesignId: string | null;
  knownRevision: () => number | null;
  onReaction: (reaction: DesignEventReaction) => void;
}

export function useDesignerEvents({
  backendUrl,
  selectedDesignId,
  knownRevision,
  onReaction,
}: UseDesignerEventsOptions): void {
  const latest = useRef({ selectedDesignId, knownRevision, onReaction });
  latest.current = { selectedDesignId, knownRevision, onReaction };

  useEffect(() => {
    if (!backendUrl || typeof EventSource === "undefined") return;
    return createLiveEventController<DesignerLiveEvent>({
      url: `${backendUrl}/api/modules/designer/events`,
      eventTypes: [
        "design.changed",
        "design.created",
        "design.updated",
        "design.deleted",
        "design.focus",
      ],
      // An agent's batch of commands lands within milliseconds; one refetch.
      debounceMs: 150,
      onEvents: (events) => {
        const current = latest.current;
        current.onReaction(
          planDesignEventReaction(events, {
            selectedDesignId: current.selectedDesignId,
            knownRevision: current.knownRevision(),
          }),
        );
      },
    });
  }, [backendUrl]);
}
