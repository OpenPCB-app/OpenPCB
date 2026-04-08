import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

import type * as schema from "../db/schema";
import { component } from "../db/schema";
import type { ComponentRepository } from "../db/repositories/component-repository";
import { parseKicadFootprint } from "../infrastructure/parsers/kicad/kicad-footprint-parser";
import type { FootprintOption } from "../db/schema/component-variant";

const LIB_ROOT = join(process.cwd(), "../lib/components/built-in");

interface BuiltinComponentDef {
  canonicalKey: string;
  displayLabel: string;
  description: string;
  categoryPath: string;
  tags: string[];
  symbolData: Record<string, unknown>;
  variants?: BuiltinVariantDef[];
}

interface BuiltinVariantDef {
  canonicalCode: string;
  humanLabel: string;
  mountType: "smd" | "through_hole" | "virtual";
  isDefault: boolean;
  footprintFile: string;
}

// ---------------------------------------------------------------------------
// Hand-crafted symbol data (primitives-only, no KiCad files)
// ---------------------------------------------------------------------------

// Pin span: 2.54mm (100mil) standard
const PIN_SPAN = 2_540_000;
const HALF_SPAN = PIN_SPAN / 2;

/**
 * GND: pin at top (y=0), stem going down, three horizontal bars of decreasing width.
 * Coordinates in Y-UP convention (KiCad-like) — cloneImportedGraphic will negate Y
 * so bars end up pointing downward on screen.
 */
const GND_SYMBOL: Record<string, unknown> = {
  referencePrefix: "GND",
  pinDefinitions: [{ name: "GND", electricalType: "power_in" }],
  pins: [
    {
      name: "GND",
      number: "1",
      position: { x: 0, y: 0 },
      side: "top",
      length: 0,
      electricalType: "power_in",
    },
  ],
  properties: { value: "GND" },
  unitCount: 1,
  bodyGraphics: [
    // Stem: pin (0,0) down to bars (Y-UP: negative Y = down)
    { type: "line", x1: 0, y1: 0, x2: 0, y2: -200_000, strokeWidth: 0.254 },
    // Bars: widest at top, narrowest at bottom (in Y-UP: decreasing Y)
    {
      type: "line",
      x1: -300_000,
      y1: -200_000,
      x2: 300_000,
      y2: -200_000,
      strokeWidth: 0.254,
    },
    {
      type: "line",
      x1: -180_000,
      y1: -320_000,
      x2: 180_000,
      y2: -320_000,
      strokeWidth: 0.254,
    },
    {
      type: "line",
      x1: -60_000,
      y1: -440_000,
      x2: 60_000,
      y2: -440_000,
      strokeWidth: 0.254,
    },
  ],
};

/**
 * VCC: pin at bottom (y=0), stem going up, V-arrow pointing up.
 * Coordinates in Y-UP convention — positive Y = up.
 */
const VCC_SYMBOL: Record<string, unknown> = {
  referencePrefix: "VCC",
  pinDefinitions: [{ name: "VCC", electricalType: "power_in" }],
  pins: [
    {
      name: "VCC",
      number: "1",
      position: { x: 0, y: 0 },
      side: "bottom",
      length: 0,
      electricalType: "power_in",
    },
  ],
  properties: { value: "VCC" },
  unitCount: 1,
  bodyGraphics: [
    // Stem: pin (0,0) up to arrow base (Y-UP: positive Y = up) - longer leg for better visibility
    { type: "line", x1: 0, y1: 0, x2: 0, y2: 400_000, strokeWidth: 0.254 },
    // V-arrow: two lines converging at top
    {
      type: "line",
      x1: -200_000,
      y1: 240_000,
      x2: 0,
      y2: 440_000,
      strokeWidth: 0.254,
    },
    {
      type: "line",
      x1: 200_000,
      y1: 240_000,
      x2: 0,
      y2: 440_000,
      strokeWidth: 0.254,
    },
  ],
};

/**
 * Resistor (ANSI): compact 3-peak zigzag.
 * Body fills ~90% of pin span. Pin renderer draws the short lead stubs via pin.length.
 * No explicit lead lines in bodyGraphics — only the zigzag polygon.
 */
