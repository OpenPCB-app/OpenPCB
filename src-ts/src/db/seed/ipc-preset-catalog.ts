/**
 * IPC-7351B Preset Catalog Seed
 *
 * Populates the preset_catalog and preset_variant tables with
 * built-in component packages covering all major IPC families.
 */

import { v7 as uuidv7 } from "uuid";

interface CatalogSeed {
  name: string;
  variants: VariantSeed[];
}

interface VariantSeed {
  canonicalCode: string;
  humanLabel: string;
  imperialAlias?: string;
  metricAlias?: string;
  mountType: "smd" | "through_hole";
  lengthMm: number;
  widthMm: number;
  heightMm?: number;
  pinCount?: number;
}

// ---------------------------------------------------------------------------
// Seed Data
// ---------------------------------------------------------------------------

const CATALOGS: CatalogSeed[] = [
  {
    name: "Chip Resistors",
    variants: [
      {
        canonicalCode: "0201",
        humanLabel: "0201 / 0603M",
        imperialAlias: "0201",
        metricAlias: "0603",
        mountType: "smd",
        lengthMm: 0.6,
        widthMm: 0.3,
        heightMm: 0.26,
        pinCount: 2,
      },
      {
        canonicalCode: "0402",
        humanLabel: "0402 / 1005M",
        imperialAlias: "0402",
        metricAlias: "1005",
        mountType: "smd",
        lengthMm: 1.0,
        widthMm: 0.5,
        heightMm: 0.35,
        pinCount: 2,
      },
      {
        canonicalCode: "0603",
        humanLabel: "0603 / 1608M",
        imperialAlias: "0603",
        metricAlias: "1608",
        mountType: "smd",
        lengthMm: 1.6,
        widthMm: 0.8,
        heightMm: 0.55,
        pinCount: 2,
      },
      {
        canonicalCode: "0805",
        humanLabel: "0805 / 2012M",
        imperialAlias: "0805",
        metricAlias: "2012",
        mountType: "smd",
        lengthMm: 2.0,
        widthMm: 1.25,
        heightMm: 0.65,
        pinCount: 2,
      },
      {
        canonicalCode: "1206",
        humanLabel: "1206 / 3216M",
        imperialAlias: "1206",
        metricAlias: "3216",
        mountType: "smd",
        lengthMm: 3.2,
        widthMm: 1.6,
        heightMm: 0.65,
        pinCount: 2,
      },
      {
        canonicalCode: "1210",
        humanLabel: "1210 / 3225M",
        imperialAlias: "1210",
        metricAlias: "3225",
        mountType: "smd",
        lengthMm: 3.2,
        widthMm: 2.5,
        heightMm: 0.65,
        pinCount: 2,
      },
      {
        canonicalCode: "2010",
        humanLabel: "2010 / 5025M",
        imperialAlias: "2010",
        metricAlias: "5025",
        mountType: "smd",
        lengthMm: 5.0,
        widthMm: 2.5,
        heightMm: 0.65,
        pinCount: 2,
      },
      {
        canonicalCode: "2512",
        humanLabel: "2512 / 6332M",
        imperialAlias: "2512",
        metricAlias: "6332",
        mountType: "smd",
        lengthMm: 6.3,
        widthMm: 3.2,
        heightMm: 0.7,
        pinCount: 2,
      },
    ],
  },
  {
    name: "Chip Capacitors",
    variants: [
      {
        canonicalCode: "0402",
        humanLabel: "0402 MLCC",
        imperialAlias: "0402",
        metricAlias: "1005",
        mountType: "smd",
        lengthMm: 1.0,
        widthMm: 0.5,
        heightMm: 0.5,
        pinCount: 2,
      },
      {
        canonicalCode: "0603",
        humanLabel: "0603 MLCC",
        imperialAlias: "0603",
        metricAlias: "1608",
        mountType: "smd",
        lengthMm: 1.6,
        widthMm: 0.8,
        heightMm: 0.8,
        pinCount: 2,
      },
      {
        canonicalCode: "0805",
        humanLabel: "0805 MLCC",
        imperialAlias: "0805",
        metricAlias: "2012",
        mountType: "smd",
        lengthMm: 2.0,
        widthMm: 1.25,
        heightMm: 0.85,
        pinCount: 2,
      },
      {
        canonicalCode: "1206",
        humanLabel: "1206 MLCC",
        imperialAlias: "1206",
        metricAlias: "3216",
        mountType: "smd",
        lengthMm: 3.2,
        widthMm: 1.6,
        heightMm: 1.6,
        pinCount: 2,
      },
      {
        canonicalCode: "1210",
        humanLabel: "1210 MLCC",
        imperialAlias: "1210",
        metricAlias: "3225",
        mountType: "smd",
        lengthMm: 3.2,
        widthMm: 2.5,
        heightMm: 2.5,
        pinCount: 2,
      },
    ],
  },
  {
    name: "Tantalum Capacitors",
    variants: [
      {
        canonicalCode: "A",
        humanLabel: "Case A / 3216-18",
        mountType: "smd",
        lengthMm: 3.2,
        widthMm: 1.6,
        heightMm: 1.6,
        pinCount: 2,
      },
      {
        canonicalCode: "B",
        humanLabel: "Case B / 3528-21",
        mountType: "smd",
        lengthMm: 3.5,
        widthMm: 2.8,
        heightMm: 1.9,
        pinCount: 2,
      },
      {
        canonicalCode: "C",
        humanLabel: "Case C / 6032-28",
        mountType: "smd",
        lengthMm: 6.0,
        widthMm: 3.2,
        heightMm: 2.6,
        pinCount: 2,
      },
      {
        canonicalCode: "D",
        humanLabel: "Case D / 7343-31",
        mountType: "smd",
        lengthMm: 7.3,
        widthMm: 4.3,
        heightMm: 2.9,
        pinCount: 2,
      },
      {
        canonicalCode: "E",
        humanLabel: "Case E / 7343-43",
        mountType: "smd",
        lengthMm: 7.3,
        widthMm: 4.3,
        heightMm: 4.1,
        pinCount: 2,
      },
    ],
  },
  {
    name: "SOIC",
    variants: [
      {
        canonicalCode: "SOIC-8",
        humanLabel: "SOIC-8 (3.9mm body)",
        mountType: "smd",
        lengthMm: 5.0,
        widthMm: 4.0,
        heightMm: 1.75,
        pinCount: 8,
      },
      {
        canonicalCode: "SOIC-14",
        humanLabel: "SOIC-14 (3.9mm body)",
        mountType: "smd",
        lengthMm: 5.0,
        widthMm: 8.65,
        heightMm: 1.75,
        pinCount: 14,
      },
      {
        canonicalCode: "SOIC-16",
        humanLabel: "SOIC-16 (3.9mm body)",
        mountType: "smd",
        lengthMm: 5.0,
        widthMm: 9.9,
        heightMm: 1.75,
        pinCount: 16,
      },
      {
        canonicalCode: "SOIC-16W",
        humanLabel: "SOIC-16 Wide (7.5mm body)",
        mountType: "smd",
        lengthMm: 10.3,
        widthMm: 9.9,
        heightMm: 2.65,
        pinCount: 16,
      },
      {
        canonicalCode: "SOIC-20",
        humanLabel: "SOIC-20 Wide",
        mountType: "smd",
        lengthMm: 10.3,
        widthMm: 12.8,
        heightMm: 2.65,
        pinCount: 20,
      },
      {
        canonicalCode: "SOIC-28W",
        humanLabel: "SOIC-28 Wide",
        mountType: "smd",
        lengthMm: 10.3,
        widthMm: 17.9,
        heightMm: 2.65,
        pinCount: 28,
      },
    ],
  },
  {
    name: "SOT",
    variants: [
      {
        canonicalCode: "SOT-23",
        humanLabel: "SOT-23 (3-pin)",
        mountType: "smd",
        lengthMm: 1.3,
        widthMm: 2.9,
        heightMm: 1.1,
        pinCount: 3,
      },
      {
        canonicalCode: "SOT-23-5",
        humanLabel: "SOT-23-5 (5-pin)",
        mountType: "smd",
        lengthMm: 1.6,
        widthMm: 2.9,
        heightMm: 1.1,
        pinCount: 5,
      },
      {
        canonicalCode: "SOT-23-6",
        humanLabel: "SOT-23-6 (6-pin)",
        mountType: "smd",
        lengthMm: 1.6,
        widthMm: 2.9,
        heightMm: 1.1,
        pinCount: 6,
      },
      {
        canonicalCode: "SOT-223",
        humanLabel: "SOT-223 (4-pin)",
        mountType: "smd",
        lengthMm: 6.5,
        widthMm: 7.0,
        heightMm: 1.8,
        pinCount: 4,
      },
      {
        canonicalCode: "SOT-323",
        humanLabel: "SOT-323 (3-pin)",
        mountType: "smd",
        lengthMm: 1.25,
        widthMm: 2.0,
        heightMm: 0.95,
        pinCount: 3,
      },
      {
        canonicalCode: "SOT-363",
        humanLabel: "SOT-363 (6-pin)",
        mountType: "smd",
        lengthMm: 1.25,
        widthMm: 2.0,
        heightMm: 0.95,
        pinCount: 6,
      },
    ],
  },
  {
    name: "QFP",
    variants: [
      {
        canonicalCode: "LQFP-32",
        humanLabel: "LQFP-32 (7x7mm, 0.8mm pitch)",
        mountType: "smd",
        lengthMm: 9.0,
        widthMm: 9.0,
        heightMm: 1.6,
        pinCount: 32,
      },
      {
        canonicalCode: "LQFP-48",
        humanLabel: "LQFP-48 (7x7mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 9.0,
        widthMm: 9.0,
        heightMm: 1.6,
        pinCount: 48,
      },
      {
        canonicalCode: "LQFP-64",
        humanLabel: "LQFP-64 (10x10mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 12.0,
        widthMm: 12.0,
        heightMm: 1.6,
        pinCount: 64,
      },
      {
        canonicalCode: "LQFP-100",
        humanLabel: "LQFP-100 (14x14mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 16.0,
        widthMm: 16.0,
        heightMm: 1.6,
        pinCount: 100,
      },
      {
        canonicalCode: "LQFP-144",
        humanLabel: "LQFP-144 (20x20mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 22.0,
        widthMm: 22.0,
        heightMm: 1.6,
        pinCount: 144,
      },
    ],
  },
  {
    name: "QFN",
    variants: [
      {
        canonicalCode: "QFN-16-3x3",
        humanLabel: "QFN-16 (3x3mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 3.0,
        widthMm: 3.0,
        heightMm: 0.75,
        pinCount: 16,
      },
      {
        canonicalCode: "QFN-20-4x4",
        humanLabel: "QFN-20 (4x4mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 4.0,
        widthMm: 4.0,
        heightMm: 0.75,
        pinCount: 20,
      },
      {
        canonicalCode: "QFN-24-4x4",
        humanLabel: "QFN-24 (4x4mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 4.0,
        widthMm: 4.0,
        heightMm: 0.75,
        pinCount: 24,
      },
      {
        canonicalCode: "QFN-32-5x5",
        humanLabel: "QFN-32 (5x5mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 5.0,
        widthMm: 5.0,
        heightMm: 0.8,
        pinCount: 32,
      },
      {
        canonicalCode: "QFN-48-7x7",
        humanLabel: "QFN-48 (7x7mm, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 7.0,
        widthMm: 7.0,
        heightMm: 0.85,
        pinCount: 48,
      },
    ],
  },
  {
    name: "BGA",
    variants: [
      {
        canonicalCode: "BGA-49-0.8",
        humanLabel: "BGA-49 (7x7, 0.8mm pitch)",
        mountType: "smd",
        lengthMm: 6.0,
        widthMm: 6.0,
        heightMm: 1.2,
        pinCount: 49,
      },
      {
        canonicalCode: "BGA-100-0.8",
        humanLabel: "BGA-100 (10x10, 0.8mm pitch)",
        mountType: "smd",
        lengthMm: 8.0,
        widthMm: 8.0,
        heightMm: 1.4,
        pinCount: 100,
      },
      {
        canonicalCode: "BGA-256-0.5",
        humanLabel: "BGA-256 (16x16, 0.5mm pitch)",
        mountType: "smd",
        lengthMm: 10.0,
        widthMm: 10.0,
        heightMm: 1.2,
        pinCount: 256,
      },
    ],
  },
  {
    name: "DIP",
    variants: [
      {
        canonicalCode: "DIP-8",
        humanLabel: "DIP-8 (300mil)",
        mountType: "through_hole",
        lengthMm: 6.35,
        widthMm: 9.52,
        heightMm: 3.3,
        pinCount: 8,
      },
      {
        canonicalCode: "DIP-14",
        humanLabel: "DIP-14 (300mil)",
        mountType: "through_hole",
        lengthMm: 6.35,
        widthMm: 19.05,
        heightMm: 3.3,
        pinCount: 14,
      },
      {
        canonicalCode: "DIP-16",
        humanLabel: "DIP-16 (300mil)",
        mountType: "through_hole",
        lengthMm: 6.35,
        widthMm: 20.32,
        heightMm: 3.3,
        pinCount: 16,
      },
      {
        canonicalCode: "DIP-20",
        humanLabel: "DIP-20 (300mil)",
        mountType: "through_hole",
        lengthMm: 6.35,
        widthMm: 25.4,
        heightMm: 3.3,
        pinCount: 20,
      },
      {
        canonicalCode: "DIP-28",
        humanLabel: "DIP-28 (600mil)",
        mountType: "through_hole",
        lengthMm: 15.24,
        widthMm: 35.56,
        heightMm: 3.3,
        pinCount: 28,
      },
      {
        canonicalCode: "DIP-40",
        humanLabel: "DIP-40 (600mil)",
        mountType: "through_hole",
        lengthMm: 15.24,
        widthMm: 50.8,
        heightMm: 3.3,
        pinCount: 40,
      },
    ],
  },
  {
    name: "SOD",
    variants: [
      {
        canonicalCode: "SOD-123",
        humanLabel: "SOD-123",
        mountType: "smd",
        lengthMm: 2.7,
        widthMm: 1.6,
        heightMm: 1.2,
        pinCount: 2,
      },
      {
        canonicalCode: "SOD-323",
        humanLabel: "SOD-323",
        mountType: "smd",
        lengthMm: 1.7,
        widthMm: 1.25,
        heightMm: 0.95,
        pinCount: 2,
      },
      {
        canonicalCode: "SOD-523",
        humanLabel: "SOD-523",
        mountType: "smd",
        lengthMm: 1.2,
        widthMm: 0.8,
        heightMm: 0.6,
        pinCount: 2,
      },
      {
        canonicalCode: "SOD-80",
        humanLabel: "SOD-80 (MiniMELF)",
        mountType: "smd",
        lengthMm: 3.5,
        widthMm: 1.6,
        heightMm: 1.6,
        pinCount: 2,
      },
    ],
  },
  {
    name: "Power Packages",
    variants: [
      {
        canonicalCode: "DPAK",
        humanLabel: "DPAK / TO-252",
        mountType: "smd",
        lengthMm: 6.5,
        widthMm: 6.1,
        heightMm: 2.3,
        pinCount: 3,
      },
      {
        canonicalCode: "D2PAK",
        humanLabel: "D2PAK / TO-263",
        mountType: "smd",
        lengthMm: 10.0,
        widthMm: 8.9,
        heightMm: 4.4,
        pinCount: 3,
      },
      {
        canonicalCode: "TO-220",
        humanLabel: "TO-220 (through-hole)",
        mountType: "through_hole",
        lengthMm: 10.0,
        widthMm: 15.0,
        heightMm: 4.5,
        pinCount: 3,
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed Function
// ---------------------------------------------------------------------------

export interface PresetCatalogSeedRow {
  id: string;
  name: string;
  scope: "built_in";
  isImmutable: true;
}

export interface PresetVariantSeedRow {
  id: string;
  catalogId: string;
  canonicalCode: string;
  humanLabel: string;
  imperialAlias: string | null;
  metricAlias: string | null;
  mountType: "smd" | "through_hole";
  typicalDimensions: {
    lengthMm: number;
    widthMm: number;
    heightMm: number | null;
  };
  pinCount: number | null;
}

/**
 * Generate seed rows for preset catalogs and variants.
 * Returns insertable rows (caller handles DB writes).
 */
export function generatePresetCatalogSeed(): {
  catalogs: PresetCatalogSeedRow[];
  variants: PresetVariantSeedRow[];
} {
  const catalogs: PresetCatalogSeedRow[] = [];
  const variants: PresetVariantSeedRow[] = [];

  for (const catalog of CATALOGS) {
    const catalogId = uuidv7();
    catalogs.push({
      id: catalogId,
      name: catalog.name,
      scope: "built_in",
      isImmutable: true,
    });

    for (const variant of catalog.variants) {
      variants.push({
        id: uuidv7(),
        catalogId,
        canonicalCode: variant.canonicalCode,
        humanLabel: variant.humanLabel,
        imperialAlias: variant.imperialAlias ?? null,
        metricAlias: variant.metricAlias ?? null,
        mountType: variant.mountType,
        typicalDimensions: {
          lengthMm: variant.lengthMm,
          widthMm: variant.widthMm,
          heightMm: variant.heightMm ?? null,
        },
        pinCount: variant.pinCount ?? null,
      });
    }
  }

  return { catalogs, variants };
}
