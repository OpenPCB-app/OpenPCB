import { describe, expect, test } from "bun:test";
import { buildExportBundle } from "../../../modules/designer/backend/export";
import { packZip } from "../../../modules/designer/backend/export/zip";
import {
  BLINKER_REFERENCES,
  build555BlinkerPcb,
  build555BlinkerSchematic,
} from "./fixtures/blinker-555";

// =========================================================================
// 555 blinker fab-export validation — proves a small real board produces a
// complete, structurally valid manufacturing bundle. Manual KiCad GerbView
// pass is tracked in docs/validation/555-blinker-gerbview.md.
// =========================================================================

function bundle() {
  return buildExportBundle(build555BlinkerPcb(), build555BlinkerSchematic());
}

function artifact(name: string) {
  const found = bundle().artifacts.find((a) => a.fileName.endsWith(name));
  if (!found) throw new Error(`missing artifact ${name}`);
  return found.text;
}

describe("555 blinker export bundle", () => {
  test("emits every expected fab artifact for a 2-layer board", () => {
    const names = bundle().artifacts.map((a) =>
      a.fileName.replace(/^openpcb-blink555[.-]/, ""),
    );
    expect(new Set(names)).toEqual(
      new Set([
        "F_Cu.gbr",
        "B_Cu.gbr",
        "F_Mask.gbr",
        "B_Mask.gbr",
        "F_Paste.gbr",
        "B_Paste.gbr",
        "F_Silkscreen.gbr",
        "B_Silkscreen.gbr",
        "Edge_Cuts.gbr",
        "PTH.drl",
        "NPTH.drl",
        "BOM.csv",
        "PnP.csv",
        "gbrjob", // Gerber job file describing the layer stack.
      ]),
    );
  });

  test("export's only warning is the benign missing-MPN sourcing note", () => {
    // The fixture parts intentionally carry no MPN/LCSC number, so the
    // assembly-sourcing pass emits one advisory warning; no other (structural)
    // warnings are expected.
    const warnings = bundle().warnings;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no MPN/LCSC part number");
  });

  test("top + bottom copper carry conductors and pad flashes", () => {
    const top = artifact("F_Cu.gbr");
    const bottom = artifact("B_Cu.gbr");
    // Both layers must have real geometry (D01 draws and/or D03 flashes).
    expect(top).toContain("D03*"); // pad / via flashes on top
    expect(top).toContain("D01*"); // routed conductor on top
    expect(bottom).toContain("D01*"); // GND routed on bottom
    // Bottom copper sees the through-via annulus.
    expect(bottom).toContain("D03*");
  });

  test("edge cuts emit a closed board outline", () => {
    const edge = artifact("Edge_Cuts.gbr");
    expect(edge).toContain("%TF.FileFunction,Profile,NP*%");
    const draws = edge.match(/D01\*/g) ?? [];
    expect(draws.length).toBe(4); // rectangle: 4 sides
  });

  test("PTH drill file defines plated tool holes", () => {
    const pth = artifact("PTH.drl");
    // DIP-8 (8) + header (2) = 10 plated holes; at least one tool definition.
    expect(pth).toMatch(/T\d+C/); // tool diameter definition
    const hits = pth.match(/^X.*Y/gm) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(10);
  });

  test("NPTH drill file carries the mounting holes", () => {
    const npth = artifact("NPTH.drl");
    const hits = npth.match(/^X.*Y/gm) ?? [];
    expect(hits.length).toBe(2); // two 3.2 mm mounting holes
  });

  test("paste layer covers only SMD pads", () => {
    const paste = artifact("F_Paste.gbr");
    const flashes = paste.match(/D03\*/g) ?? [];
    // 3 resistors + 2 caps + 1 LED = 6 SMD parts × 2 pads = 12.
    expect(flashes.length).toBe(12);
  });

  test("BOM lists every reference with its value", () => {
    const bom = artifact("BOM.csv");
    for (const ref of BLINKER_REFERENCES) {
      expect(bom).toContain(ref);
    }
    expect(bom).toContain("NE555P");
    expect(bom).toContain("LED");
  });

  test("PnP lists one row per SMD placement (THT parts excluded)", () => {
    const pnp = artifact("PnP.csv");
    const rows = pnp.trim().split("\r\n");
    // header + one row per SMD placement. Pick-and-place is SMD-only, so the
    // two through-hole parts (U1 DIP-8, J1 header) are excluded: of the 8
    // references, 6 are SMD (3 resistors + 2 caps + 1 LED).
    expect(rows.length).toBe(7);
    expect(rows[0]).toBe("Designator,Val,Package,Mid X,Mid Y,Rotation,Layer");
    expect(pnp).not.toContain("U1,");
    expect(pnp).not.toContain("J1,");
  });

  test("packs into a valid ZIP archive", () => {
    const zip = packZip(bundle().artifacts);
    // Local file header signature 0x04034b50 (little-endian) at the head.
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature at the tail.
    const tail = zip.subarray(zip.length - 22, zip.length - 18);
    expect(Array.from(tail)).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
