import type { ResolvedValue } from "./rule-resolver";
import { below } from "../pcb-geometry/tolerance";

/**
 * The ONE way a violation message names the scoped rule behind its threshold
 * (rule-semantics contract §4.1, §5.1).
 *
 * A matched rule is attributed even when its own number did not survive the
 * clamp — it matched FIRST, so it shadowed every lower-priority rule, and the
 * author has to be able to find it (§2.1, Astra run 1 #7). But saying only
 * `(rule "X")` next to a threshold X did not set is a lie the reader cannot
 * detect, so a clamped rule says so and names the number that actually applied.
 */
export function ruleSuffix(resolved: ResolvedValue): string {
  const rule = resolved.rule;
  if (!rule) return "";
  const authoredMm =
    rule.constraint.kind === "clearance"
      ? rule.constraint.mm
      : rule.constraint.minMm;
  if (!below(authoredMm, resolved.mm)) return ` (rule "${rule.name}")`;
  // Clearance rules are clamped by the absolute floor, scalars by their own
  // board minimum — the two tiers the reader has to go and look at.
  const clampedBy =
    rule.constraint.kind === "clearance" ? "floor" : "board minimum";
  return ` (rule "${rule.name}", clamped to the ${clampedBy} ${resolved.mm.toFixed(3)} mm)`;
}
