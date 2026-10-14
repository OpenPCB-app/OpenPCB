import { describe, expect, test } from "bun:test";
import type { DesignerSDK, PcbDesignRules } from "../../../sdks";
import { validateDesignRulesForSave } from "../../../modules/designer/backend/pcb/pcb-store";
import {
  bootDesignerRuntime,
  envelope,
} from "./helpers/designer-runtime";

async function projection(sdk: DesignerSDK, designId: string) {
  return (await sdk.getPcbProjection(designId))!;
}

async function save(
  sdk: DesignerSDK,
  designId: string,
  designRules: unknown,
  boardThicknessMm?: number,
) {
  const revision = (await projection(sdk, designId)).revision;
  return sdk.dispatchCommand(
    designId,
    envelope(designId, revision, {
      type: "pcb_set_design_rules",
      designRules: designRules as PcbDesignRules,
      ...(boardThicknessMm !== undefined ? { boardThicknessMm } : {}),
    }),
  );
}

describe("design rules validation at the command boundary", () => {
  test("invalid values are refused with a field-specific error; nothing persisted, no revision bump", async () => {
    const { sdk } = await bootDesignerRuntime("designrules-invalid");
    const design = await sdk.createDesign({ name: "Invalid rules" });
    const before = await projection(sdk, design.id);
    const cases: [unknown, string][] = [
      [{ minimums: { clearanceMm: -0.5 } }, "designRules.minimums.clearanceMm must be >= 0 (got -0.5)"],
      [{ clearance: { traceToTraceMm: -0.1 } }, "designRules.clearance.traceToTraceMm"],
      [{ clearance: { padToPadMm: Number.NaN } }, "designRules.clearance.padToPadMm must be a finite number"],
      [{ clearance: { viaToViaMm: Number.POSITIVE_INFINITY } }, "designRules.clearance.viaToViaMm must be a finite number"],
      [{ clearance: { traceToPadMm: "wide" } }, "designRules.clearance.traceToPadMm must be a finite number"],
      [{ minimums: { traceWidthMm: 0 } }, "designRules.minimums.traceWidthMm must be > 0"],
      [{ minimums: { viaDiameterMm: 0.4, viaDrillMm: 0.4 } }, "viaDrillMm must be < viaDiameterMm"],
      [{ dfm: { sliverWidthMm: -1 } }, "designRules.dfm.sliverWidthMm must be >= 0"],
    ];
    for (const [rules, fragment] of cases) {
      const result = await save(sdk, design.id, rules);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("INVALID_PCB_BOARD_SETTINGS");
        expect(JSON.stringify(result)).toContain(fragment);
      }
    }
    const thick = await save(sdk, design.id, undefined, 0);
    expect(thick.ok).toBe(false);
    const after = await projection(sdk, design.id);
    expect(after.board.designRules).toEqual(before.board.designRules);
    expect(after.board.boardThicknessMm).toEqual(before.board.boardThicknessMm);
    expect(after.revision).toBe(before.revision);
  });

  test("zero clearance and positive values are accepted", async () => {
    const { sdk } = await bootDesignerRuntime("designrules-valid");
    const design = await sdk.createDesign({ name: "Valid rules" });
    const zero = await save(sdk, design.id, { clearance: { traceToTraceMm: 0 } });
    expect(zero.ok).toBe(true);
    expect(
      (await projection(sdk, design.id)).board.designRules.clearance.traceToTraceMm,
    ).toBe(0);
    const pos = await save(sdk, design.id, {
      clearance: { traceToTraceMm: 0.3 },
      minimums: { traceWidthMm: 0.15 },
    });
    expect(pos.ok).toBe(true);
    expect(
      (await projection(sdk, design.id)).board.designRules.clearance.traceToTraceMm,
    ).toBe(0.3);
  });

  test("validator allows absent keys and explicit null on optional keys", () => {
    expect(validateDesignRulesForSave(undefined)).toBeNull();
    expect(validateDesignRulesForSave({})).toBeNull();
    expect(
      validateDesignRulesForSave({
        clearance: { holeToBoardEdgeMm: null },
        minimums: { clearanceMm: null },
      }),
    ).toBeNull();
  });
});
