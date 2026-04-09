import { describe, expect, it } from "vitest";
import type { WireEntity } from "../types";
import {
  buildOrthogonalWirePath,
  buildOrthogonalWirePathWithWaypoints,
  collectDirectlyAttachedPinIds,
  collapseRedundantWirePoints,
  deriveWireJunctions,
  getWireLength,
  rerouteWireWithMovedEndpoint,
  translateWirePoints,
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

  it("builds orthogonal paths with no waypoints", () => {
    expect(
      buildOrthogonalWirePathWithWaypoints(
        { x: 0, y: 0 },
        [],
        { x: 1_270_000, y: 2_540_000 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 2_540_000 },
    ]);
  });

  it("builds orthogonal paths with an empty waypoints array", () => {
    expect(
      buildOrthogonalWirePathWithWaypoints(
        { x: 0, y: 0 },
        [],
        { x: 0, y: 2_540_000 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 2_540_000 },
    ]);
  });

  it("builds orthogonal paths through a single waypoint", () => {
    expect(
      buildOrthogonalWirePathWithWaypoints(
        { x: 0, y: 0 },
        [{ x: 1_270_000, y: 1_270_000 }],
        { x: 2_540_000, y: 0 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
      { x: 2_540_000, y: 1_270_000 },
      { x: 2_540_000, y: 0 },
    ]);
  });

  it("builds orthogonal paths through multiple waypoints", () => {
    expect(
      buildOrthogonalWirePathWithWaypoints(
        { x: 0, y: 0 },
        [
          { x: 1_270_000, y: 1_270_000 },
          { x: 2_540_000, y: 1_270_000 },
        ],
        { x: 3_810_000, y: 0 },
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
      { x: 3_810_000, y: 1_270_000 },
      { x: 3_810_000, y: 0 },
    ]);
  });

  it("collects directly attached pin ids from wire endpoint refs", () => {
    expect(
      collectDirectlyAttachedPinIds([
        {
          id: "wire-a",
          entityType: "wire",
          position: { x: 0, y: 0 },
          rotation: 0,
          sourcePinId: "pin-b",
          targetPinId: "pin-a",
          points: [],
        } as WireEntity,
        {
          id: "wire-b",
          entityType: "wire",
          position: { x: 0, y: 0 },
          rotation: 0,
          sourcePinId: "pin-a",
          targetPinId: "pin-c",
          points: [],
        } as WireEntity,
      ]),
    ).toEqual(["pin-a", "pin-b", "pin-c"]);
  });

  it("translates internal wires rigidly during drag", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
    ];

    expect(translateWirePoints(points, { x: 100, y: -200 })).toEqual([
      { x: 100, y: -200 },
      { x: 1_270_100, y: -200 },
      { x: 1_270_100, y: 1_269_800 },
    ]);
  });

  it("preserves valid orthogonal bends when rerouting attached wires", () => {
    const wire: WireEntity = {
      id: "wire-a",
      entityType: "wire",
      position: { x: 0, y: 0 },
      rotation: 0,
      sourcePinId: "pin-source",
      targetPinId: "pin-target",
      points: [
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
        { x: 1_270_000, y: 1_270_000 },
        { x: 2_540_000, y: 1_270_000 },
      ],
    };

    expect(
      rerouteWireWithMovedEndpoint(
        wire,
        new Set(["pin-source"]),
        wire.points,
        (pinId) => (pinId === "pin-source" ? { x: 127, y: 127 } : pinId === "pin-target" ? { x: 2_540_000, y: 1_270_000 } : null),
      ),
    ).toEqual([
      { x: 127, y: 127 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
      { x: 2_540_000, y: 1_270_000 },
    ]);
  });

  it("returns original points when anchor cannot be resolved", () => {
    const wire: WireEntity = {
      id: "wire-a",
      entityType: "wire",
      position: { x: 0, y: 0 },
      rotation: 0,
      sourcePinId: "pin-source",
      targetPinId: "pin-target",
      points: [
        { x: 0, y: 0 },
        { x: 1_270_000, y: 0 },
        { x: 1_270_000, y: 1_270_000 },
      ],
    };

    expect(
      rerouteWireWithMovedEndpoint(wire, new Set(["pin-source"]), wire.points, () => null),
    ).toBe(wire.points);
  });

  it("collapses redundant collinear waypoint segments", () => {
    expect(
      buildOrthogonalWirePathWithWaypoints(
        { x: 0, y: 0 },
        [
          { x: 1_270_000, y: 0 },
          { x: 2_540_000, y: 0 },
        ],
        { x: 3_810_000, y: 0 },
      ),
    ).toEqual([{ x: 0, y: 0 }, { x: 3_810_000, y: 0 }]);
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

  it("dedupes repeated points and measures orthogonal wire length", () => {
    const points = collapseRedundantWirePoints([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
      { x: 1_270_000, y: 1_270_000 },
    ]);

    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 1_270_000, y: 0 },
      { x: 1_270_000, y: 1_270_000 },
    ]);
    expect(getWireLength(points)).toBe(2_540_000);
  });

  it("ignores isolated wire endpoints when deriving junctions", () => {
    expect(
      deriveWireJunctions([
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
            { x: 2_540_000, y: 0 },
            { x: 3_810_000, y: 0 },
          ],
        },
      ]),
    ).toEqual([]);
  });
});
