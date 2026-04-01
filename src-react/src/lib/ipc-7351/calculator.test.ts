import { describe, it, expect } from "vitest";
import {
  calculatePadDimensions,
  calculateBgaPadDiameter,
  calculateBgaCourtyard,
  calculateAllDensities,
  selectLeadType,
  roundToGrid,
} from "./calculator";
import { generateIpcName } from "./naming";
import type { ComponentDimensions, BgaDimensions } from "./types";

// ---------------------------------------------------------------------------
// roundToGrid
// ---------------------------------------------------------------------------

describe("roundToGrid", () => {
  it("rounds to 0.05mm grid", () => {
    expect(roundToGrid(1.23)).toBe(1.25);
    expect(roundToGrid(1.22)).toBe(1.2);
    expect(roundToGrid(1.275)).toBe(1.25); // 1.275/0.05=25.499.. rounds to 25
    expect(roundToGrid(0.0)).toBe(0.0);
    expect(roundToGrid(0.025)).toBe(0.05);
    expect(roundToGrid(0.024)).toBe(0.0);
  });

  it("handles negative values", () => {
    expect(roundToGrid(-0.03)).toBe(-0.05);
    expect(roundToGrid(-0.02)).toBe(0); // -0.02/0.05 = -0.4 rounds to 0
  });

  it("avoids floating-point artifacts", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754, but roundToGrid should be clean
    const result = roundToGrid(0.30000000000000004);
    expect(result).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// 0805 Chip Resistor (RESC2012X65)
// ---------------------------------------------------------------------------

describe("0805 chip resistor (RESC2012X65)", () => {
  // Datasheet: L=2.0±0.15, W=1.25±0.15, T=0.40±0.15
  // S derived: Smin = L - 2*Tmax = 2.0 - 1.1 = 0.9, Smax = L - 2*Tmin = 2.0 - 0.5 = 1.5
  const dims: ComponentDimensions = {
    Lmin: 1.85,
    Lmax: 2.15,
    Smin: 0.9,
    Smax: 1.5,
    Wmin: 1.1,
    Wmax: 1.4,
    height: 0.65,
    bodyL: 2.0,
    bodyW: 1.25,
  };

  it("calculates nominal density pads with exact values", () => {
    const result = calculatePadDimensions(dims, "chip_rectangular", "nominal");
    // Jt=0.35, Jh=0, Js=0, F=0.05, P=0.025
    // Cl=0.30, Cs=0.60, Cw=0.30
    // Zmax = 1.85 + 0.70 + sqrt(0.09+0.0025+0.000625) = 2.855 → round 2.85
    // Gmin = 1.50 - 0 - sqrt(0.36+0.0025+0.000625) = 0.897 → round 0.90
    // Xmax = 1.10 + 0 + sqrt(0.09+0.0025+0.000625) = 1.405 → round 1.40
    // padLength = (2.85 - 0.90) / 2 = 0.975 → round 1.00
    // padWidth = 1.40
    // center = (2.85 + 0.90) / 2 = 1.875 → round 1.90
    expect(result.outerSpan).toBe(2.85);
    expect(result.innerGap).toBe(0.9);
    expect(result.padWidth).toBe(1.4);
    expect(result.padLength).toBe(1.0);
    expect(result.centerToCenter).toBe(1.9);
  });

  it("most density produces larger pads than nominal", () => {
    const most = calculatePadDimensions(dims, "chip_rectangular", "most");
    const nominal = calculatePadDimensions(dims, "chip_rectangular", "nominal");
    expect(most.padLength).toBeGreaterThan(nominal.padLength);
    expect(most.outerSpan).toBeGreaterThan(nominal.outerSpan);
    expect(most.courtyardWidth).toBeGreaterThan(nominal.courtyardWidth);
  });

  it("least density produces smaller pads than nominal", () => {
    const nominal = calculatePadDimensions(dims, "chip_rectangular", "nominal");
    const least = calculatePadDimensions(dims, "chip_rectangular", "least");
    expect(least.padLength).toBeLessThan(nominal.padLength);
    expect(least.outerSpan).toBeLessThan(nominal.outerSpan);
  });

  it("courtyard exceeds pad extent", () => {
    const result = calculatePadDimensions(dims, "chip_rectangular", "nominal");
    expect(result.courtyardWidth).toBeGreaterThan(result.outerSpan);
    expect(result.courtyardHeight).toBeGreaterThan(result.padWidth);
  });
});

// ---------------------------------------------------------------------------
// SOIC-8 (1.27mm pitch)
// ---------------------------------------------------------------------------

describe("SOIC-8 gull-wing large", () => {
  // SOIC-8: L=5.0±0.3 (lead span), S=3.2±0.3, W=0.40±0.1, pitch=1.27
  const dims: ComponentDimensions = {
    Lmin: 4.7,
    Lmax: 5.3,
    Smin: 2.9,
    Smax: 3.5,
    Wmin: 0.3,
    Wmax: 0.5,
    height: 1.75,
    bodyL: 5.0,
    bodyW: 4.0,
    pitch: 1.27,
    pinCount: 8,
  };

  it("calculates nominal pads with heel fillet", () => {
    const result = calculatePadDimensions(dims, "gull_wing_large", "nominal");
    // Gull-wing large nominal: Jt=0.35, Jh=0.35, Js=0.03
    // Pad should be longer than chip (heel fillet adds length)
    expect(result.padLength).toBeGreaterThan(0.5);
    expect(result.padLength).toBeLessThan(2.0);
    expect(result.padWidth).toBeGreaterThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// QFP-64 (0.5mm pitch, fine-pitch gull-wing)
// ---------------------------------------------------------------------------

describe("QFP-64 gull-wing small", () => {
  const dims: ComponentDimensions = {
    Lmin: 11.8,
    Lmax: 12.2,
    Smin: 9.8,
    Smax: 10.2,
    Wmin: 0.17,
    Wmax: 0.27,
    height: 1.6,
    bodyL: 12.0,
    bodyW: 12.0,
    pitch: 0.5,
    pinCount: 64,
  };

  it("uses negative Js for nominal density", () => {
    const result = calculatePadDimensions(dims, "gull_wing_small", "nominal");
    // Gull-wing small nominal: Js=-0.02, so padWidth < Wmin
    expect(result.padWidth).toBeLessThan(dims.Wmin + 0.1);
  });
});

// ---------------------------------------------------------------------------
// QFN-32 (0.5mm pitch, flat no-lead)
// ---------------------------------------------------------------------------

describe("QFN-32 flat no-lead", () => {
  const dims: ComponentDimensions = {
    Lmin: 4.9,
    Lmax: 5.1,
    Smin: 3.6,
    Smax: 3.8,
    Wmin: 0.18,
    Wmax: 0.3,
    height: 0.8,
    bodyL: 5.0,
    bodyW: 5.0,
    pitch: 0.5,
    pinCount: 32,
  };

  it("has zero heel fillet", () => {
    const result = calculatePadDimensions(dims, "flat_no_lead", "nominal");
    // Flat no-lead: Jh=0, so Gmin = Smax - 0 - rss ≈ Smax - small
    // Inner gap should be close to Smax minus tolerance
    expect(result.innerGap).toBeGreaterThanOrEqual(dims.Smin);
    expect(result.innerGap).toBeLessThanOrEqual(dims.Smax);
  });
});

// ---------------------------------------------------------------------------
// BGA Calculations
// ---------------------------------------------------------------------------

describe("BGA pad diameter", () => {
  it("NSMD pad is ~75-80% of ball diameter", () => {
    const pad = calculateBgaPadDiameter(0.4, "nominal", true);
    expect(pad).toBe(0.3); // 0.40 * 0.75 = 0.30
  });

  it("SMD pad equals ball diameter", () => {
    const pad = calculateBgaPadDiameter(0.4, "nominal", false);
    expect(pad).toBe(0.4); // 0.40 * 1.00
  });
});

describe("BGA courtyard", () => {
  const dims: BgaDimensions = {
    ballDiameter: 0.4,
    pitch: 0.8,
    cols: 10,
    rows: 10,
    bodyL: 10.0,
    bodyW: 10.0,
    nsmd: true,
  };

  it("courtyard covers body + excess", () => {
    const result = calculateBgaCourtyard(dims, "nominal");
    expect(result.width).toBeGreaterThan(10.0);
    expect(result.height).toBeGreaterThan(10.0);
  });
});

// ---------------------------------------------------------------------------
// Multi-Density
// ---------------------------------------------------------------------------

describe("calculateAllDensities", () => {
  const dims: ComponentDimensions = {
    Lmin: 1.5,
    Lmax: 1.7,
    Smin: 0.5,
    Smax: 0.7,
    Wmin: 0.7,
    Wmax: 0.9,
    height: 0.55,
    bodyL: 1.6,
    bodyW: 0.8,
  };

  it("returns 3 results ordered most/nominal/least", () => {
    const results = calculateAllDensities(dims, "chip_rectangular", "RESC");
    expect(results).toHaveLength(3);
    const [most, nominal, least] = results;
    expect(most!.densityLevel).toBe("most");
    expect(nominal!.densityLevel).toBe("nominal");
    expect(least!.densityLevel).toBe("least");
  });

  it("pad sizes decrease from most to least", () => {
    const results = calculateAllDensities(dims, "chip_rectangular", "RESC");
    const [most, nominal, least] = results;
    expect(most!.pads.padLength).toBeGreaterThan(nominal!.pads.padLength);
    expect(nominal!.pads.padLength).toBeGreaterThan(least!.pads.padLength);
  });

  it("each result has an IPC name", () => {
    const results = calculateAllDensities(dims, "chip_rectangular", "RESC");
    const [most, nominal, least] = results;
    expect(most!.ipcName).toMatch(/^RESC.*M$/);
    expect(nominal!.ipcName).toMatch(/^RESC.*N$/);
    expect(least!.ipcName).toMatch(/^RESC.*L$/);
  });
});

// ---------------------------------------------------------------------------
// selectLeadType
// ---------------------------------------------------------------------------

describe("selectLeadType", () => {
  it("identifies chip components", () => {
    expect(selectLeadType("RESC")).toBe("chip_rectangular");
    expect(selectLeadType("resistor")).toBe("chip_rectangular");
  });

  it("identifies gull-wing by pitch", () => {
    expect(selectLeadType("QFP", 0.5)).toBe("gull_wing_small");
    expect(selectLeadType("QFP", 0.65)).toBe("gull_wing_large");
    expect(selectLeadType("SOIC")).toBe("gull_wing_large");
  });

  it("identifies J-lead", () => {
    expect(selectLeadType("PLCC")).toBe("j_lead");
    expect(selectLeadType("SOJ")).toBe("j_lead");
  });

  it("identifies flat no-lead", () => {
    expect(selectLeadType("QFN")).toBe("flat_no_lead");
    expect(selectLeadType("DFN")).toBe("flat_no_lead");
    expect(selectLeadType("PQFN")).toBe("pullback_no_lead");
  });

  it("identifies BGA", () => {
    expect(selectLeadType("BGA")).toBe("bga");
  });
});

// ---------------------------------------------------------------------------
// IPC Naming Convention
// ---------------------------------------------------------------------------

describe("generateIpcName", () => {
  it("generates chip name: RESC1608X55N", () => {
    const dims: ComponentDimensions = {
      Lmin: 1.5,
      Lmax: 1.7,
      Smin: 0.5,
      Smax: 0.7,
      Wmin: 0.7,
      Wmax: 0.9,
      height: 0.55,
      bodyL: 1.6,
      bodyW: 0.8,
    };
    const name = generateIpcName("RESC", dims, "nominal");
    expect(name).toBe("RESC1608X55N");
  });

  it("appends density suffix correctly", () => {
    const dims: ComponentDimensions = {
      Lmin: 1.85,
      Lmax: 2.15,
      Smin: 0.9,
      Smax: 1.5,
      Wmin: 1.1,
      Wmax: 1.4,
      height: 0.65,
      bodyL: 2.0,
      bodyW: 1.25,
    };
    expect(generateIpcName("RESC", dims, "most")).toMatch(/M$/);
    expect(generateIpcName("RESC", dims, "nominal")).toMatch(/N$/);
    expect(generateIpcName("RESC", dims, "least")).toMatch(/L$/);
  });

  it("generates multi-pin name with pitch and pin count", () => {
    const dims: ComponentDimensions = {
      Lmin: 5.8,
      Lmax: 6.2,
      Smin: 3.8,
      Smax: 4.2,
      Wmin: 0.3,
      Wmax: 0.5,
      height: 1.2,
      bodyL: 6.4,
      bodyW: 4.4,
      pitch: 0.65,
      pinCount: 16,
    };
    const name = generateIpcName("SOP", dims, "nominal");
    expect(name).toContain("SOP");
    expect(name).toContain("65P");
    expect(name).toContain("-16");
    expect(name).toMatch(/N$/);
  });

  it("generates quad package name with two body dimensions", () => {
    const dims: ComponentDimensions = {
      Lmin: 11.8,
      Lmax: 12.2,
      Smin: 9.8,
      Smax: 10.2,
      Wmin: 0.17,
      Wmax: 0.27,
      height: 1.6,
      bodyL: 12.0,
      bodyW: 12.0,
      pitch: 0.5,
      pinCount: 64,
    };
    const name = generateIpcName("QFP", dims, "nominal");
    expect(name).toContain("QFP");
    expect(name).toContain("50P");
    expect(name).toContain("-64");
    expect(name).toMatch(/N$/);
  });
});

// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------

describe("input validation", () => {
  const validDims: ComponentDimensions = {
    Lmin: 1.85,
    Lmax: 2.15,
    Smin: 0.9,
    Smax: 1.5,
    Wmin: 1.1,
    Wmax: 1.4,
  };

  it("throws on Lmax < Lmin", () => {
    expect(() =>
      calculatePadDimensions(
        { ...validDims, Lmin: 2.0, Lmax: 1.5 },
        "chip_rectangular",
        "nominal",
      ),
    ).toThrow("Invalid L dimensions");
  });

  it("throws on Smax < Smin", () => {
    expect(() =>
      calculatePadDimensions(
        { ...validDims, Smin: 2.0, Smax: 1.0 },
        "chip_rectangular",
        "nominal",
      ),
    ).toThrow("Invalid S dimensions");
  });

  it("throws on Wmin <= 0", () => {
    expect(() =>
      calculatePadDimensions(
        { ...validDims, Wmin: 0, Wmax: 0.5 },
        "chip_rectangular",
        "nominal",
      ),
    ).toThrow("Invalid W dimensions");
  });

  it("accepts zero tolerances (Lmin === Lmax)", () => {
    const zeroCl = { ...validDims, Lmin: 2.0, Lmax: 2.0 };
    expect(() =>
      calculatePadDimensions(zeroCl, "chip_rectangular", "nominal"),
    ).not.toThrow();
  });
});
