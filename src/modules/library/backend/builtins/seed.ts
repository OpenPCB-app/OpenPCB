import { eq } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import { getDb } from "../queries";
import { components, symbols } from "../schema";
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

interface BuiltinComponentSeed {
  componentId: string;
  componentName: string;
  componentDescription: string;
  symbol: BuiltinSymbolSpec;
  tags: string[];
}

const BUILTIN_TAGS = ["passive", "builtin", "system"] as const;

function listBuiltinSeeds(): BuiltinComponentSeed[] {
  return [
    {
      componentId: "builtin:resistor",
      componentName: "Resistor",
      componentDescription:
        "Generic non-polarized resistor — assign a footprint per instance.",
      symbol: buildResistorSymbolSpec(),
      tags: [...BUILTIN_TAGS],
    },
    {
      componentId: "builtin:capacitor",
      componentName: "Capacitor",
      componentDescription:
        "Generic non-polarized capacitor — assign a footprint per instance.",
      symbol: buildCapacitorSymbolSpec(),
      tags: [...BUILTIN_TAGS],
    },
  ];
}

/**
 * Idempotent seeding for OpenPCB's read-only library built-ins.
 * Re-runs cheaply on every boot via INSERT ... ON CONFLICT DO NOTHING.
 *
 * NOTE: Future PATCH/PUT routes that mutate `library_components` MUST refuse
 * any row with `is_builtin = 1`. The delete route already enforces this.
 */
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

export function seedBuiltinComponents(ctx: CoreBackendModuleContext): {
  seededComponents: number;
  seededSymbols: number;
  refreshedSymbols: number;
} {
  const db = getDb(ctx);
  const now = new Date().toISOString();
  let seededComponents = 0;
  let seededSymbols = 0;
  let refreshedSymbols = 0;

  // Wrapped in a single transaction so concurrent backend boots against a
  // shared OPENPCB_DB_PATH (e.g. dev server + integration test runner) cannot
  // interleave builtin writes. SQLite serializes BEGIN IMMEDIATE — the second
  // boot blocks until the first commits, then sees the seeded rows and exits
  // the loop without rewriting them.
  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;

    ensurePlaceholderFootprint(ctx, now, transactionalDb);

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
        seededSymbols += 1;
      } else if (
        readStoredSourceHash(existingSymbol.dataJson) !==
        entry.symbol.sourceHash
      ) {
        // Built-in spec changed (e.g. sourceHash bumped from :v1 to :v2 after a
        // geometry/text rework) — rewrite the row so existing dev databases pick
        // up the new visuals without forcing a re-import.
        transactionalDb
          .update(symbols)
          .set({
            name: entry.symbol.symbolName,
            dataJson: buildSymbolDataJson(entry.symbol, now),
          })
          .where(eq(symbols.id, entry.symbol.symbolId))
          .run();
        refreshedSymbols += 1;
      }

      const existingComponent = transactionalDb
        .select({ id: components.id })
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
            footprintId: PLACEHOLDER_FOOTPRINT_ID,
            tagsJson: JSON.stringify(entry.tags),
            createdAt: now,
            isBuiltin: 1,
          })
          .onConflictDoNothing()
          .run();
        seededComponents += 1;
      }
    }
  });

  return { seededComponents, seededSymbols, refreshedSymbols };
}

/**
 * Reserved IDs of builtin components — used by route guards (delete/clone)
 * and by the frontend to flag read-only behavior.
 */
export const BUILTIN_COMPONENT_IDS: ReadonlySet<string> = new Set(
  listBuiltinSeeds().map((seed) => seed.componentId),
);
