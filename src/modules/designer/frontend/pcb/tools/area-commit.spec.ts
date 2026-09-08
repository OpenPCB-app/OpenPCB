import { describe, expect, test } from "vitest";
import type { PcbPointMm } from "../../../../../sdks";
import {
  buildKeepoutAdd,
  buildZoneAdd,
  checkAreaRing,
  checkZoneHole,
} from "./area-commit";
import type { KeepoutToolOptions, ZoneToolOptions } from "./area-tool-options";

const SQUARE: PcbPointMm[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe("checkAreaRing", () => {
  test("passes a valid square", () => {
    expect(checkAreaRing(SQUARE)).toEqual({ ok: true });
  });

  test("maps tooFewPoints", () => {
    expect(checkAreaRing([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toEqual({
      ok: false,
      reason: "tooFewPoints",
      message: "Draw at least three vertices",
    });
  });

  test("maps selfIntersecting", () => {
    const bowtie: PcbPointMm[] = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(checkAreaRing(bowtie)).toEqual({
      ok: false,
      reason: "selfIntersecting",
      message: "Outline crosses itself",
    });
  });

  test("maps zeroArea", () => {
    const flat: PcbPointMm[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    expect(checkAreaRing(flat)).toEqual({
      ok: false,
      reason: "zeroArea",
      message: "Outline has no area",
    });
  });

  test("maps nonFinite", () => {
    const bad: PcbPointMm[] = [
      { x: 0, y: 0 },
      { x: NaN, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(checkAreaRing(bad)).toEqual({
      ok: false,
      reason: "nonFinite",
      message: "Outline has an invalid vertex",
    });
  });
});

describe("buildZoneAdd", () => {
  test("emits the documented shape", () => {
    const options: ZoneToolOptions = {
      layer: "F.Cu",
      net: { netId: null, netName: "GND" },
      padConnection: "thermal",
    };
    expect(buildZoneAdd(SQUARE, options)).toEqual({
      layer: "F.Cu",
      net: { netId: null, netName: "GND" },
      region: { kind: "polygon", pointsMm: SQUARE },
      padConnection: "thermal",
      priority: 0,
      enabled: true,
    });
  });
});

describe("buildKeepoutAdd", () => {
  test("emits the documented shape", () => {
    const options: KeepoutToolOptions = {
      layers: ["F.Cu", "B.Cu"],
      restrictions: {
        tracks: true,
        vias: false,
        pads: true,
        copperPour: true,
        footprints: false,
      },
    };
    expect(buildKeepoutAdd(SQUARE, options)).toEqual({
      layers: ["F.Cu", "B.Cu"],
      pointsMm: SQUARE,
      restrictions: options.restrictions,
      enabled: true,
    });
  });
});

/**
 * The cutout pre-check is the executor's own `zoneRegionValidity` (copper-pour
 * contract §11) with a message per reason — the tool never carries its own
 * cutout rule, so an accepted ring here is one the backend also accepts.
 */
describe("checkZoneHole", () => {
  const inner = (s: number, dx = 0): PcbPointMm[] => [
    { x: 5 - s + dx, y: 5 - s },
    { x: 5 + s + dx, y: 5 - s },
    { x: 5 + s + dx, y: 5 + s },
    { x: 5 - s + dx, y: 5 + s },
  ];

  test("accepts a cutout strictly inside the zone", () => {
    expect(checkZoneHole(SQUARE, [], inner(2))).toEqual({ ok: true });
  });

  test("accepts a second cutout disjoint from the first", () => {
    expect(checkZoneHole(SQUARE, [inner(1, -3)], inner(1, 3))).toEqual({
      ok: true,
    });
  });

  test("rejects a cutout that leaves the zone", () => {
    expect(checkZoneHole(SQUARE, [], inner(2, 8))).toMatchObject({
      ok: false,
      reason: "hole_outside_outer",
      message: "Cutout must lie inside the zone",
    });
  });

  test("rejects a cutout overlapping an existing one", () => {
    expect(checkZoneHole(SQUARE, [inner(2, -1)], inner(2, 1))).toMatchObject({
      ok: false,
      reason: "holes_overlap",
    });
  });

  test("rejects a cutout nested in an existing one", () => {
    expect(checkZoneHole(SQUARE, [inner(3)], inner(1))).toMatchObject({
      ok: false,
      reason: "holes_nested",
    });
  });

  test("rejects a self-crossing cutout", () => {
    expect(
      checkZoneHole(SQUARE, [], [
        { x: 3, y: 3 },
        { x: 7, y: 7 },
        { x: 7, y: 3 },
        { x: 3, y: 7 },
      ]),
    ).toMatchObject({ ok: false, reason: "hole_ring_invalid" });
  });
});
