import { describe, expect, test } from "bun:test";
import { VIA_PRESETS } from "../../../modules/designer/backend/pcb/via-presets";

describe("via presets", () => {
  test("no preset advertises micro/phase copy (route tool only commits through vias)", () => {
    for (const p of VIA_PRESETS) {
      for (const text of [p.id, p.name, p.description]) {
        expect(text).not.toMatch(/micro/i);
        expect(text).not.toMatch(/phase/i);
      }
    }
  });

  test("every preset has a drill smaller than its pad diameter", () => {
    for (const p of VIA_PRESETS) expect(p.drillMm).toBeLessThan(p.diameterMm);
  });
});
