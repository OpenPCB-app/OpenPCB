/**
 * Server-authoritative tag bucketing. The frontend used to derive these
 * categories client-side (`src/modules/library/frontend/tag-grouping.ts`),
 * which meant "OTHER" became a junk drawer the moment a tag wasn't on a
 * hardcoded list and counts couldn't be made intersection-aware.
 *
 * All facet bucketing now lives here so the backend can compute counts
 * once, per-query, against the canonical component set.
 */

export type TagBucket = "family" | "package" | "mount" | "system" | "other";

export const MOUNT_TAGS: ReadonlySet<string> = new Set([
  "smd",
  "smt",
  "tht",
  "through-hole",
]);

export const FAMILY_TAGS: ReadonlySet<string> = new Set([
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "led",
  "mosfet",
  "transistor",
  "bjt",
  "ic",
  "mcu",
  "opamp",
  "op-amp",
  "connector",
  "header",
  "socket",
  "crystal",
  "oscillator",
  "sensor",
  "passive",
  "active",
  "power",
  "analog",
  "digital",
  "logic",
  "regulator",
  "amplifier",
  "rectifier",
  "ldo",
  "timer",
  "zener",
  "nmos",
  "pmos",
  "npn",
  "pnp",
  "nand",
  "nor",
  "and",
  "or",
  "xor",
  "buffer",
  "inverter",
  "opto",
]);

const SYSTEM_TAGS: ReadonlySet<string> = new Set([
  "builtin",
  "system",
  "core",
  "drawn-footprint",
  "placeholder-footprint",
  "user",
  "kicad-derived",
]);

const PACKAGE_PATTERNS: readonly RegExp[] = [
  /^\d{4}$/, // 0402, 0603, 0805, 1206…
  /^sot-?\d/i,
  /^sod-?\d/i,
  /^qfn-?\d/i,
  /^tqfp-?\d/i,
  /^dip-?\d/i,
  /^soic-?\d/i,
  /^bga-?\d/i,
  /^lqfp-?\d/i,
  /^msop-?\d/i,
  /^to-?\d/i,
  /^sma$/i,
  /^smb$/i,
  /^smc$/i,
];

/** Classify a single normalized tag into its facet bucket. */
export function bucketTag(tag: string): TagBucket {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return "other";
  if (MOUNT_TAGS.has(normalized)) return "mount";
  if (FAMILY_TAGS.has(normalized)) return "family";
  if (SYSTEM_TAGS.has(normalized)) return "system";
  for (const pattern of PACKAGE_PATTERNS) {
    if (pattern.test(normalized)) return "package";
  }
  return "other";
}
