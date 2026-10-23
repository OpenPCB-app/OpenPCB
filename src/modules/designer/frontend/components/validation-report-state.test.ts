import { describe, expect, test } from "vitest";
import { validationReportNotice, validationReportState } from "./validation-report-state";

describe("validation report freshness", () => {
  const current = {
    report: { designId: "a", revision: 7 },
    designId: "a",
    revision: 7,
    previous: false,
  };

  test("requires matching design and known current revision", () => {
    expect(validationReportState(current)).toBe("current");
    expect(validationReportState({ ...current, report: null })).toBe("missing");
    expect(validationReportState({ ...current, designId: "b" })).toBe("missing");
    expect(validationReportState({ ...current, revision: null })).toBe("unknown-revision");
    expect(validationReportState({ ...current, revision: 8 })).toBe("stale");
    expect(validationReportState({ ...current, previous: true })).toBe("previous");
  });

  test("historical notices never describe the report as current", () => {
    for (const kind of ["ERC", "DRC"] as const) {
      for (const state of ["previous", "stale", "unknown-revision"] as const) {
        expect(validationReportNotice(kind, state)).toMatch(/previous/i);
      }
      expect(validationReportNotice(kind, "current")).toBeNull();
      expect(validationReportNotice(kind, "missing")).toBeNull();
    }
  });
});
