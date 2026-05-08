import { describe, expect, test } from "bun:test";
import {
  BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID,
  BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID,
  listAllBuiltinFootprintSeeds,
} from "./footprint-seeds";

describe("builtin footprint seeds", () => {
  const seeds = listAllBuiltinFootprintSeeds();
  const now = "2026-05-08T00:00:00.000Z";

  test("ships exactly 17 seeds with unique ids and unique sourceHashes", () => {
    expect(seeds.length).toBe(17);
    const ids = new Set(seeds.map((s) => s.footprintId));
    expect(ids.size).toBe(17);
    const hashes = new Set(seeds.map((s) => s.sourceHash));
    expect(hashes.size).toBe(17);
  });

  test("every seed builds a parseable dataJson with 2 pads", () => {
    for (const seed of seeds) {
      const built = seed.build(now);
      expect(built.padCount).toBe(2);
      const parsed = JSON.parse(built.dataJson) as {
        normalized: {
          mountType: string;
          padCount: number;
          preview: { kind: string; pads: unknown[] } | null;
        };
        provenance: { sourceHash: string; sourceFormat: string };
      };
      expect(parsed.normalized.padCount).toBe(2);
      expect(parsed.normalized.mountType).toBe(seed.mountType);
      expect(parsed.provenance.sourceFormat).toBe("kicad-mod");
      expect(parsed.provenance.sourceHash).toBe(seed.sourceHash);
      expect(parsed.normalized.preview).not.toBeNull();
      expect(parsed.normalized.preview!.kind).toBe("footprint");
      expect(parsed.normalized.preview!.pads.length).toBe(2);
    }
  });

  test("THT seeds have drilled pads on *.Cu layer", () => {
    const tht = seeds.filter((s) => s.mountType === "through_hole");
    expect(tht.length).toBe(6);
    for (const seed of tht) {
      const parsed = JSON.parse(seed.build(now).dataJson) as {
        normalized: {
          preview: {
            pads: Array<{ drillDiameterMm?: number; layer: string }>;
          };
        };
      };
      for (const pad of parsed.normalized.preview.pads) {
        expect(pad.drillDiameterMm).toBeGreaterThan(0);
        expect(pad.layer).toBe("*.Cu");
      }
    }
  });

  test("SMD chip seeds use F.Cu copper", () => {
    const smd = seeds.filter((s) => s.mountType === "smd");
    expect(smd.length).toBe(11);
    for (const seed of smd) {
      const parsed = JSON.parse(seed.build(now).dataJson) as {
        normalized: { preview: { pads: Array<{ layer: string }> } };
      };
      for (const pad of parsed.normalized.preview.pads) {
        expect(pad.layer).toBe("F.Cu");
      }
    }
  });

  test("default footprint IDs are present in the seed list", () => {
    const ids = new Set(seeds.map((s) => s.footprintId));
    expect(ids.has(BUILTIN_DEFAULT_RESISTOR_FOOTPRINT_ID)).toBe(true);
    expect(ids.has(BUILTIN_DEFAULT_CAPACITOR_FOOTPRINT_ID)).toBe(true);
  });

  test("repeated build() returns the same JSON shape (cached parse + preview)", () => {
    const r0603 = seeds.find(
      (s) => s.footprintId === "builtin:fp:r-0603-1608m",
    );
    expect(r0603).toBeDefined();
    const a = r0603!.build(now).dataJson;
    const b = r0603!.build(now).dataJson;
    expect(a).toBe(b);
  });
});
