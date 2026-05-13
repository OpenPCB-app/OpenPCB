import { and, eq, inArray } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { getDb } from "../queries";
import {
  componentFootprints,
  components,
  footprints,
  symbols,
} from "../schema";
import {
  BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID,
  BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID,
  type BuiltinFootprintSeed,
  listAllBuiltinFootprintSeeds,
} from "./footprint-seeds";
import {
  PLACEHOLDER_FOOTPRINT_ID,
  ensurePlaceholderFootprint,
} from "./placeholder-footprint";
import {
  buildCapacitorSymbolSpec,
  buildResistorSymbolSpec,
  buildSymbolDataJson,
  type BuiltinSymbolSpec,
} from "./render-models";

interface VariantBinding {
  footprintId: string;
  variantLabel: string;
  isDefault: boolean;
  sortOrder: number;
  pinMapJson: string;
}

interface BuiltinComponentSeed {
  componentId: string;
  componentName: string;
  componentDescription: string;
  symbol: BuiltinSymbolSpec;
  defaultFootprintId: string;
  tags: string[];
  variants: VariantBinding[];
}

const BUILTIN_TAGS = ["passive", "builtin", "system"] as const;
const PASSIVE_PIN_MAP_JSON = JSON.stringify([
  { pinNumber: "1", padNumber: "1", pinName: "1" },
  { pinNumber: "2", padNumber: "2", pinName: "2" },
]);

/**
 * Sized component rows that previous versions of this seeder created
 * (`builtin:resistor:0402` ... `builtin:capacitor:tht-disc-d7.5`). We've moved
 * to a single `builtin:resistor` / `builtin:capacitor` component with N
 * footprint variants, so these IDs must be removed from existing dev DBs on
 * boot. Keep this list immutable — never reuse these IDs for new components.
 */
const LEGACY_SIZED_COMPONENT_IDS: readonly string[] = [
  "builtin:resistor:0402",
  "builtin:resistor:0603",
  "builtin:resistor:0805",
  "builtin:resistor:1206",
  "builtin:resistor:1210",
  "builtin:resistor:2512",
  "builtin:resistor:tht-din0207-p7.62",
  "builtin:resistor:tht-din0207-p10.16",
  "builtin:resistor:tht-din0309",
  "builtin:capacitor:0402",
  "builtin:capacitor:0603",
  "builtin:capacitor:0805",
  "builtin:capacitor:1206",
  "builtin:capacitor:1210",
  "builtin:capacitor:tht-disc-d3",
  "builtin:capacitor:tht-disc-d5",
  "builtin:capacitor:tht-disc-d7.5",
];

interface VariantInput {
  footprintId: string;
  variantLabel: string;
}

const RESISTOR_VARIANTS: readonly VariantInput[] = [
  {
    footprintId: "builtin:fp:r-0402-1005m",
    variantLabel: "0402 (1005 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-0603-1608m",
    variantLabel: "0603 (1608 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-0805-2012m",
    variantLabel: "0805 (2012 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-1206-3216m",
    variantLabel: "1206 (3216 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-1210-3225m",
    variantLabel: "1210 (3225 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-2512-6332m",
    variantLabel: "2512 (6332 metric) SMD",
  },
  {
    footprintId: "builtin:fp:r-axial-din0207-p7.62",
    variantLabel: "1/4W axial DIN0207, 7.62mm pitch (THT)",
  },
  {
    footprintId: "builtin:fp:r-axial-din0207-p10.16",
    variantLabel: "1/4W axial DIN0207, 10.16mm pitch (THT)",
  },
  {
    footprintId: "builtin:fp:r-axial-din0309-p12.70",
    variantLabel: "1/2W axial DIN0309, 12.70mm pitch (THT)",
  },
];

