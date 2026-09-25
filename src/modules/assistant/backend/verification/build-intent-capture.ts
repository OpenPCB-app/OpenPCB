/**
 * BuildIntent capture: turn a `library_resolve_bom` or `compile_circuit`
 * result into the expected BOM + required nets the Definition-of-Done verifier
 * (`run-dod.ts`) checks a finished design against.
 *
 * Pure and shared: the in-app run loop captures after those tool calls
 * (`run-service.ts`), and so does the MCP projection, so `designer_verify_build`
 * gives an external agent the same verification the in-app assistant runs.
 */

import type { BuildIntentItem } from "./types";

export interface CapturedIntent {
  goal: string;
  items: BuildIntentItem[];
}

/** Minimal shape of the library_resolve_bom result we read for BuildIntent. */
interface BomResultShape {
  goal?: unknown;
  items?: Array<{
    role?: unknown;
    quantity?: number;
    value?: unknown;
    selected?: { componentId: string } | null;
  }>;
}

/** Minimal shape of the compile_circuit result we read for BuildIntent. */
interface CompileResultShape {
  placedCount?: number;
  bom?: Array<{
    role?: unknown;
    componentId?: string;
    quantity?: number;
    value?: unknown;
  }>;
}

/**
 * Canonical power-rail net name for a single voltage token. Keeps distinct rails
 * distinct: +5V → "+5V", 3V3/3.3V → "+3V3", 12V → "+12V". Returns null for tokens
 * that are not a recognisable rail. F7a: do NOT collapse every rail to "VCC" —
 * a multi-rail build (e.g. +5V and +3V3) must keep them separate so the DoD
 * `nets_wired` check is meaningful.
 */
function railNetName(token: string): string | null {
  // Accept 5V, +5V, 3.3V, 3V3, 1V8, 12V. `whole` digits, optional fractional
  // digits separated by "." or "v" (either before or after the trailing V).
  const m = /^[+]?(\d+)(?:\.(\d+)v|v(\d+)|v)$/i.exec(token.replace(/\s+/g, ""));
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? m[3];
  return frac ? `+${whole}V${frac}` : `+${whole}V`;
}

/**
 * Deterministically derive the nets a BOM item is expected to participate in
 * from its role keyword plus any explicit voltage in its value/role text. Used by
 * the DoD `nets_wired` check. Conservative: only power/ground rails are inferred,
 * since those are the connections a build is most likely to leave dangling.
 *
 * F7a: explicit rails keep their REAL names (+5V, +3V3, +12V); only a bare,
 * voltage-less power role falls back to the generic "VCC".
 */
export function requiredNetsForItem(
  role: string,
  value: string | undefined,
): string[] {
  const r = role.toLowerCase();
  const nets = new Set<string>();
  if (/(gnd|ground|return)/.test(r)) nets.add("GND");
  const isPower = /(vcc|vdd|\+?\d+v|3\.3v|power|supply|rail)/.test(r);
  if (isPower) {
    // Pull explicit rail tokens out of the role text and the item value.
    const haystack = `${role} ${value ?? ""}`;
    const tokens = haystack.match(/[+]?\d+(?:\.\d+v|v\d+|v)\b/gi) ?? [];
    let added = false;
    for (const token of tokens) {
      const rail = railNetName(token);
      if (rail) {
        nets.add(rail);
        added = true;
      }
    }
    if (!added) nets.add("VCC");
  }
  return [...nets];
}


function toIntentItem(item: {
  role?: unknown;
  componentId: string;
  quantity?: number;
  value?: unknown;
}): BuildIntentItem {
  const role = typeof item.role === "string" ? item.role : "";
  const value = typeof item.value === "string" ? item.value : undefined;
  return {
    role: role || "part",
    componentId: item.componentId,
    quantity:
      Number.isFinite(item.quantity) && (item.quantity ?? 0) > 0
        ? Math.floor(item.quantity!)
        : 1,
    value,
    requiredNets: requiredNetsForItem(role, value),
  };
}

/** Intent from a `library_resolve_bom` result (its full `data` JSON). */
export function intentFromBomResult(resultJson: string): CapturedIntent | null {
  let parsed: BomResultShape;
  try {
    parsed = JSON.parse(resultJson) as BomResultShape;
  } catch {
    return null;
  }
  const items = (Array.isArray(parsed?.items) ? parsed.items : [])
    .filter((item) => item.selected?.componentId)
    .map((item) => toIntentItem({ ...item, componentId: item.selected!.componentId }));
  if (items.length === 0) return null;
  return { goal: typeof parsed.goal === "string" ? parsed.goal : "", items };
}

/**
 * Intent from a `compile_circuit` result. Only a compile that actually placed
 * parts is worth verifying — an unresolved compile placed nothing and already
 * told the model to fix the IR.
 */
export function intentFromCompileResult(resultJson: string): CapturedIntent | null {
  let parsed: CompileResultShape;
  try {
    parsed = JSON.parse(resultJson) as CompileResultShape;
  } catch {
    return null;
  }
  if (!parsed || (parsed.placedCount ?? 0) <= 0) return null;
  const items = (Array.isArray(parsed.bom) ? parsed.bom : [])
    .filter((item) => typeof item.componentId === "string" && item.componentId)
    .map((item) => toIntentItem({ ...item, componentId: item.componentId! }));
  if (items.length === 0) return null;
  return { goal: "", items };
}
