import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { DrcRunEvidence } from "../../../../sdks";
import { DrcEvidenceSummary } from "./DrcEvidenceSummary";

test("older reports have unknown execution evidence and no coverage claim", () => {
  const html = renderToStaticMarkup(createElement(DrcEvidenceSummary, { evidence: undefined }));
  expect(html).toContain("Execution evidence unavailable");
  expect(html).toContain("does not establish full geometry or standards coverage");
  expect(html).not.toContain("stages ran");
  expect(html).not.toContain("status-success");
});

test("execution, requested suppression options, and unsuppressed limitations stay visible", () => {
  const evidence: DrcRunEvidence = {
    version: 1, scope: "batch", executedStages: ["rules", "outline"],
    ignoredRuleClasses: ["manufacturability"],
    ignoredRuleCodes: ["COPPER_SHAPE_UNCHECKED"],
    severityOverrides: { COPPER_SHAPE_UNCHECKED: "ignore", TRACE_WIDTH_MIN: "warning" },
    waivedIds: ["a", "b"],
    limitations: [{ code: "COPPER_SHAPE_UNCHECKED", message: "Geometry budget exceeded", anchors: [] }],
  };
  const html = renderToStaticMarkup(createElement(DrcEvidenceSummary, { evidence }));
  expect(html).toContain("2 stages ran");
  expect(html).toContain("Requested ignored classes: 1");
  expect(html).toContain("Ignored codes: 1");
  expect(html).toContain("Requested waiver IDs: 2");
  expect(html).toContain("TRACE_WIDTH_MIN: warning");
  expect(html).toContain("Geometry budget exceeded");
  expect(html).not.toContain("status-success");
});

test("an empty limitations list never establishes full coverage", () => {
  const evidence: DrcRunEvidence = {
    version: 1, scope: "batch", executedStages: ["rules"], ignoredRuleClasses: [],
    ignoredRuleCodes: [], severityOverrides: {}, waivedIds: [], limitations: [],
  };
  const html = renderToStaticMarkup(createElement(DrcEvidenceSummary, { evidence }));
  expect(html).toContain("does not establish full geometry or standards coverage");
  expect(html).not.toContain("No limitations");
});
