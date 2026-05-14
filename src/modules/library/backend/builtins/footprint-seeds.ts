/// <reference path="./kicad-assets/kicad-mod.d.ts" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFootprintPreviewFromParsed } from "../import/build-preview-models";
import {
  type ParsedKicadFootprint,
  parseKicadFootprint,
} from "../infrastructure/parsers/kicad/kicad-footprint-parser";

export type BuiltinFootprintMountType = "smd" | "through_hole";

export interface BuiltinFootprintSeed {
  readonly footprintId: string;
  readonly displayName: string;
  readonly fileName: string;
  readonly sourceHash: string;
  readonly mountType: BuiltinFootprintMountType;
  readonly source: string;
  build(now: string): { dataJson: string; padCount: number };
}

interface SeedInput {
  footprintId: string;
  displayName: string;
  fileName: string;
  mountType: BuiltinFootprintMountType;
  source: string;
}

const SOURCE_HASH_VERSION = "v1";
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const PARSE_CACHE = new Map<string, ParsedKicadFootprint>();
const PREVIEW_CACHE = new Map<
  string,
  ReturnType<typeof buildFootprintPreviewFromParsed>
>();
const SHA1_CACHE = new Map<string, string>();

function assetsRoot(): string {
  const workspaceRoot = process.env.OPENPCB_WORKSPACE_ROOT;
  if (workspaceRoot) {
    return path.join(
      workspaceRoot,
      "modules",
      "library",
      "backend",
      "builtins",
      "kicad-assets",
    );
  }
  return path.join(MODULE_DIR, "kicad-assets");
}

function readAsset(...segments: string[]): string {
  return readFileSync(path.join(assetsRoot(), ...segments), "utf8");
}

function sha1Hex(text: string): string {
  const cached = SHA1_CACHE.get(text);
  if (cached) return cached;
  const hash = createHash("sha1").update(text).digest("hex");
  SHA1_CACHE.set(text, hash);
  return hash;
}

function parseCached(source: string): ParsedKicadFootprint {
  const key = sha1Hex(source);
  const cached = PARSE_CACHE.get(key);
  if (cached) return cached;
  const parsed = parseKicadFootprint(source);
  PARSE_CACHE.set(key, parsed);
  return parsed;
}

function previewCached(parsed: ParsedKicadFootprint, key: string) {
  const cached = PREVIEW_CACHE.get(key);
  if (cached) return cached;
  const preview = buildFootprintPreviewFromParsed(parsed);
  PREVIEW_CACHE.set(key, preview);
  return preview;
}

interface PackageCode {
  imperial: string | null;
  metric: string | null;
}

function derivePackageCode(name: string): PackageCode {
  // Chip e.g. "R_0603_1608Metric" / "C_1210_3225Metric"
  const chip = /^[RC]_(\d{3,4})_(\d{4,5})Metric$/.exec(name);
  if (chip && chip[1] && chip[2]) {
    return { imperial: chip[1], metric: chip[2] };
  }
  // DIN axial e.g. "R_Axial_DIN0207_..."
  const din = /DIN(\d{4})/.exec(name);
  if (din && din[1]) {
    return { imperial: null, metric: `DIN${din[1]}` };
  }
  // Disc e.g. "C_Disc_D5.0mm_W2.5mm_P5.00mm"
  const disc = /^C_Disc_(D[\d.]+mm)_/.exec(name);
  if (disc && disc[1]) {
    return { imperial: null, metric: `Disc-${disc[1]}` };
  }
  return { imperial: null, metric: null };
}

function buildFootprintDataJson(args: {
  parsed: ParsedKicadFootprint;
  preview: ReturnType<typeof buildFootprintPreviewFromParsed>;
  footprintId: string;
  fileName: string;
  displayName: string;
  mountType: BuiltinFootprintMountType;
  sourceHash: string;
  packageCode: PackageCode;
  now: string;
}): string {
  const tags = ["builtin", "passive", args.mountType];
  if (args.packageCode.imperial) tags.push(args.packageCode.imperial);
  if (args.packageCode.metric) tags.push(args.packageCode.metric);
  const description = args.parsed.description?.trim() ?? "";
  return JSON.stringify({
    provenance: {
      sourceKind: "system",
      sourceFormat: "kicad-mod",
      fileName: args.fileName,
      importedAt: args.now,
      sourceHash: args.sourceHash,
    },
    parser: {
      warnings: args.parsed.warnings ?? [],
    },
    normalized: {
      id: args.footprintId,
      fileName: args.fileName,
      name: args.displayName,
      description,
      mountType: args.mountType,
      padCount: args.parsed.pads.length,
      packageCode: args.packageCode,
      tags,
      sourceHash: args.sourceHash,
      warnings: args.preview.warnings ?? [],
      preview: args.preview,
    },
    raw: {
      kind: "kicad-footprint",
      name: args.parsed.name,
    },
  });
}

