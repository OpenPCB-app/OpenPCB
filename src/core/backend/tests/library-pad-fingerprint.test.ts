import { describe, expect, test } from "bun:test";
import renderingPackage from "../../../../node_modules/@openpcb/rendering-core/package.json";
import { buildFootprintRenderModel } from "../../../shared/rendering/footprint-preview-builder";
import {
  ALL_FAMILIES,
  generateFootprint,
} from "../../../shared/rendering/ipc7351b";
import { padGeometryFingerprint } from "../../../modules/library/backend/qualification/pad-fingerprint";
import {
  LEGACY_IPC_FINGERPRINT_PRESETS,
  LEGACY_IPC_FINGERPRINTS,
  LEGACY_IPC_GENERATOR,
} from "../../../modules/library/shared/legacy-ipc-fingerprints.generated";

const PADS = [
  {
    id: "pad-1",
    number: "1",
    shape: "roundrect",
    centerMm: { x: -0.825, y: 0 },
    widthMm: 0.8,
    heightMm: 0.95,
    rotationDeg: 0,
    roundrectRatio: 0.25,
    layer: "F.Cu",
  },
  {
    id: "pad-2",
    number: "2",
    shape: "roundrect",
    centerMm: { x: 0.825, y: 0 },
    widthMm: 0.8,
    heightMm: 0.95,
    rotationDeg: 0,
    roundrectRatio: 0.25,
    layer: "F.Cu",
  },
  {
    id: "mh",
    number: "",
    shape: "circle",
    centerMm: { x: 0, y: 3 },
    widthMm: 3.6,
    heightMm: 3.6,
    rotationDeg: 0,
    drillDiameterMm: 3.2,
    layer: "Edge.Cuts",
  },
];

const BASE = padGeometryFingerprint(PADS);

function edited(index: number, patch: Record<string, unknown>): unknown[] {
  return PADS.map((pad, i) => (i === index ? { ...pad, ...patch } : pad));
}

describe("padGeometryFingerprint invariance", () => {
  test("is a sha256 hex digest", () => {
    expect(BASE).toMatch(/^[a-f0-9]{64}$/);
  });

  test("pad order does not matter", () => {
    expect(padGeometryFingerprint([...PADS].reverse())).toBe(BASE);
    expect(padGeometryFingerprint([PADS[2], PADS[0], PADS[1]])).toBe(BASE);
  });

  test("key order and a JSON round trip do not matter", () => {
    const reordered = PADS.map((pad) =>
      Object.fromEntries(Object.entries(pad).reverse()),
    );
    expect(padGeometryFingerprint(reordered)).toBe(BASE);
    expect(padGeometryFingerprint(JSON.parse(JSON.stringify(PADS)))).toBe(BASE);
  });

  test("float noise below 1e-6 mm and -0 do not matter", () => {
    const noisy = PADS.map((pad) => ({
      ...pad,
      centerMm: { x: pad.centerMm.x + 1e-10, y: pad.centerMm.y - 1e-10 },
      widthMm: pad.widthMm * (1 + 1e-12),
    }));
    expect(padGeometryFingerprint(noisy)).toBe(BASE);
    expect(padGeometryFingerprint(edited(0, { centerMm: { x: -0.825, y: -0 } }))).toBe(
      BASE,
    );
  });

  test("pad ids never reach the fab and are ignored", () => {
    expect(padGeometryFingerprint(edited(0, { id: "renamed" }))).toBe(BASE);
  });
});

describe("padGeometryFingerprint sensitivity", () => {
  test("any geometric edit of 1e-6 mm or more changes it", () => {
    expect(padGeometryFingerprint(edited(0, { centerMm: { x: -0.825002, y: 0 } }))).not.toBe(
      BASE,
    );
    expect(padGeometryFingerprint(edited(1, { heightMm: 0.951 }))).not.toBe(BASE);
  });

  test("every projected field participates", () => {
    const patches: Record<string, unknown>[] = [
      { number: "3" },
      { shape: "rect" },
      { widthMm: 0.81 },
      { rotationDeg: 90 },
      { roundrectRatio: 0.2 },
      { drillDiameterMm: 0.3 },
      { layer: "B.Cu" },
    ];
    for (const patch of patches) {
      expect(padGeometryFingerprint(edited(0, patch))).not.toBe(BASE);
    }
  });

  test("structural fields the pinned pad type lacks are read", () => {
    for (const patch of [
      { plated: false },
      { drillSlotMm: { widthMm: 3.2, heightMm: 4 } },
      { drillOffsetMm: { x: 0.1, y: 0 } },
      { layers: ["*.Cu", "*.Mask"] },
    ]) {
      expect(padGeometryFingerprint(edited(2, patch))).not.toBe(BASE);
    }
    // Absent `plated` means plated on a drilled pad.
    expect(padGeometryFingerprint(edited(2, { plated: true }))).toBe(BASE);
    // `plated` is meaningless without a drill.
    expect(padGeometryFingerprint(edited(0, { plated: false }))).toBe(BASE);
    // `layers` is a set.
    expect(padGeometryFingerprint(edited(2, { layers: ["*.Mask", "*.Cu"] }))).toBe(
      padGeometryFingerprint(edited(2, { layers: ["*.Cu", "*.Mask"] })),
    );
  });

  test("malformed entries are projected, never thrown on", () => {
    expect(() =>
      padGeometryFingerprint([null, 7, "pad", {}, { centerMm: "x", widthMm: "1" }]),
    ).not.toThrow();
    expect(padGeometryFingerprint([{}])).not.toBe(padGeometryFingerprint([]));
  });

  test("the projection is pinned: a change invalidates every fingerprint table", () => {
    // Regenerate scripts/gen-ipc-fingerprints.ts outputs before updating this.
    expect(BASE).toBe(
      "165a720fe2e56d02377be94c50de2eb7222c4d923d4b4d3a91c789362d795d40",
    );
  });
});

test.if(renderingPackage.version === LEGACY_IPC_GENERATOR.version)(
  "the legacy deny-list reproduces from the installed legacy generator",
  () => {
    let combinations = 0;
    for (const family of ALL_FAMILIES) {
      for (const size of family.sizes) {
        for (const density of ["most", "nominal", "least"] as const) {
          combinations += 1;
          const { source } = generateFootprint(family.id, size.label, density);
          const key = `${family.id}|${size.label}|${density}`;
          for (const pads of [source.pads, buildFootprintRenderModel(source).pads]) {
            const fingerprint = padGeometryFingerprint(pads);
            expect(LEGACY_IPC_FINGERPRINTS.has(fingerprint)).toBe(true);
            expect(LEGACY_IPC_FINGERPRINT_PRESETS[fingerprint]).toContain(key);
          }
        }
      }
    }
    expect(LEGACY_IPC_GENERATOR.combinations as number).toBe(combinations);
  },
);