const CAPACITOR_VARIANTS: readonly VariantInput[] = [
  {
    footprintId: "builtin:fp:c-0402-1005m",
    variantLabel: "0402 (1005 metric) SMD",
  },
  {
    footprintId: "builtin:fp:c-0603-1608m",
    variantLabel: "0603 (1608 metric) SMD",
  },
  {
    footprintId: "builtin:fp:c-0805-2012m",
    variantLabel: "0805 (2012 metric) SMD",
  },
  {
    footprintId: "builtin:fp:c-1206-3216m",
    variantLabel: "1206 (3216 metric) SMD",
  },
  {
    footprintId: "builtin:fp:c-1210-3225m",
    variantLabel: "1210 (3225 metric) SMD",
  },
  {
    footprintId: "builtin:fp:c-disc-d3-p2.5",
    variantLabel: "Ceramic disc D3mm, 2.5mm pitch (THT)",
  },
  {
    footprintId: "builtin:fp:c-disc-d5-p5",
    variantLabel: "Ceramic disc D5mm, 5mm pitch (THT)",
  },
  {
    footprintId: "builtin:fp:c-disc-d7.5-p5",
    variantLabel: "Ceramic disc D7.5mm, 5mm pitch (THT)",
  },
];

function buildVariantBindings(
  variants: readonly VariantInput[],
  defaultFootprintId: string,
): VariantBinding[] {
  return variants.map((entry, index) => ({
    footprintId: entry.footprintId,
    variantLabel: entry.variantLabel,
    isDefault: entry.footprintId === defaultFootprintId,
    sortOrder: index,
    pinMapJson: PASSIVE_PIN_MAP_JSON,
  }));
}

function listBuiltinSeeds(): BuiltinComponentSeed[] {
  return [
    {
      componentId: "builtin:resistor",
      componentName: "Resistor",
      componentDescription:
        "Generic non-polarized resistor — defaults to 0603 (1608 metric) chip; pick another variant per instance.",
      symbol: buildResistorSymbolSpec(),
      defaultFootprintId: BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID,
      tags: [...BUILTIN_TAGS],
      variants: buildVariantBindings(
        RESISTOR_VARIANTS,
        BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID,
      ),
    },
    {
      componentId: "builtin:capacitor",
      componentName: "Capacitor",
      componentDescription:
        "Generic non-polarized capacitor — defaults to 0603 (1608 metric) chip; pick another variant per instance.",
      symbol: buildCapacitorSymbolSpec(),
      defaultFootprintId: BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID,
      tags: [...BUILTIN_TAGS],
      variants: buildVariantBindings(
        CAPACITOR_VARIANTS,
        BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID,
      ),
    },
  ];
}

function readStoredSourceHash(dataJson: string): string | null {
  try {
    const parsed = JSON.parse(dataJson) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const provenance = (parsed as { provenance?: unknown }).provenance;
    if (!provenance || typeof provenance !== "object") return null;
    const hash = (provenance as { sourceHash?: unknown }).sourceHash;
    return typeof hash === "string" ? hash : null;
  } catch {
    return null;
  }
}

export interface SeedBuiltinsResult {
  seededComponents: number;
  seededSymbols: number;
  refreshedSymbols: number;
  seededFootprints: number;
  refreshedFootprints: number;
  repointedComponents: number;
  /** Number of (component, footprint) variant rows inserted or refreshed. */
  syncedVariants: number;
  /** Number of legacy sized component rows deleted on this boot. */
  removedLegacyComponents: number;
}