function makeSeed(input: SeedInput): BuiltinFootprintSeed {
  const sourceHash = `kicad:${input.fileName}:${sha1Hex(input.source)}:${SOURCE_HASH_VERSION}`;
  const packageCode = derivePackageCode(
    input.fileName.replace(/\.kicad_mod$/, ""),
  );
  return {
    footprintId: input.footprintId,
    displayName: input.displayName,
    fileName: input.fileName,
    sourceHash,
    mountType: input.mountType,
    source: input.source,
    build(now: string) {
      const parsed = parseCached(input.source);
      const preview = previewCached(parsed, sourceHash);
      const dataJson = buildFootprintDataJson({
        parsed,
        preview,
        footprintId: input.footprintId,
        fileName: input.fileName,
        displayName: input.displayName,
        mountType: input.mountType,
        sourceHash,
        packageCode,
        now,
      });
      return { dataJson, padCount: parsed.pads.length };
    },
  };
}

let SEEDS: readonly BuiltinFootprintSeed[] | null = null;

export function listAllBuiltinFootprintSeeds(): readonly BuiltinFootprintSeed[] {
  if (SEEDS) return SEEDS;
  SEEDS = Object.freeze([
    // Resistor SMD
    makeSeed({
      footprintId: "builtin:fp:r-0402-1005m",
      displayName: "R_0402_1005Metric",
      fileName: "R_0402_1005Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_0402_1005Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-0603-1608m",
      displayName: "R_0603_1608Metric",
      fileName: "R_0603_1608Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_0603_1608Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-0805-2012m",
      displayName: "R_0805_2012Metric",
      fileName: "R_0805_2012Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_0805_2012Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-1206-3216m",
      displayName: "R_1206_3216Metric",
      fileName: "R_1206_3216Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_1206_3216Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-1210-3225m",
      displayName: "R_1210_3225Metric",
      fileName: "R_1210_3225Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_1210_3225Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-2512-6332m",
      displayName: "R_2512_6332Metric",
      fileName: "R_2512_6332Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Resistor_SMD", "R_2512_6332Metric.kicad_mod"),
    }),
    // Resistor THT axial
    makeSeed({
      footprintId: "builtin:fp:r-axial-din0207-p7.62",
      displayName: "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal",
      fileName: "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Resistor_THT",
        "R_Axial_DIN0207_L6.3mm_D2.5mm_P7.62mm_Horizontal.kicad_mod",
      ),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-axial-din0207-p10.16",
      displayName: "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal",
      fileName: "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Resistor_THT",
        "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.kicad_mod",
      ),
    }),
    makeSeed({
      footprintId: "builtin:fp:r-axial-din0309-p12.70",
      displayName: "R_Axial_DIN0309_L9.0mm_D3.2mm_P12.70mm_Horizontal",
      fileName: "R_Axial_DIN0309_L9.0mm_D3.2mm_P12.70mm_Horizontal.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Resistor_THT",
        "R_Axial_DIN0309_L9.0mm_D3.2mm_P12.70mm_Horizontal.kicad_mod",
      ),
    }),
    // Capacitor SMD
    makeSeed({
      footprintId: "builtin:fp:c-0402-1005m",
      displayName: "C_0402_1005Metric",
      fileName: "C_0402_1005Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Capacitor_SMD", "C_0402_1005Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-0603-1608m",
      displayName: "C_0603_1608Metric",
      fileName: "C_0603_1608Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Capacitor_SMD", "C_0603_1608Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-0805-2012m",
      displayName: "C_0805_2012Metric",
      fileName: "C_0805_2012Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Capacitor_SMD", "C_0805_2012Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-1206-3216m",
      displayName: "C_1206_3216Metric",
      fileName: "C_1206_3216Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Capacitor_SMD", "C_1206_3216Metric.kicad_mod"),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-1210-3225m",
      displayName: "C_1210_3225Metric",
      fileName: "C_1210_3225Metric.kicad_mod",
      mountType: "smd",
      source: readAsset("Capacitor_SMD", "C_1210_3225Metric.kicad_mod"),
    }),
    // Capacitor THT disc
    makeSeed({
      footprintId: "builtin:fp:c-disc-d3-p2.5",
      displayName: "C_Disc_D3.0mm_W2.0mm_P2.50mm",
      fileName: "C_Disc_D3.0mm_W2.0mm_P2.50mm.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Capacitor_THT",
        "C_Disc_D3.0mm_W2.0mm_P2.50mm.kicad_mod",
      ),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-disc-d5-p5",
      displayName: "C_Disc_D5.0mm_W2.5mm_P5.00mm",
      fileName: "C_Disc_D5.0mm_W2.5mm_P5.00mm.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Capacitor_THT",
        "C_Disc_D5.0mm_W2.5mm_P5.00mm.kicad_mod",
      ),
    }),
    makeSeed({
      footprintId: "builtin:fp:c-disc-d7.5-p5",
      displayName: "C_Disc_D7.5mm_W5.0mm_P5.00mm",
      fileName: "C_Disc_D7.5mm_W5.0mm_P5.00mm.kicad_mod",
      mountType: "through_hole",
      source: readAsset(
        "Capacitor_THT",
        "C_Disc_D7.5mm_W5.0mm_P5.00mm.kicad_mod",
      ),
    }),
  ]);
  return SEEDS;
}

export const BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID = "builtin:fp:r-0603-1608m";
export const BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID = "builtin:fp:c-0603-1608m";
