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
import { checkCopperToHole } from "./checks/copper-to-hole";
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
  RULE_CLASS_BY_CODE,
  severityRank,
} from "./severity";
import { computeViolationId } from "./violation-id";

/**
 * DRC engine — pure function over the PCB projection, mirroring `runErc`.
 * Builds an mm-domain context, runs all 17 check groups, then resolves severity
 * and rule class, assigns stable ids, applies ignore/waive options, and tallies
 * the summary.
 *
 * Every suppression option DEFAULTS from the projection (rule-semantics
 * contract §8), so the HTTP routes, the SDK (assistant, MCP) and the cloud
 * apply path produce the same report for the same projection. An explicit
 * option still wins — including an explicit empty array, which is how a caller
 * asks for an unfiltered report.
 *
 * The REPORT IS CANONICAL (contract 06 §6): `violations` is sorted by
 * `(code, id)` and `countsByCode` is keyed in that same code order, so
 * presentation no longer follows the order the checks happened to run in or the
 * order the projection's arrays happened to be in. The panel groups within a
 * severity band by report order, so this is user-visible, not cosmetic.
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

/** `a` is a worse witness than `b`: higher severity, then larger deficit, then smaller measured. */
function worseWitness(a: DrcViolation, b: DrcViolation): boolean {
  const ra = severityRank(a.severity);
  const rb = severityRank(b.severity);
  if (ra !== rb) return ra > rb;
  const deficit = (v: DrcViolation): number =>
    v.requiredMm !== undefined && v.measuredMm !== undefined
      ? v.requiredMm - v.measuredMm
      : -Infinity;
  const da = deficit(a);
  const db = deficit(b);
  if (da !== db) return da > db;
  return (a.measuredMm ?? Infinity) < (b.measuredMm ?? Infinity);
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
    // Copper against non-plated drills, right after the copper-to-copper pass:
    // it is the same clearance tier over a different obstacle (§4).
    ...checkCopperToHole(ctx),
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
    // The class is a per-CODE fact, not a per-draft one (contract 06 §6).
    const ruleClass = RULE_CLASS_BY_CODE[draft.code];
    if (!safetyCritical && ignored.has(ruleClass)) continue;
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
    const resolved = { ...rest, ruleClass, severity, id };
    violations.push(isWaived ? { ...resolved, waived: true } : resolved);
  }

  // Canonical order (contract 06 §6): `(code, id)` with plain string
  // comparisons. Both keys are already order-independent functions of the
  // projection, so the report is too — the check dispatch order and the input
  // array order stop reaching the output here.
  violations.sort((a, b) =>
    a.code !== b.code
      ? a.code < b.code
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  // Ids are unique per report (contract 06 §6). Two drafts CAN hash alike —
  // the several copper shapes of one pad number share a logical anchor
  // (records carry `occurrence`, anchors do not), so one pin against one hole
  // is one violation; two structural problems at one spot share an id too.
  // A measured group keeps its worst witness (smallest measured); an
  // unmeasured group keeps every message, sorted — either way the survivor is
  // a function of the geometry, never of draft order.
  const unique: DrcViolation[] = [];
  for (const v of violations) {
    const last = unique[unique.length - 1];
    if (!last || last.id !== v.id) {
      unique.push(v);
      continue;
    }
    if (v.measuredMm !== undefined || last.measuredMm !== undefined) {
      // Never let a warning outrank an error (Astra S7 #4); among equals the
      // largest deficit against ITS requirement is the worst witness.
      if (worseWitness(v, last)) unique[unique.length - 1] = v;
      continue;
    }
    const messages = new Set([...last.message.split("; "), v.message]);
    unique[unique.length - 1] = {
      ...last,
      message: [...messages].sort().join("; "),
    };
  }
  // Tallied from the SORTED, de-duplicated list, so the key insertion order is
  // code order too.
  for (const v of unique) {
    countsByCode[v.code] = (countsByCode[v.code] ?? 0) + 1;
  }

  for (const v of unique) {
    if (v.waived) continue;
    if (v.severity === "error") errors += 1;
    else if (v.severity === "warning") warnings += 1;
    else infos += 1;
  }

  return {
    designId: projection.designId,
    revision: projection.revision,
    violations: unique,
    summary: { errors, warnings, infos },
    countsByCode,
  };
}
