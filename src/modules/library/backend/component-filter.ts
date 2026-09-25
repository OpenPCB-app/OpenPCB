/**
 * The ONE predicate behind both the component list (`GET /components`) and the
 * facet rail (`GET /facets`). They used to match differently — the list
 * searched `sourceId` and matched mount filters against freeform tags only,
 * the facets searched name/description only and read the footprint's mount —
 * so counts and rows disagreed. Both endpoints now normalise every row with
 * `toFilterableComponent` and judge it with `matchesQuery` + `matchesFacets`.
 */
import type { LibraryFacetBucket } from "../../../sdks/library";
import { bucketTag } from "./tag-bucketing";

/** Filter prefix that targets the Source facet (e.g. `source:openpcb.core`). */
export const SOURCE_TAG_PREFIX = "source:";

export type CanonicalMountKey = "smd" | "tht" | "mixed";

/**
 * Canonical mount key for a footprint `mountType` (`smd`, `through_hole`, …)
 * or a mount tag (`smt`, `tht`, `through-hole`, …). Unrecognised values
 * (e.g. the `virtual` placeholder footprint) are null.
 */
export function canonicalMountKey(
  raw: string | null,
): CanonicalMountKey | null {
  if (!raw) return null;
  switch (
    raw
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "")
  ) {
    case "smd":
    case "smt":
    case "surfacemount":
      return "smd";
    case "tht":
    case "thruhole":
    case "throughhole":
    case "pth":
      return "tht";
    case "mixed":
      return "mixed";
    default:
      return null;
  }
}

export interface FilterableComponentInput {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  isBuiltin: boolean;
  sourceId: string | null;
  sourceName: string | null;
  /** Raw `mountType` of the component's default footprint. */
  footprintMountType: string | null;
}

export interface FilterableComponent {
  id: string;
  name: string;
  nameLc: string;
  /** name + description + tags, lower-cased — the free-text search haystack. */
  haystack: string;
  family: Set<string>;
  package: Set<string>;
  mount: Set<string>;
  other: Set<string>;
  system: Set<string>;
  sourceKey: string;
  sourceLabel: string;
}

export function toFilterableComponent(
  input: FilterableComponentInput,
): FilterableComponent {
  const buckets = {
    family: new Set<string>(),
    package: new Set<string>(),
    mount: new Set<string>(),
    other: new Set<string>(),
    system: new Set<string>(),
  };
  const tags: string[] = [];
  for (const raw of input.tags) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    tags.push(tag);
    addToBucket(buckets, tag);
  }
  // The default footprint's mountType is the canonical mount signal even when
  // the component carries no explicit "smd"/"tht" tag.
  const footprintMount = canonicalMountKey(input.footprintMountType);
  if (footprintMount) buckets.mount.add(footprintMount);

  const sourceKey = input.sourceId ?? (input.isBuiltin ? "core" : "user");
  const sourceLabel =
    input.sourceName ?? (input.isBuiltin ? "Core" : (input.sourceId ?? "User"));
  return {
    id: input.id,
    name: input.name,
    nameLc: input.name.toLowerCase(),
    haystack: [input.name, input.description, ...tags].join(" ").toLowerCase(),
    ...buckets,
    sourceKey,
    sourceLabel,
  };
}

type TagBuckets = Pick<
  FilterableComponent,
  "family" | "package" | "mount" | "other" | "system"
>;

function addToBucket(buckets: TagBuckets, tag: string): void {
  const bucket = bucketTag(tag);
  if (bucket === "mount") {
    buckets.mount.add(canonicalMountKey(tag) ?? tag);
    return;
  }
  buckets[bucket].add(tag);
}

export interface LibraryFilter {
  /** Trimmed, lower-cased free-text query; empty = no query. */
  query: string;
  tokens: string[];
  source: Set<string>;
  family: Set<string>;
  package: Set<string>;
  mount: Set<string>;
  other: Set<string>;
  system: Set<string>;
}

export function parseLibraryFilter(
  query: string | undefined,
  tags: readonly string[] | undefined,
): LibraryFilter {
  const normalizedQuery = query?.trim().toLowerCase() ?? "";
  const filter: LibraryFilter = {
    query: normalizedQuery,
    tokens: tokenizeSearchQuery(normalizedQuery),
    source: new Set(),
    family: new Set(),
    package: new Set(),
    mount: new Set(),
    other: new Set(),
    system: new Set(),
  };
  for (const raw of tags ?? []) {
    const tag = raw.trim().toLowerCase();
    if (!tag) continue;
    if (tag.startsWith(SOURCE_TAG_PREFIX)) {
      filter.source.add(tag.slice(SOURCE_TAG_PREFIX.length));
      continue;
    }
    addToBucket(filter, tag);
  }
  return filter;
}

function tokenizeSearchQuery(query: string): string[] {
  return query
    .replace(/[^a-z0-9.+-]+/g, " ")
    .split(/\s+/)
    .filter(
      (token, index, all) => token.length > 0 && all.indexOf(token) === index,
    );
}

/** Phrase match, or every token somewhere in name / description / tags. */
export function matchesQuery(
  c: FilterableComponent,
  filter: LibraryFilter,
): boolean {
  if (!filter.query) return true;
  if (c.haystack.includes(filter.query)) return true;
  return (
    filter.tokens.length > 0 &&
    filter.tokens.every((token) => c.haystack.includes(token))
  );
}

/**
 * Every active facet selection except those in `skip` (intersection-aware
 * facet counts judge bucket B against every OTHER bucket's selections).
 * System tags (`user`, `builtin`, …) have no facet but still filter.
 */
export function matchesFacets(
  c: FilterableComponent,
  filter: LibraryFilter,
  skip: LibraryFacetBucket | null = null,
): boolean {
  if (
    skip !== "source" &&
    filter.source.size > 0 &&
    !filter.source.has(c.sourceKey)
  ) {
    return false;
  }
  const tagBuckets = ["family", "package", "mount", "other", "system"] as const;
  for (const bucket of tagBuckets) {
    if (bucket === skip) continue;
    for (const tag of filter[bucket]) if (!c[bucket].has(tag)) return false;
  }
  return true;
}

export function matchesLibraryFilter(
  c: FilterableComponent,
  filter: LibraryFilter,
): boolean {
  return matchesQuery(c, filter) && matchesFacets(c, filter);
}

/** 0 = exact name, 1 = name prefix, 2 = name contains, 3 = other match. */
function queryRank(c: FilterableComponent, query: string): number {
  if (!query) return 0;
  if (c.nameLc === query) return 0;
  if (c.nameLc.startsWith(query)) return 1;
  return c.nameLc.includes(query) ? 2 : 3;
}

/**
 * Stable list order: query rank, then name (binary, as SQLite orders TEXT),
 * then id — so paging with `offset` never skips or repeats a row.
 */
export function compareForList(
  a: FilterableComponent,
  b: FilterableComponent,
  filter: LibraryFilter,
): number {
  const rank = queryRank(a, filter.query) - queryRank(b, filter.query);
  if (rank !== 0) return rank;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}
