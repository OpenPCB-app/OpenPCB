import type { DrcReport } from "../../../../sdks";

/**
 * DRC numbers an agent may quote. A report's `violations.length` counts
 * waived violations too, and says nothing about violations an ignored rule
 * class or an "ignore" severity override hid. An agent that reports that one
 * number can call a board with suppressed problems "clean" — so MCP tools
 * report the split, and the summary line spells the suppression out.
 */
export interface DrcCounts {
  /** Violations that still count: listed and not waived. */
  active: number;
  errors: number;
  warnings: number;
  infos: number;
  /** Listed with `waived: true` — acknowledged by the user, still present. */
  waived: number;
  /** Hidden entirely by `drcIgnoredRuleClasses`. */
  ignoredByRuleClass: number;
  /** Hidden entirely by a per-code "ignore" severity override. */
  ignoredBySeverity: number;
  /** Everything the checks found, before any suppression. */
  raw: number;
}

export function drcCounts(report: DrcReport): DrcCounts {
  const waived = report.violations.filter((v) => v.waived).length;
  const ignoredByRuleClass = report.suppressed?.byRuleClass ?? 0;
  const ignoredBySeverity = report.suppressed?.bySeverityOverride ?? 0;
  const active = report.violations.length - waived;
  return {
    active,
    errors: report.summary.errors,
    warnings: report.summary.warnings,
    infos: report.summary.infos,
    waived,
    ignoredByRuleClass,
    ignoredBySeverity,
    raw: active + waived + ignoredByRuleClass + ignoredBySeverity,
  };
}

/** One line for tool summaries; never "clean" while anything is suppressed. */
export function drcCountsLine(counts: DrcCounts): string {
  const head = `DRC: ${counts.active} active violation(s) (${counts.errors} error(s), ${counts.warnings} warning(s))`;
  const hidden = counts.ignoredByRuleClass + counts.ignoredBySeverity;
  if (counts.waived === 0 && hidden === 0) return `${head}.`;
  const parts: string[] = [];
  if (counts.waived > 0) parts.push(`${counts.waived} waived`);
  if (counts.ignoredByRuleClass > 0) {
    parts.push(`${counts.ignoredByRuleClass} hidden by ignored rule classes`);
  }
  if (counts.ignoredBySeverity > 0) {
    parts.push(`${counts.ignoredBySeverity} hidden by "ignore" severity overrides`);
  }
  return `${head}; plus ${parts.join(", ")} — ${counts.raw} found before suppression. Do not describe the board as clean while any are suppressed.`;
}
