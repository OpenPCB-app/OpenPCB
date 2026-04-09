import { describe, expect, test } from "vitest";
import { reconcileCommandResult } from "../runtime/reconcile-command-result";
import { reconcileEvent } from "../runtime/reconcile-event";
import {
  completeProjectionLoad,
  createInitialDesignCacheState,
} from "../state/design-cache.state";

describe.skip("frontend reconcile helpers", () => {
  test("successful command marks cache stale instead of pretending projection updated", () => {
    const initial = completeProjectionLoad(createInitialDesignCacheState(), {
      designId: "design-1",
      revision: 1,
      sheets: [],
      parts: [],
      wires: [],
      nets: [],
    });

    const next = reconcileCommandResult(initial, {
      ok: true,
      commandId: "cmd-1",
      designId: "design-1",
      acceptedRevision: 1,
      nextRevision: 2,
      forwardPatches: [],
      affectedEntityIds: ["part-1"],
      invalidated: ["schematic"],
    });

    expect(next.status).toBe("stale");
    expect(next.knownRevision).toBe(2);
    expect(next.staleRevision).toBe(2);
    expect(next.projection?.revision).toBe(1);
  });

  test("remote invalidation marks active design stale", () => {
    const initial = completeProjectionLoad(createInitialDesignCacheState(), {
      designId: "design-1",
      revision: 3,
      sheets: [],
      parts: [],
      wires: [],
      nets: [],
    });

    const next = reconcileEvent(initial, {
      type: "design.invalidated",
      designId: "design-1",
      revision: 4,
      affectedEntityIds: ["wire-1"],
      invalidated: ["nets"],
    });

    expect(next.status).toBe("stale");
    expect(next.knownRevision).toBe(4);
    expect(next.pendingInvalidated).toEqual(["nets"]);
  });
});
