import { expect, test } from "bun:test";
import {
  ALL_FAMILIES,
  generateFootprint,
} from "../../../shared/rendering/ipc7351b";
import { generatorUnavailableReason } from "../../../modules/library/shared/generator-policy";
import {
  resolveGeneratedFootprint,
  UnqualifiedGeneratorError,
} from "../../../modules/library/backend/import/resolve-generated-footprint";
import type { IpcGeneratorIdentity } from "../../../modules/library/shared/generator-policy";

const densities = ["most", "nominal", "least"] as const;

test("installed SOT generator reproduces the quarantined counts and missing SOT-223 tab", () => {
  const counts = { "SOT-23": 4, "SOT-23-5": 6, "SOT-323": 4, "SOT-223": 4 };
  for (const density of densities) {
    for (const [size, count] of Object.entries(counts)) {
      const source = generateFootprint("sot", size, density).source;
      expect(source.pads).toHaveLength(count);
      if (size === "SOT-223") {
        expect(
          new Set(source.pads.map((pad) => `${pad.widthMm}:${pad.heightMm}`))
            .size,
        ).toBe(1);
      }
    }
  }
});

test("every exposed QFN preset reproduces positive exposed-pad/perimeter overlap at every density", () => {
  const family = ALL_FAMILIES.find((family) => family.id === "qfn")!;
  for (const size of family.sizes) {
    for (const density of densities) {
      const pads = generateFootprint("qfn", size.label, density).source.pads;
      const ep = pads[pads.length - 1];
      if (!ep) throw new Error("QFN fixture has no exposed pad");
      const overlap = pads
        .slice(0, -1)
        .filter(
          (pad) =>
            Math.abs(pad.centerMm.x - ep.centerMm.x) <
              (pad.widthMm + ep.widthMm) / 2 &&
            Math.abs(pad.centerMm.y - ep.centerMm.y) <
              (pad.heightMm + ep.heightMm) / 2,
        );
      expect(overlap.length).toBe(pads.length - 1);
    }
  }
});

for (const family of ALL_FAMILIES) {
  for (const size of family.sizes) {
    for (const density of densities) {
      test(`${family.id}/${size.label}/${density}: policy matches server generator resolution`, () => {
        const generator: IpcGeneratorIdentity = {
          kind: "ipc7351b",
          family: family.id,
          size: size.label,
          density,
        };
        if (generatorUnavailableReason(family.id)) {
          expect(() => resolveGeneratedFootprint({ generator })).toThrow(
            UnqualifiedGeneratorError,
          );
          return;
        }
        const expected = generateFootprint(family.id, size.label, density);
        const result = resolveGeneratedFootprint({
          generator,
          source: expected.source,
          metadata: expected.metadata,
        });
        expect(result.source).toEqual(expected.source);
        expect(result.metadata).toEqual(expected.metadata);
        expect(result.provenance.generator).toEqual(generator);
        if (!("presetParameters" in result.provenance))
          throw new Error("expected IPC provenance");
        expect(result.provenance.presetParameters).toEqual(size.params);
        expect(result.provenance.generatorPackage.name).toBe(
          "@openpcb/rendering-core",
        );
        expect(result.provenance.generatorPackage.version).toMatch(
          /^\d+\.\d+\.\d+/,
        );
        expect(result.provenance.generatedSourceSha256).toMatch(
          /^[a-f0-9]{64}$/,
        );
      });
    }
  }
}

test("identity rejects unknown kinds, sizes, densities, omitted parameters and spoofed metadata", () => {
  const generator = {
    kind: "ipc7351b",
    family: "chip",
    size: "0603",
    density: "nominal",
  };
  for (const value of [
    undefined,
    null,
    {},
    { ...generator, kind: "parametric" },
    { ...generator, size: "invented" },
    { ...generator, density: "invented" },
    { ...generator, provenance: "drawn" },
  ]) {
    expect(() => resolveGeneratedFootprint({ generator: value })).toThrow(
      UnqualifiedGeneratorError,
    );
  }
  const preview = generateFootprint("chip", "0603", "nominal");
  expect(() =>
    resolveGeneratedFootprint({
      generator,
      source: { ...preview.source, name: "spoofed" },
    }),
  ).toThrow("preview does not match");
  expect(() =>
    resolveGeneratedFootprint({
      generator,
      metadata: { ...preview.metadata, name: "spoofed" },
    }),
  ).toThrow("preview does not match");
});
