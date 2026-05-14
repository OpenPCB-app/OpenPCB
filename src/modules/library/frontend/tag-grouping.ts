import type { LibraryTagStat } from "../../../sdks/library";

export type TagGroupId = "mount" | "package" | "family" | "system" | "other";

export interface TagGroupDescriptor {
  id: TagGroupId;
  label: string;
}

export interface GroupedTagEntry {
  group: TagGroupDescriptor;
  tags: LibraryTagStat[];
}

const MOUNT_TAGS = new Set(["smd", "smt", "tht", "through-hole"]);

const FAMILY_TAGS = new Set([
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "led",
  "mosfet",
  "transistor",
  "ic",
  "mcu",
  "opamp",
  "connector",
  "header",
  "crystal",
  "oscillator",
  "sensor",
  "passive",
  "active",
  "power",
  "analog",
  "digital",
]);

const SYSTEM_TAGS = new Set([
  "builtin",
  "system",
  "core",
  "drawn-footprint",
  "placeholder-footprint",
  "user",
]);

const PACKAGE_PATTERNS: RegExp[] = [
  /^\d{4}$/, // 0402, 0603, 0805, 1206...
  /^sot-?\d/i,
  /^qfn-?\d/i,
  /^tqfp-?\d/i,
  /^dip-?\d/i,
  /^soic-?\d/i,
  /^bga-?\d/i,
  /^lqfp-?\d/i,
  /^msop-?\d/i,
  /^to-?\d/i,
];

const GROUP_ORDER: TagGroupDescriptor[] = [
  { id: "family", label: "Family" },
  { id: "package", label: "Package" },
  { id: "mount", label: "Mount" },
  { id: "other", label: "Other" },
  { id: "system", label: "System" },
];

export function classifyTag(tag: string): TagGroupId {
  const normalized = tag.trim().toLowerCase();
  if (MOUNT_TAGS.has(normalized)) return "mount";
  if (FAMILY_TAGS.has(normalized)) return "family";
  if (SYSTEM_TAGS.has(normalized)) return "system";
  for (const pattern of PACKAGE_PATTERNS) {
    if (pattern.test(normalized)) return "package";
  }
  return "other";
}

export interface GroupTagsOptions {
  excludeSystem?: boolean;
  /** When set, drops groups that have no entries instead of returning empty rows. */
  dropEmpty?: boolean;
}

/**
 * Splits a flat list of tag stats into ordered groups (Family / Package / Mount / Other / System).
 * Tags within each group are sorted by descending count, then alphabetically.
 */
export function groupTags(
  tags: readonly LibraryTagStat[],
  options: GroupTagsOptions = {},
): GroupedTagEntry[] {
  const buckets = new Map<TagGroupId, LibraryTagStat[]>();
  for (const descriptor of GROUP_ORDER) {
    buckets.set(descriptor.id, []);
  }

  for (const stat of tags) {
    const groupId = classifyTag(stat.tag);
    if (options.excludeSystem && groupId === "system") continue;
    buckets.get(groupId)!.push(stat);
  }

  for (const list of buckets.values()) {
    list.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag);
    });
  }

  const result: GroupedTagEntry[] = [];
  for (const descriptor of GROUP_ORDER) {
    const list = buckets.get(descriptor.id)!;
    if (options.dropEmpty && list.length === 0) continue;
    result.push({ group: descriptor, tags: list });
  }
  return result;
}

/** Normalizes a free-text tag for storage/comparison. */
export function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

/** De-duplicates and normalizes a list of tags, preserving first-occurrence order. */
export function normalizeTagList(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const normalized = normalizeTag(raw);
    if (normalized.length === 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
