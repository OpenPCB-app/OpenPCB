import { describe, expect, test } from "bun:test";
import renderingPackage from "../../../../node_modules/@openpcb/rendering-core/package.json";
import { buildFootprintRenderModel } from "../../../shared/rendering/footprint-preview-builder";
import {
  ALL_FAMILIES,
  generateFootprint,
  type PackageFamily,
} from "../../../shared/rendering/ipc7351b";
import {
  generatorUnavailableReason,
  type IpcGeneratorIdentity,
} from "../../../modules/library/shared/generator-policy";
import {
  acceptedIpcFingerprint,
  installedIpcQualification,
  ipcFamilyAvailability,
  ipcFingerprintKey,
  type InstalledIpcQualification,
} from "../../../modules/library/shared/generator-qualification";
import type { QualifiedIpcFingerprintTable } from "../../../modules/library/shared/qualified-ipc-fingerprints.generated";
import { padGeometryFingerprint } from "../../../modules/library/backend/qualification/pad-fingerprint";
import {
  resolveGeneratedFootprint,
  UnqualifiedGeneratorError,
} from "../../../modules/library/backend/import/resolve-generated-footprint";

const densities = ["most", "nominal", "least"] as const;
const REMEDY = "Import a verified footprint or draw one instead.";
/** rendering-core ≤ v0.1.3 ships no qualification manifest: the legacy generator. */
const LEGACY_INSTALLED = installedIpcQualification() === null;
const FAMILIES: readonly PackageFamily[] = ALL_FAMILIES.map((family) => family.id);

const CHIP_0603: IpcGeneratorIdentity = {
  kind: "ipc7351b",
  family: "chip",
  size: "0603",
  density: "nominal",
};

/** A synthetic installed manifest + accepted table that accepts chip 0603 as the generator emits it now. */
function acceptChip0603(revision = 7) {
  const fingerprint = padGeometryFingerprint(
    buildFootprintRenderModel(generateFootprint("chip", "0603", "nominal").source)
      .pads,
  );
  return {
    fingerprint,
    installed: { chip: { revision, qualified: true } } as InstalledIpcQualification,
    accepted: {
      chip: { [revision]: { [ipcFingerprintKey("0603", "nominal")]: fingerprint } },
    } as QualifiedIpcFingerprintTable,
  };
}

describe("installed generator (pinned rendering-core)", () => {
  test.if(renderingPackage.version === "0.1.3")(
    "rendering-core 0.1.3 ships no qualification manifest",
    () => {
      expect(installedIpcQualification()).toBeNull();
    },
  );

  test.if(LEGACY_INSTALLED)(
    "every IPC family is quarantined with an actionable reason (D1)",
    () => {
      for (const family of FAMILIES) {
        const reason = generatorUnavailableReason(family);
        expect(reason).not.toBeNull();
        expect(reason).toContain("unavailable");
        expect(reason!.endsWith(REMEDY)).toBe(true);
      }
      // The pre-H15 SOT / QFN reasons are kept verbatim.
      expect(generatorUnavailableReason("sot")).toBe(
        "SOT presets are unavailable because generated pad counts and tab layouts are incorrect. Import a verified footprint or draw one instead.",
      );
      expect(generatorUnavailableReason("qfn")).toBe(
        "QFN presets are unavailable because the exposed pad overlaps signal pads. Import a verified footprint or draw one instead.",
      );
    },
  );

  test.if(LEGACY_INSTALLED)(
    "legacy SOT generator reproduces the quarantined counts and missing SOT-223 tab",
    () => {
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
    },
  );

  test.if(LEGACY_INSTALLED)(
    "every legacy exposed QFN preset overlaps its perimeter pads at every density",
    () => {
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
    },
  );

  test.if(LEGACY_INSTALLED)(
    "legacy chip and SOIC lands sit outside the KiCad oracle positions (D1 evidence)",
    () => {
      // KiCad R_0603_1608Metric centre |x| 0.825; SOIC-8_3.9x4.9mm_P1.27mm 2.475.
      const chip = generateFootprint("chip", "0603", "nominal").source.pads;
      expect(chip.map((pad) => Math.abs(pad.centerMm.x))).toEqual([1.15, 1.15]);
      const soic = generateFootprint("soic", "SOIC-8", "nominal").source.pads;
      expect(soic.every((pad) => Math.abs(pad.centerMm.x) === 3)).toBe(true);
    },
  );
});

describe("installedIpcQualification feature detection", () => {
  test("absent or non-object manifests read as null (quarantine)", () => {
    for (const namespace of [
      null,
      {},
      { IPC7351B_QUALIFICATION: null },
      { IPC7351B_QUALIFICATION: [] },
      { IPC7351B_QUALIFICATION: "qualified" },
    ]) {
      expect(installedIpcQualification(namespace)).toBeNull();
    }
  });

  test("any malformed family entry voids the whole manifest", () => {
    for (const entry of [
      null,
      { revision: 0, qualified: true },
      { revision: -1, qualified: true },
      { revision: 1.5, qualified: true },
      { revision: "2", qualified: true },
      { revision: 2, qualified: "yes" },
      { revision: 2 },
    ]) {
      expect(
        installedIpcQualification({
          IPC7351B_QUALIFICATION: {
            chip: { revision: 2, qualified: true },
            soic: entry,
          },
        }),
      ).toBeNull();
    }
  });

  test("a well-formed manifest keeps known families and ignores unknown keys", () => {
    expect(
      installedIpcQualification({
        IPC7351B_QUALIFICATION: {
          chip: { revision: 2, qualified: true, sources: ["IPC-SM-782"] },
          qfn: { revision: 3, qualified: false },
          bga: { revision: 1, qualified: true },
        },
      }),
    ).toEqual({
      chip: { revision: 2, qualified: true },
      qfn: { revision: 3, qualified: false },
    });
  });
});

