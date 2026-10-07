import { createHash } from "node:crypto";
import { packOpclib, type PackedAsset, type OpclibAssetEntry, type OpclibFootprintEntry, type PackedComponent } from "@openpcb/opclib-pack";
import type { SymbolRenderModel, FootprintRenderModel } from "@openpcb/rendering-core";

export const CORE_LIBRARY_FIXTURE_COUNT = 17;
const MODEL_ID = "openpcb.core.3d.fixture";

interface FixturePart {
  slug: string;
  name: string;
  family: string;
  footprints: string[];
  package: string;
}
const PARTS: FixturePart[] = [
  { slug: "passive.resistor", name: "Resistor", family: "passive", package: "0603", footprints: ["passive.r-0603", ...["01005", "0201", "0402", "0805", "1206", "1210", "2010", "2512"].map((size) => `passive.r-${size}`)] },
  { slug: "passive.capacitor", name: "Capacitor", family: "passive", package: "0603", footprints: ["passive.c-0603", ...["01005", "0201", "0402", "0805", "1206", "1210", "2010"].map((size) => `passive.c-${size}`)] },
  ...["signal", "schottky", "zener"].map((kind) => ({ slug: `diode.${kind}`, name: `${kind} diode`, family: "diode", package: "sod-123", footprints: [`diode.${kind}`] })),
  ...["npn", "pnp"].map((kind) => ({ slug: `transistor.${kind}`, name: `${kind} transistor`, family: "transistor", package: "sot-23", footprints: [`transistor.${kind}`] })),
  ...["logic", "timer", "amplifier"].map((kind) => ({ slug: `ic.${kind}`, name: `${kind} IC`, family: "ic", package: "soic-8", footprints: [`ic.${kind}`] })),
  ...["pin-header-1x02", "pin-header-2x03", "pin-socket-1x02", "pin-socket-2x03"].map((kind) => ({ slug: `connector.${kind}`, name: kind, family: "connector", package: "2.54mm", footprints: [`connector.${kind}-p2-54mm-vertical`] })),
  ...["0603-1608metric", "0805-2012metric", "1206-3216metric"].map((kind) => ({ slug: `opto.led-${kind}`, name: `LED ${kind}`, family: "diode", package: kind.split("-")[0]!, footprints: [`opto.led-${kind}`] })),
];

function bytes(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function uuid(id: string): string {
  const digest = createHash("sha256").update(id).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function entry(id: string, name: string, assetPath: string, payload: Uint8Array): OpclibAssetEntry {
  return { id, uuid: uuid(id), version: "1.0.0", name, path: assetPath, sha256: sha256(payload) };
}

function symbol(part: FixturePart): PackedAsset<OpclibAssetEntry> {
  const id = `openpcb.core.symbol.${part.slug}`;
  const preview: SymbolRenderModel = { kind: "symbol", units: "mm", name: part.name, unitCount: 1,
    graphics: [{ kind: "rect", x: -1, y: -1, width: 2, height: 2, strokeWidthMm: 0.1, fill: "none" }],
    pins: [], labels: [], bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, warnings: [] };
  const payload = bytes({ id, normalized: { referencePrefix: "X", pins: [], preview } });
  return { entry: entry(id, part.name, `symbols/${part.slug}.symbol.json`, payload), bytes: payload };
}

function footprint(part: FixturePart, slug: string): PackedAsset<OpclibFootprintEntry> {
  const id = `openpcb.core.footprint.${slug}`;
  const mountType = part.family === "connector" ? "tht" : "smd";
  const preview: FootprintRenderModel = { kind: "footprint", units: "mm", name: slug, pads: [],
    graphics: [{ kind: "rect", x: -1, y: -1, width: 2, height: 2, strokeWidthMm: 0.1, fill: "none" }],
    labels: [], bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 }, warnings: [] };
  const payload = bytes({ id, normalized: { mountType, packageCode: part.package, pads: [], preview } });
  return { entry: { ...entry(id, slug, `footprints/${slug}.fp.json`, payload),
    package: { code: part.package, mountType }, models3d: [MODEL_ID] }, bytes: payload };
}

function component(part: FixturePart): PackedComponent {
  const id = `openpcb.core.${part.slug}`;
  return { entry: { id, uuid: uuid(id), version: "1.0.0", name: part.name, category: part.family,
    symbol: `openpcb.core.symbol.${part.slug}`, defaultFootprint: `openpcb.core.footprint.${part.footprints[0]}`,
    footprints: part.footprints.map((slug) => ({ footprint: `openpcb.core.footprint.${slug}`, label: slug })),
    tags: [part.family, part.package, "builtin", "system", "core"],
    provenance: { source: "openpcb-original", license: "CC0-1.0", notes: "Synthetic test data, not a production component." } },
    path: `components/${part.slug}.json`, bytes: bytes({ id }) };
}

function emptySceneGlb(): Uint8Array {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }], nodes: [] }));
  const chunkLength = Math.ceil(json.byteLength / 4) * 4;
  const output = Buffer.alloc(20 + chunkLength, 0x20);
  output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(chunkLength, 12); output.writeUInt32LE(0x4e4f534a, 16); json.copy(output, 20);
  return output;
}

/** Fixed synthetic catalog exercises import contracts without a sibling checkout or release download. */
export function buildCoreLibraryFixture(): Uint8Array {
  const glb = emptySceneGlb();
  if (PARTS.length !== CORE_LIBRARY_FIXTURE_COUNT) throw new Error("CoreLibrary fixture count changed");
  return packOpclib({ library: { id: "openpcb.core", name: "Synthetic CoreLibrary Test Catalog", kind: "core",
    channel: "stable", version: "1.0.0", license: "CC0-1.0", generatedAt: "2026-01-01T00:00:00.000Z" },
    symbols: PARTS.map(symbol), footprints: PARTS.flatMap((part) => part.footprints.map((slug) => footprint(part, slug))),
    components: PARTS.map(component), models3d: [{ entry: { id: MODEL_ID, uuid: uuid(MODEL_ID), version: "1.0.0",
      name: "Synthetic empty scene", transformBaked: true, rotationDeg: { x: 90, y: 0, z: 0 },
      formats: { glb: { path: "3d/fixture.glb", sha256: sha256(glb) } } },
      assets: [{ format: "glb", path: "3d/fixture.glb", bytes: glb }] }] }).bytes;
}
