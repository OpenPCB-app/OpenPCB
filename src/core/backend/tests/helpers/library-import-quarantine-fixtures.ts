import { packOpclib } from "@openpcb/opclib-pack";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import type { SymbolRenderSource } from "../../../../shared/rendering/types";
import { getKicadFixturePath } from "./kicad-fixtures";

export const symbolLibrary = {
  fileName: "simple_capacitor.kicad_sym",
  content: readFileSync(
    getKicadFixturePath("simple_capacitor.kicad_sym"),
    "utf8",
  ),
};
export const footprintFiles = [
  {
    fileName: "C_0603_1608Metric.kicad_mod",
    content: readFileSync(
      getKicadFixturePath("C_0603_1608Metric.kicad_mod"),
      "utf8",
    ),
  },
];
export const drawnSymbol: {
  source: SymbolRenderSource;
  referencePrefix: string;
} = {
  referencePrefix: "C",
  source: {
    name: "Drawn fixture",
    unitCount: 1,
    referenceText: "C",
    valueText: "C",
    pins: ["1", "2"].map((number, index) => ({
      id: number,
      name: number,
      number,
      electricalType: "passive",
      positionMm: { x: index, y: 0 },
      lengthMm: 1,
      rotationDeg: 0,
      unit: 1,
      hidden: false,
    })),
    graphics: [],
    warnings: [],
  },
};

const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const step = new TextEncoder().encode("ISO-10303-21; END-ISO-10303-21;");
const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46]);

export function kicadZip(): Uint8Array {
  const encoder = new TextEncoder();
  return zipSync({
    [symbolLibrary.fileName]: encoder.encode(symbolLibrary.content),
    [footprintFiles[0]!.fileName]: encoder.encode(footprintFiles[0]!.content),
    "package.step": step,
  });
}

function footprintAssets(provenance: unknown, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const id = `fixture.footprint.${index}`;
    const bytes = encode({ id, provenance });
    return {
      entry: {
        id,
        uuid: crypto.randomUUID(),
        version: "1.0.0",
        name: id,
        path: `footprints/${index}.fp.json`,
        sha256: hash(bytes),
        models3d: ["fixture.model"],
      },
      bytes,
    };
  });
}

function modelAsset() {
  return {
    entry: {
      id: "fixture.model",
      uuid: crypto.randomUUID(),
      version: "1.0.0",
      name: "Fixture",
      formats: {
        step: { path: "3d/fixture.step", sha256: hash(step) },
        glb: { path: "3d/fixture.glb", sha256: hash(glb) },
      },
    },
    assets: [
      { format: "step" as const, path: "3d/fixture.step", bytes: step },
      { format: "glb" as const, path: "3d/fixture.glb", bytes: glb },
    ],
  };
}

export function externalPack(
  provenance: unknown,
  count = 1,
  sourceId = "test.quarantine",
): Uint8Array {
  const symbol = encode({ id: "fixture.symbol" });
  return packOpclib({
    library: {
      id: sourceId,
      name: "Quarantine fixture",
      kind: "user",
      channel: "stable",
      version: "0.1.0",
      license: "MIT",
      generatedAt: "2026-10-05T00:00:00Z",
    },
    symbols: [
      {
        entry: {
          id: "fixture.symbol",
          uuid: crypto.randomUUID(),
          version: "1.0.0",
          name: "Fixture",
          path: "symbols/fixture.symbol.json",
          sha256: hash(symbol),
        },
        bytes: symbol,
      },
    ],
    footprints: footprintAssets(provenance, count),
    models3d: count === 0 ? [] : [modelAsset()],
    components: [],
  }).bytes;
}
