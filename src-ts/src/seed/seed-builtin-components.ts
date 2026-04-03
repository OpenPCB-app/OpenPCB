import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type * as schema from "../db/schema";
import { component } from "../db/schema";
import type { ComponentRepository } from "../db/repositories/component-repository";
import { parseKicadSymbolLib } from "../infrastructure/parsers/kicad/kicad-symbol-parser";
import { parseKicadFootprint } from "../infrastructure/parsers/kicad/kicad-footprint-parser";
import type { FootprintOption } from "../db/schema/component-variant";

const LIB_ROOT = join(process.cwd(), "../lib/components/built-in");

interface BuiltinComponentDef {
  canonicalKey: string;
  displayLabel: string;
  description: string;
  categoryPath: string;
  tags: string[];
  symbolFile: string;
  symbolName: string;
  variants?: BuiltinVariantDef[];
}

interface BuiltinVariantDef {
  canonicalCode: string;
  humanLabel: string;
  mountType: "smd" | "through_hole" | "virtual";
  isDefault: boolean;
  footprintFile: string;
}

const BUILTIN_COMPONENTS: BuiltinComponentDef[] = [
  {
    canonicalKey: "builtin:gnd",
    displayLabel: "GND",
    description: "Ground reference symbol",
    categoryPath: "Power/Ground",
    tags: ["power", "ground"],
    symbolFile: "symbols/GND.kicad_sym",
    symbolName: "GND",
  },
  {
    canonicalKey: "builtin:vcc",
    displayLabel: "VCC",
    description: "Positive supply voltage symbol",
    categoryPath: "Power/Supply",
    tags: ["power", "supply"],
    symbolFile: "symbols/VCC.kicad_sym",
    symbolName: "VCC",
  },
  {
    canonicalKey: "builtin:resistor",
    displayLabel: "Resistor",
    description: "Generic resistor — set value after placement",
    categoryPath: "Passives/Resistors",
    tags: ["passive", "resistor"],
    symbolFile: "symbols/R.kicad_sym",
    symbolName: "R",
    variants: [
      {
        canonicalCode: "0402",
        humanLabel: "0402 (1005 metric)",
        mountType: "smd",
        isDefault: false,
        footprintFile:
          "footprints/Resistor_SMD.pretty/R_0402_1005Metric.kicad_mod",
      },
      {
        canonicalCode: "0805",
        humanLabel: "0805 (2012 metric)",
        mountType: "smd",
        isDefault: true,
        footprintFile:
          "footprints/Resistor_SMD.pretty/R_0805_2012Metric.kicad_mod",
      },
      {
        canonicalCode: "1206",
        humanLabel: "1206 (3216 metric)",
        mountType: "smd",
        isDefault: false,
        footprintFile:
          "footprints/Resistor_SMD.pretty/R_1206_3216Metric.kicad_mod",
      },
    ],
  },
];

function loadSymbol(
  symbolFile: string,
  symbolName: string,
): Record<string, unknown> {
  const content = readFileSync(join(LIB_ROOT, symbolFile), "utf-8");
  const parsed = parseKicadSymbolLib(content);
  const symbol = parsed.symbols.find((s) => s.name === symbolName);

  if (!symbol) {
    throw new Error(
      `Symbol "${symbolName}" not found in ${symbolFile}. Available: ${parsed.symbols.map((s) => s.name).join(", ")}`,
    );
  }

  return symbol as unknown as Record<string, unknown>;
}

function loadFootprint(footprintFile: string): Record<string, unknown> {
  const content = readFileSync(join(LIB_ROOT, footprintFile), "utf-8");
  const parsed = parseKicadFootprint(content);
  return parsed as unknown as Record<string, unknown>;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

async function isComponentSeeded(
  db: BunSQLiteDatabase<typeof schema>,
  canonicalKey: string,
): Promise<boolean> {
  const existing = await db
    .select({ id: component.id })
    .from(component)
    .where(eq(component.canonicalKey, canonicalKey))
    .limit(1);

  return existing.length > 0;
}

export async function seedBuiltinComponents(
  repository: ComponentRepository,
  db: BunSQLiteDatabase<typeof schema>,
): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const def of BUILTIN_COMPONENTS) {
    try {
      const alreadySeeded = await isComponentSeeded(db, def.canonicalKey);

      if (alreadySeeded) {
        skipped += 1;
        continue;
      }

      const symbolData = loadSymbol(def.symbolFile, def.symbolName);

      const variants =
        def.variants?.map((v) => {
          const footprintPayload = loadFootprint(v.footprintFile);
          const footprintOption: FootprintOption = {
            id: generateUUID(),
            label: "IPC nominal",
            isDefault: true,
            kicadPayload: footprintPayload,
            densityLevel: "nominal",
          };

          return {
            canonicalCode: v.canonicalCode,
            humanLabel: v.humanLabel,
            mountType: v.mountType,
            isDefault: v.isDefault,
            footprintOptions: [footprintOption],
          };
        }) ?? [];

      if (variants.length === 0) {
        variants.push({
          canonicalCode: "default",
          humanLabel: "Default",
          mountType: "virtual" as const,
          isDefault: true,
          footprintOptions: [],
        });
      }

      await repository.createComponent({
        canonicalKey: def.canonicalKey,
        displayLabel: def.displayLabel,
        description: def.description,
        categoryPath: def.categoryPath,
        tags: def.tags,
        scope: "builtin",
        symbolData,
        variants,
      });

      seeded += 1;
    } catch (error) {
      console.error(
        `[seed] Failed to seed ${def.canonicalKey}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { seeded, skipped };
}
