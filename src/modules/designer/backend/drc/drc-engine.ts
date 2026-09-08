import type {
  DesignerPcbProjection,
  DrcReport,
  DrcRuleClass,
  DrcRuleCode,
  DrcSeverity,
  DrcViolation,
} from "../../../../sdks/designer";
import { checkBoard } from "./checks/board";
import { checkClearance } from "./checks/clearance";
import { checkConnectivity } from "./checks/connectivity";
import { checkConstraints } from "./checks/constraints";
import { checkCopperPour } from "./checks/copper-pour";
import { checkDangling } from "./checks/dangling";
import { checkElectrical } from "./checks/electrical";
import { checkSignalIntegrity } from "./checks/signal-integrity";
import { checkLength } from "./checks/length";
import { checkManufacturability } from "./checks/manufacturability";
import { checkNetClass } from "./checks/netclass";
import { checkKeepouts } from "./checks/keepouts";
import { checkOutline } from "./checks/outline";
import { checkRules } from "./checks/rules";
import { checkStructural } from "./checks/structural";
import { checkZones } from "./checks/zones";
import { buildDrcContext } from "./drc-context";
import type { DrcOptions } from "./types";
import {
  DEFAULT_SEVERITY_BY_CODE,
  NON_OVERRIDABLE,
  resolveSeverity,
} from "./severity";
import { computeViolationId } from "./violation-id";

/**
 * DRC engine — pure function over the PCB projection, mirroring `runErc`.
 * Builds an mm-domain context, runs every check group, then resolves severity,
 * assigns stable ids, applies ignore/waive options, and tallies the summary.
 *
 * Every suppression option DEFAULTS from the projection (rule-semantics
 * contract §8), so the HTTP routes, the SDK (assistant, MCP) and the cloud
 * apply path produce the same report for the same projection. An explicit
 * option still wins — including an explicit empty array, which is how a caller
 * asks for an unfiltered report.
 */
/**
 * The view-state suppressions a run is PERSISTED with (contract §8). `runDrc`
 * already defaults its own filtering from the projection, so an entry point
 * passes only `lookupRawFootprint`; this is the record of which view produced
 * the stored report. One helper, so the HTTP route and the SDK cannot persist
 * different options for the same projection.
 */
export function drcOptionsFromProjection(
  projection: DesignerPcbProjection,
): { ignoredRuleClasses: DrcRuleClass[]; waivedIds: string[] } {
  const view = projection.board.viewState;
  return {
    ignoredRuleClasses: [...(view?.drcIgnoredRuleClasses ?? [])],
    waivedIds: [...(view?.drcWaivedViolationIds ?? [])],
  };
}

export function runDrc(
  projection: DesignerPcbProjection,
  options: DrcOptions = {},
): DrcReport {
  const ctx = buildDrcContext(projection, options);
  const viewState = projection.board.viewState;
  const ignored = new Set(
    options.ignoredRuleClasses ?? viewState?.drcIgnoredRuleClasses ?? [],
  );
  const waived = new Set(
    options.waivedIds ?? viewState?.drcWaivedViolationIds ?? [],
  );
  const overrides =
    options.severityOverrides ?? projection.board.drcSeverityOverrides;

  const drafts = [
    // A rule table the resolver refused contextualises every verdict after it,
    // so it is reported first (contract §10).
    ...checkRules(ctx),
    ...checkOutline(ctx),
    // Zone/keepout structure runs right after the outline, for the same reason:
    // a refused area contextualises the copper violations that follow (§13.1).
    ...checkZones(ctx),
    ...checkConstraints(ctx),
    ...checkStructural(ctx),
    ...checkManufacturability(ctx),
    ...checkNetClass(ctx),
    ...checkClearance(ctx),
    ...checkConnectivity(ctx),
    ...checkCopperPour(ctx),
    ...checkDangling(ctx),
    ...checkElectrical(ctx),
    ...checkSignalIntegrity(ctx),
    ...checkLength(ctx),
    ...checkBoard(ctx),
    ...checkKeepouts(ctx),
  ];

  const violations: DrcViolation[] = [];
  const countsByCode: Partial<Record<DrcRuleCode, number>> = {};
  let errors = 0;
  let warnings = 0;
  let infos = 0;

  for (const draft of drafts) {
    // Safety-critical codes (dead shorts, layer-invalid items, refused zones,
    // dropped rules) can never be suppressed — not by a class-level ignore, a
    // per-code "ignore" override, or a waiver. NON_OVERRIDABLE is the ONE list
    // that says which (contract §7); checks no longer flag it per draft.
    const safetyCritical = NON_OVERRIDABLE.has(draft.code);
    if (!safetyCritical && ignored.has(draft.ruleClass)) continue;
    // Per-code severity: override → the rule that set the value → default table.
    // "ignore" drops the violation entirely (except safety-critical codes).
    const resolvedSeverity = resolveSeverity(
      draft.code,
      draft.ruleSeverity,
      overrides,
    );
    if (resolvedSeverity === "ignore" && !safetyCritical) continue;
    // Safety-critical codes are NON_OVERRIDABLE, so resolveSeverity always
    // returns their default (never "ignore"); this coercion is defensive.
    const severity: DrcSeverity =
      resolvedSeverity === "ignore"
        ? DEFAULT_SEVERITY_BY_CODE[draft.code]
        : resolvedSeverity;

    const { ruleSeverity: _ruleSeverity, ...rest } = draft;
    const id = computeViolationId({
      code: draft.code,
      anchors: draft.anchors,
      layer: draft.layer,
      locationMm: draft.locationMm,
    });
    // Safety-critical codes can never be suppressed by a user waiver either —
    // audit B5-VIA-MASK / NET_SHORT_CIRCUIT.
    const isWaived = !safetyCritical && waived.has(id);
    const resolved = { ...rest, severity, id };
    violations.push(isWaived ? { ...resolved, waived: true } : resolved);
    countsByCode[draft.code] = (countsByCode[draft.code] ?? 0) + 1;
    if (!isWaived) {
      if (severity === "error") errors += 1;
      else if (severity === "warning") warnings += 1;
      else infos += 1;
    }
  }

  return {
    designId: projection.designId,
    revision: projection.revision,
    violations,
    summary: { errors, warnings, infos },
    countsByCode,
  };
}
