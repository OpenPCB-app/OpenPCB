import type { PcbNetClass } from "../../../../sdks";

/**
 * Validation for agent-proposed design-rule changes (`pcb_set_design_rules`).
 *
 * The designer store parses rules leniently (any finite number, duplicate ids
 * kept) and MCP writes never pass through the HTTP route parsers, so an agent
 * could otherwise stage a zero-width class, a via whose drill is wider than
 * its pad, or a second class that silently shares an id with an existing one.
 * These checks are physical sanity, not manufacturing limits: they never
 * invent a minimum — anything > 0 that is geometrically coherent passes, and
 * fab capability stays a DRC matter.
 */

export interface NetClassPatch {
  id?: string;
  name: string;
  traceWidthMm?: number;
  clearanceMm?: number;
  viaDiameterMm?: number;
  viaDrillMm?: number;
}

const DIMENSIONS = ["traceWidthMm", "clearanceMm", "viaDiameterMm", "viaDrillMm"] as const;

export function normalizeClassName(name: string): string {
  return name.trim().toLowerCase();
}

export function slugId(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "class";
}

/** `base`, else `base-2`, `base-3`… — never an id already taken. */
export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function positive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Problems with one class's geometry (empty when coherent). */
export function netClassProblems(netClass: Pick<PcbNetClass, "name" | (typeof DIMENSIONS)[number]>): string[] {
  const problems: string[] = [];
  const label = netClass.name.trim() || "(unnamed)";
  if (!netClass.name.trim()) problems.push("a net class name must not be empty");
  for (const key of DIMENSIONS) {
    if (!positive(netClass[key])) problems.push(`${label}: ${key} must be a number > 0`);
  }
  if (
    positive(netClass.viaDrillMm) &&
    positive(netClass.viaDiameterMm) &&
    netClass.viaDrillMm >= netClass.viaDiameterMm
  ) {
    problems.push(
      `${label}: viaDrillMm (${netClass.viaDrillMm}) must be smaller than viaDiameterMm (${netClass.viaDiameterMm})`,
    );
  }
  return problems;
}

export interface NetClassPatchOutcome {
  classes: PcbNetClass[];
  changes: string[];
  problems: string[];
}

/**
 * Apply patches to the board's classes. Matching: by `id` when one is given,
 * else by name (trimmed, case-insensitive). A new class needs all four
 * dimensions, gets a unique id (an explicit id that collides is refused), and
 * copies only presentation fields (color, default via protection) from the
 * first class — never electrical metadata (voltage, current, pair gap) that
 * belongs to another class. Every class a patch touched is validated; ids and
 * names must be unique across the result.
 */
export function applyNetClassPatches(
  existing: readonly PcbNetClass[],
  patches: readonly NetClassPatch[],
): NetClassPatchOutcome {
  const problems: string[] = [];
  const changes: string[] = [];
  const classes = existing.map((c) => ({ ...c }));
  const template = existing[0];
  const touched = new Set<number>();

  for (const patch of patches) {
    const name = patch.name?.trim() ?? "";
    const index = patch.id
      ? classes.findIndex((c) => c.id === patch.id)
      : classes.findIndex((c) => normalizeClassName(c.name) === normalizeClassName(name));
    if (index >= 0) {
      if (touched.has(index)) {
        problems.push(`net class '${classes[index]!.name}' is changed twice in one call`);
        continue;
      }
      touched.add(index);
      const next = { ...classes[index]! };
      if (name) next.name = name;
      for (const key of DIMENSIONS) {
        if (patch[key] !== undefined) next[key] = patch[key]!;
      }
      classes[index] = next;
      changes.push(`net class ${next.name}`);
      continue;
    }
    if (!template) {
      problems.push("the board has no net classes to extend");
      continue;
    }
    const missing = DIMENSIONS.filter((k) => patch[k] === undefined);
    if (missing.length > 0) {
      problems.push(`new net class '${name || patch.id}' needs ${missing.join(", ")} — give the values explicitly`);
      continue;
    }
    const taken = new Set(classes.map((c) => c.id));
    if (patch.id && taken.has(patch.id)) {
      problems.push(`net class id '${patch.id}' is already used`);
      continue;
    }
    const created: PcbNetClass = {
      id: patch.id ?? uniqueId(slugId(name), taken),
      name,
      traceWidthMm: patch.traceWidthMm!,
      clearanceMm: patch.clearanceMm!,
      viaDiameterMm: patch.viaDiameterMm!,
      viaDrillMm: patch.viaDrillMm!,
      color: template.color,
      defaultViaProtection: template.defaultViaProtection,
    };
    classes.push(created);
    touched.add(classes.length - 1);
    changes.push(`new net class ${name}`);
  }

  for (const index of touched) problems.push(...netClassProblems(classes[index]!));
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const c of classes) {
    if (ids.has(c.id)) problems.push(`net class id '${c.id}' is used twice`);
    ids.add(c.id);
    const key = normalizeClassName(c.name);
    if (names.has(key)) problems.push(`net class name '${c.name}' is used twice`);
    names.set(key, c.id);
  }
  return { classes, changes, problems };
}

/** Clearance values must be finite and > 0 (a zero clearance is a short). */
export function clearanceProblems(clearance: Record<string, number | undefined>): string[] {
  return Object.entries(clearance)
    .filter(([, value]) => value !== undefined && !positive(value))
    .map(([key]) => `clearance ${key} must be a number > 0`);
}
