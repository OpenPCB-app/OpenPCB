import { DRC_RULE_CLASSES } from "../../sdks/designer";
import type {
  DrcAnchor,
  DrcRuleCode,
  DrcRunEvidence,
} from "../../sdks/designer";
import { NON_OVERRIDABLE, RULE_CLASS_BY_CODE } from "./severity";
import type { DrcSeverityOverrides } from "./severity";
import type { DrcViolationDraft } from "./types";

// These codes explicitly report refused/invalid inputs, unsupported objects, or
// an unavailable assessment. Other findings remain violations, not coverage claims.
const LIMITATION_CODES = new Set<DrcRuleCode>([
  "DRC_RULE_INVALID",
  "DRC_RULE_INEFFECTIVE",
  "NET_LENGTH_UNDEFINED",
  "COPPER_SHAPE_UNCHECKED",
  "OUTLINE_WEB_UNCHECKED",
  "VIA_TYPE_UNSUPPORTED",
  "ZONE_FILL_FAILED",
  "COURTYARD_INVALID",
  "BOARD_OUTLINE_INVALID",
  "ZONE_INVALID",
]);

function canonicalAnchor(anchor: DrcAnchor): DrcAnchor {
  if (anchor.kind === "diffPair" && anchor.pNetId > anchor.nNetId) {
    return { kind: "diffPair", pNetId: anchor.nNetId, nNetId: anchor.pNetId };
  }
  return anchor;
}

function anchorJson(anchor: DrcAnchor): string {
  return JSON.stringify(canonicalAnchor(anchor), Object.keys(anchor).sort());
}

function limitationsFromDrafts(
  drafts: readonly DrcViolationDraft[],
): DrcRunEvidence["limitations"] {
  const byKey = new Map<string, DrcRunEvidence["limitations"][number]>();
  for (const draft of drafts) {
    if (!LIMITATION_CODES.has(draft.code)) continue;
    const keys = [...new Set(draft.anchors.map(anchorJson))].sort();
    const anchors = keys.map((key) => JSON.parse(key) as DrcAnchor);
    const key = JSON.stringify([draft.code, keys, draft.message]);
    byKey.set(key, { code: draft.code, message: draft.message, anchors });
  }
  return [...byKey.keys()].sort().map((key) => byKey.get(key)!);
}

