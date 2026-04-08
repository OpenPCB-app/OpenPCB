import { describe, expect, expectTypeOf, it } from "vitest";
import { Units, type Mm } from "../coords";
import {
  INTERACTION_COORDINATE_CONTRACT,
  type AdapterPointMm,
  type InteractionAdapterTransform,
  type InteractionEvent,
  type DragDropEvent,
  type ScreenPointPx,
  type WorldPointNm,
} from "./types";

const pcbAdapterTransform = {
  adapterUnit: "mm",
  yAxis: "up",
  boundary: "adapter-local-only",
  toAdapterPoint(worldPointNm) {
    return {
      x: Units.nmToMm(worldPointNm.x),
      y: Units.nmToMm(worldPointNm.y),
    };
  },
  fromAdapterPoint(adapterPointMm) {
    return {
      x: Units.mmToNm(adapterPointMm.x),
      y: Units.mmToNm(adapterPointMm.y),
    };
  },
} satisfies InteractionAdapterTransform<AdapterPointMm>;

describe("interaction adapter contract", () => {
  it("locks core interaction coordinates to nm + px + Y-up", () => {
    expect(INTERACTION_COORDINATE_CONTRACT).toEqual({
      worldUnit: "nm",
      screenUnit: "px",
      yAxis: "up",
      adapterBoundary: "adapter-local-only",
    });
  });

  it("keeps interaction events in nanometers at the core boundary", () => {
    const event: InteractionEvent = {
      worldPoint: { x: Units.mmToNm(1.27), y: Units.mmToNm(2.54) },
      snappedPoint: { x: Units.mmToNm(1.27), y: Units.mmToNm(2.54) },
      screenPoint: { x: 120, y: 48 },
      modifiers: {
        shift: false,
        ctrl: false,
        meta: false,
        alt: false,
      },
      button: 0,
    };

    expect(event.worldPoint).toEqual({ x: 1_270_000, y: 2_540_000 });
    expect(event.snappedPoint.y).toBeGreaterThan(0);
    expect(event.screenPoint).toEqual({ x: 120, y: 48 });

    expectTypeOf(event.worldPoint).toEqualTypeOf<WorldPointNm>();
    expectTypeOf(event.screenPoint).toEqualTypeOf<ScreenPointPx>();
  });

  it("allows PCB millimeter translation only inside an adapter transform", () => {
    const worldPointNm = { x: Units.mmToNm(12.7), y: Units.mmToNm(-1.27) };
    const adapterPointMm = pcbAdapterTransform.toAdapterPoint(worldPointNm);

    expect(adapterPointMm).toEqual({ x: 12.7, y: -1.27 });
    expect(pcbAdapterTransform.fromAdapterPoint(adapterPointMm)).toEqual(
      worldPointNm,
    );
    expect(pcbAdapterTransform.boundary).toBe("adapter-local-only");

    expectTypeOf(adapterPointMm.x).toEqualTypeOf<Mm>();
  });

  it("also supports adapters that stay in nanometers", () => {
    const identityTransform = {
      adapterUnit: "nm",
      yAxis: "up",
      boundary: "adapter-local-only",
      toAdapterPoint(worldPointNm) {
        return worldPointNm;
      },
      fromAdapterPoint(adapterPointNm) {
        return adapterPointNm;
      },
    } satisfies InteractionAdapterTransform<WorldPointNm>;

    const pointNm = { x: 100, y: -250 };
    expect(identityTransform.toAdapterPoint(pointNm)).toEqual(pointNm);
    expect(identityTransform.fromAdapterPoint(pointNm)).toEqual(pointNm);
  });

  it("keeps drag-drop events on the same nm contract", () => {
    const event: DragDropEvent = {
      worldPoint: { x: Units.mmToNm(0.5), y: Units.mmToNm(1) },
      snappedPoint: { x: Units.mmToNm(0.5), y: Units.mmToNm(1) },
      types: ["application/json"],
      getData: () => "{}",
      dropEffect: "copy",
    };

    expect(event.worldPoint).toEqual({ x: 500_000, y: 1_000_000 });
    expectTypeOf(event.worldPoint).toEqualTypeOf<WorldPointNm>();
  });
});