export function seedBuiltinComponents(
  ctx: CoreBackendModuleContext,
): SeedBuiltinsResult {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  const result: SeedBuiltinsResult = {
    seededComponents: 0,
    seededSymbols: 0,
    refreshedSymbols: 0,
    seededFootprints: 0,
    refreshedFootprints: 0,
    repointedComponents: 0,
    syncedVariants: 0,
    removedLegacyComponents: 0,
  };

  // Single transaction so concurrent backend boots against a shared
  // OPENPCB_DB_PATH cannot interleave builtin writes. SQLite's BEGIN IMMEDIATE
  // serializes them — second boot blocks until first commits, then exits the
  // loop without rewriting.
  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;

    ensurePlaceholderFootprint(ctx, now, transactionalDb);

    // Phase A — footprint rows. Insert if missing; refresh in place when the
    // bundled .kicad_mod content (or its `:vN` version suffix) changes.
    const fpSeeds = listAllBuiltinFootprintSeeds();
    for (const seed of fpSeeds) {
      const existing = transactionalDb
        .select({ id: footprints.id, dataJson: footprints.dataJson })
        .from(footprints)
        .where(eq(footprints.id, seed.footprintId))
        .get();
      if (!existing) {
        const built = seed.build(now);
        transactionalDb
          .insert(footprints)
          .values({
            id: seed.footprintId,
            name: seed.displayName,
            dataJson: built.dataJson,
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
        result.seededFootprints += 1;
      } else if (readStoredSourceHash(existing.dataJson) !== seed.sourceHash) {
        const built = seed.build(now);
        transactionalDb
          .update(footprints)
          .set({ name: seed.displayName, dataJson: built.dataJson })
          .where(eq(footprints.id, seed.footprintId))
          .run();
        result.refreshedFootprints += 1;
      }
    }

    // Phase B/C — symbols + components.
    for (const entry of listBuiltinSeeds()) {
      const existingSymbol = transactionalDb
        .select({ id: symbols.id, dataJson: symbols.dataJson })
        .from(symbols)
        .where(eq(symbols.id, entry.symbol.symbolId))
        .get();
      if (!existingSymbol) {
        transactionalDb
          .insert(symbols)
          .values({
            id: entry.symbol.symbolId,
            name: entry.symbol.symbolName,
            dataJson: buildSymbolDataJson(entry.symbol, now),
            createdAt: now,
          })
          .onConflictDoNothing()
          .run();
        result.seededSymbols += 1;
      } else if (
        readStoredSourceHash(existingSymbol.dataJson) !==
        entry.symbol.sourceHash
      ) {
        transactionalDb
          .update(symbols)
          .set({
            name: entry.symbol.symbolName,
            dataJson: buildSymbolDataJson(entry.symbol, now),
          })
          .where(eq(symbols.id, entry.symbol.symbolId))
          .run();
        result.refreshedSymbols += 1;
      }

      const existingComponent = transactionalDb
        .select({ id: components.id, footprintId: components.footprintId })
        .from(components)
        .where(eq(components.id, entry.componentId))
        .get();
      if (!existingComponent) {
        transactionalDb
          .insert(components)
          .values({
            id: entry.componentId,
            name: entry.componentName,
            description: entry.componentDescription,
            symbolId: entry.symbol.symbolId,
            footprintId: entry.defaultFootprintId,
            tagsJson: JSON.stringify(entry.tags),
            createdAt: now,
            isBuiltin: 1,
          })
          .onConflictDoNothing()
          .run();
        result.seededComponents += 1;
      } else {
        // Repoint: legacy dev DBs may still have the placeholder or a stale
        // default; rewrite to the canonical default and refresh description /
        // tags so user-visible copy stays current.
        const stale =
          existingComponent.footprintId !== entry.defaultFootprintId;
        transactionalDb
          .update(components)
          .set({
            name: entry.componentName,
            description: entry.componentDescription,
            footprintId: entry.defaultFootprintId,
            tagsJson: JSON.stringify(entry.tags),
            isBuiltin: 1,
          })
          .where(eq(components.id, entry.componentId))
          .run();
        if (stale) result.repointedComponents += 1;
      }

      // Phase D — sync the variant join rows for this component. Drop rows
      // pointing to footprints that no longer exist in the seed set, then
      // upsert each desired binding. Keeps the picker dropdown authoritative.
      const desiredFootprintIds = new Set(
        entry.variants.map((v) => v.footprintId),
      );
      const currentVariantRows = transactionalDb
        .select({
          footprintId: componentFootprints.footprintId,
          isDefault: componentFootprints.isDefault,
          variantLabel: componentFootprints.variantLabel,
          sortOrder: componentFootprints.sortOrder,
          pinMapJson: componentFootprints.pinMapJson,
        })
        .from(componentFootprints)
        .where(eq(componentFootprints.componentId, entry.componentId))
        .all();
      const currentByFp = new Map(
        currentVariantRows.map((row) => [row.footprintId, row]),
      );

      // Delete bindings no longer in the seed list.
      for (const row of currentVariantRows) {
        if (!desiredFootprintIds.has(row.footprintId)) {
          transactionalDb
            .delete(componentFootprints)
            .where(
              and(
                eq(componentFootprints.componentId, entry.componentId),
                eq(componentFootprints.footprintId, row.footprintId),
              ),
            )
            .run();
        }
      }

      // Insert / refresh desired bindings.
      for (const variant of entry.variants) {
        const existing = currentByFp.get(variant.footprintId);
        const desiredIsDefault = variant.isDefault ? 1 : 0;
        if (!existing) {
          transactionalDb
            .insert(componentFootprints)
            .values({
              componentId: entry.componentId,
              footprintId: variant.footprintId,
              isDefault: desiredIsDefault,
              variantLabel: variant.variantLabel,
              sortOrder: variant.sortOrder,
              pinMapJson: variant.pinMapJson,
            })
            .onConflictDoNothing()
            .run();
          result.syncedVariants += 1;
        } else if (
          existing.isDefault !== desiredIsDefault ||
          existing.variantLabel !== variant.variantLabel ||
          existing.sortOrder !== variant.sortOrder ||
          existing.pinMapJson !== variant.pinMapJson
        ) {
          transactionalDb
            .update(componentFootprints)
            .set({
              isDefault: desiredIsDefault,
              variantLabel: variant.variantLabel,
              sortOrder: variant.sortOrder,
              pinMapJson: variant.pinMapJson,
            })
            .where(
              and(
                eq(componentFootprints.componentId, entry.componentId),
                eq(componentFootprints.footprintId, variant.footprintId),
              ),
            )
            .run();
          result.syncedVariants += 1;
        }
      }
    }

    // Phase E — remove legacy sized components introduced by an earlier seeder
    // version. Their footprint rows are still seeded under Phase A, so deleting
    // these component rows leaves the catalog intact.
    const legacyHits = transactionalDb
      .select({ id: components.id })
      .from(components)
      .where(inArray(components.id, [...LEGACY_SIZED_COMPONENT_IDS]))
      .all();
    if (legacyHits.length > 0) {
      transactionalDb
        .delete(componentFootprints)
        .where(
          inArray(
            componentFootprints.componentId,
            legacyHits.map((row) => row.id),
          ),
        )
        .run();
      transactionalDb
        .delete(components)
        .where(
          inArray(
            components.id,
            legacyHits.map((row) => row.id),
          ),
        )
        .run();
      result.removedLegacyComponents += legacyHits.length;
    }

    // Phase F — repoint any pre-existing generic Resistor/Capacitor row still
    // pinned to the old placeholder footprint (very-legacy dev DBs predating
    // sized rows). Idempotent — only fires when the row exists with the
    // placeholder set.
    const repointMap: Array<{ id: string; footprintId: string }> = [
      {
        id: "builtin:resistor",
        footprintId: BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID,
      },
      {
        id: "builtin:capacitor",
        footprintId: BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID,
      },
    ];
    for (const target of repointMap) {
      const stillStale = transactionalDb
        .select({ id: components.id })
        .from(components)
        .where(
          and(
            eq(components.id, target.id),
            eq(components.isBuiltin, 1),
            eq(components.footprintId, PLACEHOLDER_FOOTPRINT_ID),
          ),
        )
        .all();
      if (stillStale.length === 0) continue;
      transactionalDb
        .update(components)
        .set({ footprintId: target.footprintId })
        .where(
          and(
            eq(components.id, target.id),
            eq(components.isBuiltin, 1),
            eq(components.footprintId, PLACEHOLDER_FOOTPRINT_ID),
          ),
        )
        .run();
      result.repointedComponents += stillStale.length;
    }
  });

  return result;
}

const BUILTIN_SEED_LIST_CACHED = listBuiltinSeeds();

/** Reserved IDs of builtin components — used by route guards (delete/clone) */
export const BUILTIN_COMPONENT_IDS: ReadonlySet<string> = new Set(
  BUILTIN_SEED_LIST_CACHED.map((seed) => seed.componentId),
);

/** All footprint IDs reserved by builtin seeding (excluding the placeholder). */
export const BUILTIN_FOOTPRINT_IDS: ReadonlySet<string> = new Set(
  listAllBuiltinFootprintSeeds().map(
    (seed: BuiltinFootprintSeed) => seed.footprintId,
  ),
);

/** Legacy sized component IDs that the seeder removes on boot. Exported for tests. */
export const LEGACY_SIZED_COMPONENT_IDS_FOR_TESTS = LEGACY_SIZED_COMPONENT_IDS;
