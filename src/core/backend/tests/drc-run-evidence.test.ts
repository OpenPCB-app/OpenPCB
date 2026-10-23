import { describe, expect, test } from "bun:test";
import type { DrcRuleCode, DrcRunEvidence } from "../../../sdks/designer";
import { DRC_STAGES, drcDrafts, drcOptionsFromProjection, finalizeReport, runDrc } from "../../../shared/drc/drc-engine";
import { buildDrcRunEvidence, parseDrcRunEvidence } from "../../../shared/drc/run-evidence";
import type { DrcViolationDraft } from "../../../shared/drc/types";
import { board, freePad, projection } from "./helpers/drc-fixtures";
import { buildFixture, reversedEverything } from "./helpers/drc-determinism-fixture";

const draft = (code: DrcRuleCode, message: string = code): DrcViolationDraft => ({
  code, message, anchors: [{ kind: "net", netId: "n1" }],
});

function evidence(overrides: Partial<Parameters<typeof buildDrcRunEvidence>[0]> = {}): DrcRunEvidence {
  return buildDrcRunEvidence({
    drafts: [], executedStages: ["rules", "outline"], ignoredRuleClasses: [],
    waivedIds: [], severityOverrides: {}, ...overrides,
  });
}

describe("batch DRC execution evidence", () => {
  test("successful runs name stages that actually ran, in dispatch order", () => {
    const stages: string[] = [];
    const report = runDrc(projection(), {
      tick: (stage) => { if (DRC_STAGES.some(([name]) => name === stage)) stages.push(stage); },
    });
    expect(report.evidence?.executedStages).toEqual(stages);
    expect(stages).toEqual(DRC_STAGES.map(([stage]) => stage));
    expect(report.evidence?.scope).toBe("batch");
    expect(report.evidence).not.toHaveProperty("complete");
  });

  test("batch evidence cannot change violation content, ids, counts, or summary", () => {
    const input = buildFixture();
    const options = drcOptionsFromProjection(input);
    const baseline = finalizeReport(drcDrafts(input), {
      designId: input.designId, revision: input.revision,
      ignoredRuleClasses: options.ignoredRuleClasses, waivedIds: options.waivedIds,
      severityOverrides: options.severityOverrides,
    });
    const { evidence: metadata, ...report } = runDrc(input);
    expect(metadata).toBeDefined();
    expect(JSON.stringify(report)).toBe(JSON.stringify(baseline));
    expect(baseline).not.toHaveProperty("evidence");
  });

  test("explicit options win over projection defaults, including empty values", () => {
    const input = projection({ board: board({
      viewState: { displayMode: "normal", viewSide: "top", perLayerOpacity: {}, layerPreset: "custom", ratsnestVisible: true, drcIgnoredRuleClasses: ["dfm"], drcWaivedViolationIds: ["old"] },
      drcSeverityOverrides: { COPPER_SHAPE_UNCHECKED: "ignore" },
    }) });
    expect(drcOptionsFromProjection(input).severityOverrides).toEqual(input.board.drcSeverityOverrides);
    expect(runDrc(input).evidence).toMatchObject({
      ignoredRuleClasses: ["dfm"], ignoredRuleCodes: ["COPPER_SHAPE_UNCHECKED"], waivedIds: ["old"],
    });
    expect(runDrc(input, { ignoredRuleClasses: [], waivedIds: [], severityOverrides: {} }).evidence).toMatchObject({
      ignoredRuleClasses: [], ignoredRuleCodes: [], severityOverrides: {}, waivedIds: [],
    });
  });

  test("ignored code evidence excludes safety-critical override requests", () => {
    const result = evidence({ severityOverrides: { NET_SHORT_CIRCUIT: "ignore", TRACE_WIDTH_MIN: "ignore", VIA_DIAMETER_MIN: "warning" } });
    expect(result.ignoredRuleCodes).toEqual(["TRACE_WIDTH_MIN"]);
    expect(result.severityOverrides).toEqual({ NET_SHORT_CIRCUIT: "ignore", TRACE_WIDTH_MIN: "ignore", VIA_DIAMETER_MIN: "warning" });
  });

  test.each(["class", "severity", "waiver"] as const)("%s suppression retains assessment limitations", (mode) => {
    const input = projection({ freePads: [freePad("pad", { netId: "n1" })], netNames: { n1: "GND" } });
    const budget = { copperShapeBudgets: { vertexBudget: 1 } };
    const reference = runDrc(input, budget);
    const limitation = reference.violations.find((entry) => entry.code === "COPPER_SHAPE_UNCHECKED");
    expect(limitation).toBeDefined();
    const report = runDrc(input, {
      ...budget,
      ...(mode === "class" ? { ignoredRuleClasses: ["dfm"] as ["dfm"] } : {}),
      ...(mode === "severity" ? { severityOverrides: { COPPER_SHAPE_UNCHECKED: "ignore" as const } } : {}),
      ...(mode === "waiver" ? { waivedIds: [limitation!.id] } : {}),
    });
    expect(report.evidence?.limitations).toEqual(reference.evidence?.limitations);
    if (mode === "waiver") expect(report.violations.find((entry) => entry.id === limitation!.id)?.waived).toBe(true);
    else expect(report.violations.some((entry) => entry.code === "COPPER_SHAPE_UNCHECKED")).toBe(false);
  });

  test("all explicit limitation codes survive canonical deduplication", () => {
    const codes: DrcRuleCode[] = ["DRC_RULE_INVALID", "DRC_RULE_INEFFECTIVE", "NET_LENGTH_UNDEFINED", "COPPER_SHAPE_UNCHECKED", "OUTLINE_WEB_UNCHECKED", "VIA_TYPE_UNSUPPORTED", "ZONE_FILL_FAILED", "COURTYARD_INVALID", "BOARD_OUTLINE_INVALID", "ZONE_INVALID"];
    const drafts = codes.map((code) => draft(code));
    const pair: DrcViolationDraft = {
      ...draft("NET_LENGTH_UNDEFINED", "Pair path unavailable"),
      anchors: [{ kind: "diffPair", pNetId: "b", nNetId: "a" }, { kind: "net", netId: "n1" }],
    };
    const reversed = { ...pair, anchors: [...pair.anchors].reverse() };
    const first = evidence({ drafts: [...drafts, pair, reversed, draft("TRACE_WIDTH_MIN")] });
    const second = evidence({ drafts: [reversed, ...drafts.slice().reverse(), pair] });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.limitations).toHaveLength(codes.length + 1);
    expect(new Set(first.limitations.map((entry) => entry.code))).toEqual(new Set(codes));
  });

  test("projection and option ordering cannot change report bytes", () => {
    const first = runDrc(buildFixture(), { ignoredRuleClasses: ["dfm", "electrical", "dfm"], waivedIds: ["b", "a", "b"], severityOverrides: { TRACE_WIDTH_MIN: "warning", VIA_DRILL_MIN: "ignore" } });
    const second = runDrc(reversedEverything(), { ignoredRuleClasses: ["electrical", "dfm"], waivedIds: ["a", "b"], severityOverrides: { VIA_DRILL_MIN: "ignore", TRACE_WIDTH_MIN: "warning" } });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("live/pending finalization does not mint batch evidence", () => {
    const report = finalizeReport([draft("TRACE_WIDTH_MIN")], {
      designId: "", revision: 0, ignoredRuleClasses: [], waivedIds: [], severityOverrides: {},
    });
    expect(report).not.toHaveProperty("evidence");
  });
});

describe("execution evidence validation", () => {
  test("current evidence survives JSON transport without byte changes", () => {
    const original = evidence({ drafts: [draft("DRC_RULE_INVALID")] });
    expect(JSON.stringify(parseDrcRunEvidence(JSON.parse(JSON.stringify(original))))).toBe(JSON.stringify(original));
  });

  test.each([
    undefined, null, [], {}, { version: 2 },
    { ...evidence(), executedStages: [3] },
    { ...evidence(), ignoredRuleClasses: ["future"] },
    { ...evidence(), ignoredRuleCodes: ["FUTURE_CODE"] },
    { ...evidence(), severityOverrides: { TRACE_WIDTH_MIN: ["ignore"] } },
    { ...evidence(), waivedIds: [false] },
    { ...evidence(), limitations: [{ code: "DRC_RULE_INVALID", message: "bad", anchors: [{ kind: "net" }] }] },
  ].map((value) => ({ value })))("malformed or future metadata stays unknown: %j", ({ value }) => {
    expect(parseDrcRunEvidence(value)).toBeUndefined();
  });
});
