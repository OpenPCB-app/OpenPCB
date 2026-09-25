import { describe, expect, it } from "vitest";
import { isStaleMessage, NO_SESSION_ALLOW_KINDS, proposalFailureNote } from "./proposal-status";

describe("proposalFailureNote", () => {
  it("says nothing for proposals that did not fail", () => {
    expect(proposalFailureNote("pending", null)).toBeNull();
    expect(proposalFailureNote("applied", { message: "ok" })).toBeNull();
  });

  it("explains a stale proposal with both revisions and no apply-anyway", () => {
    const note = proposalFailureNote("failed", {
      code: "STALE_PROPOSAL",
      expectedRevision: 40,
      currentRevision: 42,
    });
    expect(note).toContain("revision 40 → 42");
    expect(note).toContain("propose it again");
  });

  it("falls back to the persisted message", () => {
    expect(proposalFailureNote("failed", { message: "Design not found" })).toBe(
      "Not applied: Design not found",
    );
    expect(proposalFailureNote("failed", null)).toBe("Not applied.");
  });

  it("recognises the backend's stale refusal", () => {
    expect(
      isStaleMessage(
        "Design changed since proposal was created (expected revision 3, current 4). Regenerate the proposal.",
      ),
    ).toBe(true);
    expect(isStaleMessage("Apply failed")).toBe(false);
  });

  it("never offers a session allowance for irreversible or verification-suppressing kinds", () => {
    expect(NO_SESSION_ALLOW_KINDS.has("designer_design_delete")).toBe(true);
    expect(NO_SESSION_ALLOW_KINDS.has("designer_pcb_drc_rule_ignores")).toBe(true);
    expect(NO_SESSION_ALLOW_KINDS.has("designer_schematic_deletions")).toBe(false);
  });
});
