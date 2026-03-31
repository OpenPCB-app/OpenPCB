import { describe, expect, it } from "vitest";
import type { WireEntity } from "../types";
import {
  buildOrthogonalWirePath,
  collapseRedundantWirePoints,
  deriveWireJunctions,
} from "./wires";

describe("wire routing helpers", () => {
  it("builds deterministic horizontal-first orthogonal paths", () => {
    expect(
      buildOrthogonalWirePath(
        { x: 0, y: 0 },
        { x: 1_270_000, y: 2_540_000 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 2_540_000 },
    ]);
  });

  it("collapses redundant points for aligned routes", () => {
    expect(
      buildOrthogonalWirePath(
        { x: 0, y: 0 },
        { x: 0, y: 2_540_000 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 2_540_000 },
    ]);

    expect(
      collapseRedundantWirePoints([
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
        { x: 2_540_000, y: 0 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 2_540_000, y: 0 },
    ]);
  });

  it("derives deterministic junction metadata from shared wire endpoints", () => {
    const wires: Array<Pick<WireEntity, "id" | "points">> = [
      {
        id: "wire-a",
        points: [
          { x: 0, y: 0 },
          { x: 1_270_000, y: 0 },
        ],
      },
      {
        id: "wire-b",
        points: [
          { x: 1_270_000, y: 0 },
          { x: 1_270_000, y: 1_270_000 },
        ],
      },
    ];

    expect(deriveWireJunctions(wires)).toEqual([
      {
        id: "junction:1270000:0",
        position: { x: 1_270_000, y: 0 },
        degree: 2,
        wireIds: ["wire-a", "wire-b"],
      },
    ]);
  });
});
