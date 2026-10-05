import { describe, expect, test } from "vitest";
import { planDesignEventReaction, type DesignerLiveEvent } from "./useDesignerEvents";

const changed = (
  overrides: Partial<Extract<DesignerLiveEvent, { type: "design.changed" }>>,
): DesignerLiveEvent => ({
  type: "design.changed",
  designId: "d1",
  revision: 5,
  sessionId: "designer-ui-session",
  actor: "assistant",
  source: "command",
  commandType: "place_part",
  ...overrides,
});

describe("design event reaction", () => {
  test("an agent's change newer than the screen refreshes the open design", () => {
    const r = planDesignEventReaction([changed({ revision: 5 }), changed({ revision: 6 })], {
      selectedDesignId: "d1",
      knownRevision: 4,
    });
    expect(r.refreshSelected).toBe(true);
    expect(r.selectedRevision).toBe(6);
    expect(r.refreshDesigns).toBe(true);
  });

  test("the UI's own commands and already-seen revisions do not refetch", () => {
    const own = planDesignEventReaction([changed({ actor: "user", revision: 9 })], {
      selectedDesignId: "d1",
      knownRevision: 8,
    });
    expect(own.refreshSelected).toBe(false);
    const seen = planDesignEventReaction([changed({ revision: 4 })], {
      selectedDesignId: "d1",
      knownRevision: 4,
    });
    expect(seen.refreshSelected).toBe(false);
  });

  test("an undo from anywhere refreshes even when its actor is unknown", () => {
    const r = planDesignEventReaction([changed({ actor: null, source: "undo", revision: 7 })], {
      selectedDesignId: "d1",
      knownRevision: 6,
    });
    expect(r.refreshSelected).toBe(true);
  });

  test("other designs only refresh the list; deletes close tabs; focus opens one", () => {
    const r = planDesignEventReaction(
      [
        changed({ designId: "d2" }),
        { type: "design.deleted", designId: "d3" },
        { type: "design.focus", designId: "d4" },
      ],
      { selectedDesignId: "d1", knownRevision: 1 },
    );
    expect(r.refreshSelected).toBe(false);
    expect(r.refreshDesigns).toBe(true);
    expect(r.closeDesignIds).toEqual(["d3"]);
    expect(r.focusDesignId).toBe("d4");
  });
});