export function buildDrcRunEvidence(params: {
  drafts: readonly DrcViolationDraft[];
  executedStages: readonly string[];
  ignoredRuleClasses: DrcRunEvidence["ignoredRuleClasses"];
  waivedIds: readonly string[];
  severityOverrides: DrcSeverityOverrides | undefined;
}): DrcRunEvidence {
  const severityOverrides: DrcSeverityOverrides = {};
  const codes = Object.keys(params.severityOverrides ?? {}).sort() as DrcRuleCode[];
  for (const code of codes) {
    const severity = params.severityOverrides?.[code];
    if (severity !== undefined) severityOverrides[code] = severity;
  }
  return {
    version: 1,
    scope: "batch",
    executedStages: [...params.executedStages],
    ignoredRuleClasses: [...new Set(params.ignoredRuleClasses)].sort(),
    ignoredRuleCodes: codes.filter(
      (code) => severityOverrides[code] === "ignore" && !NON_OVERRIDABLE.has(code),
    ),
    severityOverrides,
    waivedIds: [...new Set(params.waivedIds)].sort(),
    limitations: limitationsFromDrafts(params.drafts),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleCode(value: unknown): value is DrcRuleCode {
  return typeof value === "string" && Object.hasOwn(RULE_CLASS_BY_CODE, value);
}

function isRuleClass(
  value: unknown,
): value is DrcRunEvidence["ignoredRuleClasses"][number] {
  return DRC_RULE_CLASSES.some((ruleClass) => ruleClass === value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseDrcAnchor(value: unknown): DrcAnchor | null {
  if (!isRecord(value)) return null;
  const { kind } = value;
  switch (kind) {
    case "boardEdge": return { kind };
    case "segment":
      return typeof value.traceId === "string" &&
        typeof value.index === "number" && Number.isInteger(value.index) && value.index >= 0
        ? { kind, traceId: value.traceId, index: value.index } : null;
    case "pad":
      return typeof value.placementId === "string" && typeof value.padNumber === "string"
        ? { kind, placementId: value.placementId, padNumber: value.padNumber } : null;
    case "diffPair":
      return typeof value.pNetId === "string" && typeof value.nNetId === "string"
        ? { kind, pNetId: value.pNetId, nNetId: value.nNetId } : null;
    default: return parseSingleIdAnchor(value);
  }
}

function parseSingleIdAnchor(value: Record<string, unknown>): DrcAnchor | null {
  const { kind } = value;
  switch (kind) {
    case "trace":
      return typeof value.traceId === "string" ? { kind, traceId: value.traceId } : null;
    case "via":
      return typeof value.viaId === "string" ? { kind, viaId: value.viaId } : null;
    case "freePad":
      return typeof value.freePadId === "string" ? { kind, freePadId: value.freePadId } : null;
    case "freeHole":
      return typeof value.freeHoleId === "string" ? { kind, freeHoleId: value.freeHoleId } : null;
    case "placement":
      return typeof value.placementId === "string" ? { kind, placementId: value.placementId } : null;
    case "net":
      return typeof value.netId === "string" ? { kind, netId: value.netId } : null;
    case "zone":
      return typeof value.zoneId === "string" ? { kind, zoneId: value.zoneId } : null;
    case "keepout":
      return typeof value.keepoutId === "string" ? { kind, keepoutId: value.keepoutId } : null;
    case "lengthGroup":
      return typeof value.groupId === "string" ? { kind, groupId: value.groupId } : null;
    case "rule":
      return typeof value.ruleId === "string" ? { kind, ruleId: value.ruleId } : null;
    case "overlayShape":
      return typeof value.shapeId === "string" ? { kind, shapeId: value.shapeId } : null;
    case "overlayText":
      return typeof value.textId === "string" ? { kind, textId: value.textId } : null;
    default:
      return null;
  }
}

function parseLimitations(value: unknown): DrcRunEvidence["limitations"] | null {
  if (!Array.isArray(value)) return null;
  const limitations: DrcRunEvidence["limitations"] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) || !isRuleCode(entry.code) ||
      typeof entry.message !== "string" || !Array.isArray(entry.anchors)
    ) return null;
    const anchors: DrcAnchor[] = [];
    for (const value of entry.anchors) {
      const anchor = parseDrcAnchor(value);
      if (!anchor) return null;
      anchors.push(JSON.parse(anchorJson(anchor)) as DrcAnchor);
    }
    limitations.push({ code: entry.code, message: entry.message, anchors });
  }
  return limitations;
}

/** Unknown or malformed metadata stays unknown; no batch evidence is inferred. */
export function parseDrcRunEvidence(value: unknown): DrcRunEvidence | undefined {
  if (!isRecord(value) || value.version !== 1 || value.scope !== "batch") return undefined;
  if (!isStringArray(value.executedStages) || !isStringArray(value.waivedIds)) return undefined;
  if (!Array.isArray(value.ignoredRuleClasses) || !value.ignoredRuleClasses.every(isRuleClass)) return undefined;
  if (!Array.isArray(value.ignoredRuleCodes) || !value.ignoredRuleCodes.every(isRuleCode)) return undefined;
  if (!isRecord(value.severityOverrides)) return undefined;
  const severityOverrides: DrcSeverityOverrides = {};
  for (const [code, severity] of Object.entries(value.severityOverrides)) {
    if (
      !isRuleCode(code) || typeof severity !== "string" ||
      !["error", "warning", "info", "ignore"].includes(severity)
    ) return undefined;
    severityOverrides[code] = severity as DrcSeverityOverrides[DrcRuleCode];
  }
  const limitations = parseLimitations(value.limitations);
  if (!limitations) return undefined;
  return {
    version: 1,
    scope: "batch",
    executedStages: [...value.executedStages],
    ignoredRuleClasses: [...value.ignoredRuleClasses],
    ignoredRuleCodes: [...value.ignoredRuleCodes],
    severityOverrides,
    waivedIds: [...value.waivedIds],
    limitations,
  };
}