const BODY_LEFT = -1_143_000; // 90% of HALF_SPAN
const BODY_RIGHT = 1_143_000;
const ZZ_HALF = (BODY_RIGHT - BODY_LEFT) / 6; // ~381_000
const ZZ_AMP = 230_000;

const RESISTOR_SYMBOL: Record<string, unknown> = {
  referencePrefix: "R",
  pinDefinitions: [
    { name: "1", electricalType: "passive" },
    { name: "2", electricalType: "passive" },
  ],
  pins: [
    {
      name: "1",
      number: "1",
      position: { x: -HALF_SPAN, y: 0 },
      side: "left",
      length: HALF_SPAN - -BODY_LEFT,
      electricalType: "passive",
    },
    {
      name: "2",
      number: "2",
      position: { x: HALF_SPAN, y: 0 },
      side: "right",
      length: HALF_SPAN - BODY_RIGHT,
      electricalType: "passive",
    },
  ],
  properties: { value: "R" },
  unitCount: 1,
  bodyGraphics: [
    // Zigzag only — pin renderer handles lead stubs
    {
      type: "polygon",
      points: [
        { x: BODY_LEFT, y: 0 },
        { x: BODY_LEFT + ZZ_HALF * 0.5, y: ZZ_AMP },
        { x: BODY_LEFT + ZZ_HALF * 1.5, y: -ZZ_AMP },
        { x: BODY_LEFT + ZZ_HALF * 2.5, y: ZZ_AMP },
        { x: BODY_LEFT + ZZ_HALF * 3.5, y: -ZZ_AMP },
        { x: BODY_LEFT + ZZ_HALF * 4.5, y: ZZ_AMP },
        { x: BODY_LEFT + ZZ_HALF * 5.5, y: -ZZ_AMP },
        { x: BODY_RIGHT, y: 0 },
      ],
      filled: false,
      closed: false,
      strokeWidth: 0.254,
    },
  ],
};

const BUILTIN_COMPONENTS: BuiltinComponentDef[] = [
  {
    canonicalKey: "builtin:gnd",
    displayLabel: "GND",
    description: "Ground reference symbol",
    categoryPath: "Power/Ground",
    tags: ["power", "ground"],
    symbolData: GND_SYMBOL,
  },
  {
    canonicalKey: "builtin:vcc",
    displayLabel: "VCC",
    description: "Positive supply voltage symbol",
    categoryPath: "Power/Supply",
    tags: ["power", "supply"],
    symbolData: VCC_SYMBOL,
  },
  {
    canonicalKey: "builtin:resistor",
    displayLabel: "Resistor",
    description: "Generic resistor — set value after placement",
    categoryPath: "Passives/Resistors",
    tags: ["passive", "resistor"],
    symbolData: RESISTOR_SYMBOL,
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

function loadFootprint(footprintFile: string): Record<string, unknown> {
  const content = readFileSync(join(LIB_ROOT, footprintFile), "utf-8");
  const parsed = parseKicadFootprint(content);
  return parsed as unknown as Record<string, unknown>;
}

function generateUUID(): string {
  return crypto.randomUUID();
}

async function getExistingComponentId(
  db: BunSQLiteDatabase<typeof schema>,
  canonicalKey: string,
): Promise<string | null> {
  const existing = await db
    .select({ id: component.id })
    .from(component)
    .where(eq(component.canonicalKey, canonicalKey))
    .limit(1);

  return existing[0]?.id ?? null;
}

export async function seedBuiltinComponents(
  repository: ComponentRepository,
  db: BunSQLiteDatabase<typeof schema>,
): Promise<{ seeded: number; skipped: number }> {
  let seeded = 0;
  let skipped = 0;

  for (const def of BUILTIN_COMPONENTS) {
    try {
      const existingId = await getExistingComponentId(db, def.canonicalKey);
      const symbolData = def.symbolData;

      if (existingId) {
        await repository.updateComponent(existingId, { symbolData });
        skipped += 1;
        continue;
      }

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
