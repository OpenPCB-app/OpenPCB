import { describe, expect, test } from "bun:test";
import {
  PARAMETRIC_TEMPLATES,
  defaultValues,
  generateMountingArray,
  generatePinHeader,
  generateScrewTerminal,
  getTemplate,
  hashParams,
  validateParams,
} from "../../../shared/rendering/parametric";
import { PIN_HEADER_SCHEMA } from "../../../shared/rendering/parametric";

describe("parametric param schema", () => {
  test("defaultValues collects every field default", () => {
    const v = defaultValues(PIN_HEADER_SCHEMA);
    expect(v).toEqual({
      rows: 1,
      pinsPerRow: 4,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
  });

  test("validateParams accepts valid input", () => {
    const result = validateParams(PIN_HEADER_SCHEMA, {
      rows: 2,
      pinsPerRow: 10,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.rows).toBe(2);
  });

  test("validateParams falls back to defaults for missing fields", () => {
    const result = validateParams(PIN_HEADER_SCHEMA, { rows: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values.pinsPerRow).toBe(4);
    expect(result.values.pitchMm).toBe(2.54);
  });

  test("validateParams rejects out-of-bounds int", () => {
    const result = validateParams(PIN_HEADER_SCHEMA, { rows: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.key).toBe("rows");
  });

  test("validateParams rejects bad enum", () => {
    const result = validateParams(PIN_HEADER_SCHEMA, { mount: "weird" });
    expect(result.ok).toBe(false);
  });

  test("hashParams is deterministic regardless of key order", () => {
    const a = hashParams({ rows: 2, pinsPerRow: 10, pitchMm: 2.54 });
    const b = hashParams({ pitchMm: 2.54, pinsPerRow: 10, rows: 2 });
    expect(a).toBe(b);
  });

  test("hashParams differentiates distinct values", () => {
    expect(hashParams({ rows: 2 })).not.toBe(hashParams({ rows: 3 }));
  });
});

describe("pin header generator", () => {
  test("01x04 vertical THT has 4 pads with drills", () => {
    const r = generatePinHeader({
      rows: 1,
      pinsPerRow: 4,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    expect(r.source.pads).toHaveLength(4);
    expect(r.source.pads.every((p) => (p.drillDiameterMm ?? 0) > 0)).toBe(true);
    expect(r.mountType).toBe("through_hole");
    expect(r.tags).toContain("pinheader");
  });

  test("02x10 has 20 pads numbered 1..20", () => {
    const r = generatePinHeader({
      rows: 2,
      pinsPerRow: 10,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    expect(r.source.pads).toHaveLength(20);
    const nums = r.source.pads.map((p) => p.number).sort();
    expect(nums[0]).toBe("1");
    expect(nums[nums.length - 1]).toBe("9"); // string sort
  });

  test("SMD variant produces pads without drills", () => {
    const r = generatePinHeader({
      rows: 1,
      pinsPerRow: 4,
      pitchMm: 1.27,
      mount: "smd",
      orientation: "vertical",
    });
    expect(r.source.pads.every((p) => p.drillDiameterMm === undefined)).toBe(
      true,
    );
    expect(r.mountType).toBe("smd");
  });

  test("deterministic across runs (same params → same output)", () => {
    const a = generatePinHeader({
      rows: 2,
      pinsPerRow: 6,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    const b = generatePinHeader({
      rows: 2,
      pinsPerRow: 6,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("name embeds size + pitch + mount + orientation", () => {
    const r = generatePinHeader({
      rows: 2,
      pinsPerRow: 10,
      pitchMm: 2.54,
      mount: "tht",
      orientation: "vertical",
    });
    expect(r.name).toContain("02x10");
    expect(r.name).toContain("2.54");
    expect(r.name).toContain("THT");
  });
});

describe("screw terminal generator", () => {
  test("2-pole 5.08mm produces 2 pads with drills", () => {
    const r = generateScrewTerminal({ poles: 2, pitchMm: 5.08, drillMm: 1.3 });
    expect(r.source.pads).toHaveLength(2);
    expect(r.source.pads[0]?.drillDiameterMm).toBe(1.3);
  });

  test("pad numbering starts at 1", () => {
    const r = generateScrewTerminal({ poles: 4, pitchMm: 5.08, drillMm: 1.3 });
    expect(r.source.pads.map((p) => p.number)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("mounting array generator", () => {
  test("2x2 grid produces 4 holes", () => {
    const r = generateMountingArray({
      rows: 2,
      cols: 2,
      pitchXMm: 20,
      pitchYMm: 20,
      drillMm: 3.2,
      plated: false,
    });
    expect(r.source.pads).toHaveLength(4);
    expect(r.source.pads.every((p) => p.drillDiameterMm === 3.2)).toBe(true);
  });

  test("centered around origin", () => {
    const r = generateMountingArray({
      rows: 2,
      cols: 2,
      pitchXMm: 20,
      pitchYMm: 30,
      drillMm: 3.2,
      plated: true,
    });
    const xs = r.source.pads.map((p) => p.centerMm.x).sort((a, b) => a - b);
    const ys = r.source.pads.map((p) => p.centerMm.y).sort((a, b) => a - b);
    expect(xs[0]).toBe(-10);
    expect(xs[xs.length - 1]).toBe(10);
    expect(ys[0]).toBe(-15);
    expect(ys[ys.length - 1]).toBe(15);
  });
});

describe("template registry", () => {
  test("ships pin-header, screw-terminal, mounting-array", () => {
    const ids = PARAMETRIC_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(["mounting-array", "pin-header", "screw-terminal"]);
  });

  test("getTemplate roundtrip", () => {
    expect(getTemplate("pin-header")?.id).toBe("pin-header");
    expect(getTemplate("missing")).toBeNull();
  });

  test("template.generate runs from defaultValues", () => {
    for (const template of PARAMETRIC_TEMPLATES) {
      const values = defaultValues(template.schema);
      const result = template.generate(values);
      expect(result.source.pads.length).toBeGreaterThan(0);
      expect(result.name.length).toBeGreaterThan(0);
    }
  });
});