describe("ipcFamilyAvailability", () => {
  const accepted: QualifiedIpcFingerprintTable = {
    chip: { 2: { "0603|nominal": "f".repeat(64) } },
  };

  test("no manifest ⇒ every family unavailable with its legacy reason", () => {
    for (const family of FAMILIES) {
      const availability = ipcFamilyAvailability(family, null, accepted);
      expect(availability.available).toBe(false);
      if (availability.available) continue;
      expect(availability.reason.endsWith(REMEDY)).toBe(true);
    }
  });

  test("family missing from the manifest ⇒ unavailable", () => {
    const availability = ipcFamilyAvailability("soic", {}, accepted);
    expect(availability).toEqual({
      available: false,
      reason: `SOIC presets are unavailable because the installed generator declares no qualification for them. ${REMEDY}`,
    });
  });

  test("manifest says unqualified ⇒ unavailable even with an accepted block", () => {
    const availability = ipcFamilyAvailability(
      "chip",
      { chip: { revision: 2, qualified: false } },
      accepted,
    );
    expect(availability).toEqual({
      available: false,
      reason: `Chip presets from generator revision 2 are not marked qualified by the installed generator. ${REMEDY}`,
    });
  });

  test("qualified upstream but no accepted block for that revision ⇒ generic reason", () => {
    const tables: QualifiedIpcFingerprintTable[] = [
      {},
      { chip: { 1: { "0603|nominal": "a" } } },
    ];
    for (const table of tables) {
      expect(
        ipcFamilyAvailability(
          "chip",
          { chip: { revision: 2, qualified: true } },
          table,
        ),
      ).toEqual({
        available: false,
        reason: `Chip presets from generator revision 2 have not passed OpenPCB's land-pattern qualification. ${REMEDY}`,
      });
    }
  });

  test("qualified upstream with an accepted block ⇒ available at that revision", () => {
    expect(
      ipcFamilyAvailability(
        "chip",
        { chip: { revision: 2, qualified: true } },
        accepted,
      ),
    ).toEqual({ available: true, revision: 2 });
  });

  test("generatorUnavailableReason delegates to the installed availability", () => {
    for (const family of FAMILIES) {
      const availability = ipcFamilyAvailability(family);
      expect(generatorUnavailableReason(family)).toBe(
        availability.available ? null : availability.reason,
      );
    }
  });
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
        const availability = ipcFamilyAvailability(family.id);
        if (!availability.available) {
          expect(() => resolveGeneratedFootprint({ generator })).toThrow(
            new UnqualifiedGeneratorError(availability.reason),
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
        expect(result.provenance.ipcRevision).toBe(availability.revision);
        const accepted = acceptedIpcFingerprint(
          family.id,
          availability.revision,
          size.label,
          density,
        );
        expect(accepted).not.toBeNull();
        expect(result.provenance.padFingerprint).toBe(accepted!);
      });
    }
  }
}

describe("server fingerprint check", () => {
  test("accepted output resolves with diagnostic revision and pad fingerprint", () => {
    const { fingerprint, installed, accepted } = acceptChip0603();
    const expected = generateFootprint("chip", "0603", "nominal");
    const result = resolveGeneratedFootprint(
      { generator: CHIP_0603, source: expected.source, metadata: expected.metadata },
      { installed, accepted },
    );
    if (!("presetParameters" in result.provenance))
      throw new Error("expected IPC provenance");
    expect(result.provenance.ipcRevision).toBe(7);
    expect(result.provenance.padFingerprint).toBe(fingerprint);
    expect(result.provenance.generatedSourceSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("installed output that differs from its accepted evidence is refused, family stays offered", () => {
    const { installed } = acceptChip0603();
    const tables: QualifiedIpcFingerprintTable[] = [
      { chip: { 7: { "0603|nominal": "0".repeat(64) } } },
      // Block exists, preset missing from it.
      { chip: { 7: { "0402|nominal": "0".repeat(64) } } },
    ];
    for (const accepted of tables) {
      expect(ipcFamilyAvailability("chip", installed, accepted).available).toBe(
        true,
      );
      expect(() =>
        resolveGeneratedFootprint({ generator: CHIP_0603 }, { installed, accepted }),
      ).toThrow(
        new UnqualifiedGeneratorError(
          "The installed generator's output differs from its qualification evidence.",
        ),
      );
    }
  });

  test("a revision without an accepted block is refused with the generic reason", () => {
    const { accepted } = acceptChip0603(7);
    expect(() =>
      resolveGeneratedFootprint(
        { generator: CHIP_0603 },
        { installed: { chip: { revision: 8, qualified: true } }, accepted },
      ),
    ).toThrow("have not passed OpenPCB's land-pattern qualification");
  });
});

test("identity rejects unknown kinds, sizes, densities, omitted parameters and spoofed metadata", () => {
  const generator = { ...CHIP_0603 };
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
  // Reach the preview comparison past the availability gate.
  const inputs = acceptChip0603();
  const preview = generateFootprint("chip", "0603", "nominal");
  expect(() =>
    resolveGeneratedFootprint(
      { generator, source: { ...preview.source, name: "spoofed" } },
      inputs,
    ),
  ).toThrow("preview does not match");
  expect(() =>
    resolveGeneratedFootprint(
      { generator, metadata: { ...preview.metadata, name: "spoofed" } },
      inputs,
    ),
  ).toThrow("preview does not match");
});
