import { describe, expect, it } from "vitest";
import type { ParamSchema } from "../../../../shared/rendering/parametric";
import {
  missingPinNumbers,
  validateTemplateParams,
} from "./footprint-validation";

const schema: ParamSchema = {
  fields: [
    { kind: "int", key: "pins", label: "Pins", min: 1, max: 40, default: 4 },
    {
      kind: "float",
      key: "pitch",
      label: "Pitch",
      min: 0.5,
      max: 5,
      default: 2.54,
    },
    {
      kind: "enum",
      key: "row",
      label: "Row",
      options: [
        { value: "single", label: "Single" },
        { value: "dual", label: "Dual" },
      ],
      default: "single",
    },
    { kind: "bool", key: "silk", label: "Silk", default: true },
  ],
};

describe("validateTemplateParams", () => {
  it("coerces numeric strings and fills defaults", () => {
    const result = validateTemplateParams(schema, { pins: "8", pitch: "1.27" });
    expect(result).toEqual({
      ok: true,
      values: { pins: 8, pitch: 1.27, row: "single", silk: true },
    });
  });

  it("rejects out-of-range, non-integer and unknown enum values", () => {
    const result = validateTemplateParams(schema, {
      pins: "2.5",
      pitch: "9",
      row: "triple",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.pins).toMatch(/integer/);
    expect(result.errors.pitch).toMatch(/between 0.5 and 5/);
    expect(result.errors.row).toMatch(/one of/);
  });

  it("treats a blank numeric field as an error, not zero", () => {
    const result = validateTemplateParams(schema, { pins: "  " });
    expect(result).toEqual({ ok: false, errors: { pins: "is required" } });
  });

  it("rejects non-boolean bool values", () => {
    const result = validateTemplateParams(schema, { silk: "yes" });
    expect(result.ok).toBe(false);
  });
});

describe("missingPinNumbers", () => {
  it("lists pins without a pad, deduped, first-seen order", () => {
    expect(
      missingPinNumbers(["1", "2", "3", "2", " 4 "], [
        { number: "1" },
        { number: "3" },
      ]),
    ).toEqual(["2", "4"]);
  });

  it("is empty when every pin is covered (extra pads allowed)", () => {
    expect(
      missingPinNumbers(["1", "2"], [{ number: "1" }, { number: "2" }, { number: "MP" }]),
    ).toEqual([]);
  });

  it("ignores blank pin numbers", () => {
    expect(missingPinNumbers(["", " "], [])).toEqual([]);
  });
});
