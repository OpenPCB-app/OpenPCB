import { describe, expect, test } from "vitest";
import {
  canCloseSketch,
  initialSketchToolState,
  sketchToolReducer,
} from "./sketch-tool-state";

describe("sketch tool state", () => {
  test("board-shape behaviour is unchanged: start → commit x3 → closable", () => {
    let state = sketchToolReducer(initialSketchToolState, {
      kind: "start",
      pointMm: { x: 0, y: 0 },
    });
    expect(state).toEqual({
      kind: "drawing",
      session: { verticesMm: [{ x: 0, y: 0 }], target: "boardShape" },
    });
    expect(canCloseSketch(state)).toBe(false);

    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 5, y: 0 },
    });
    expect(canCloseSketch(state)).toBe(false);

    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 5, y: 5 },
    });
    expect(canCloseSketch(state)).toBe(true);

    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 0, y: 5 },
    });
    expect(canCloseSketch(state)).toBe(true);
  });

  test("target survives commit-vertex", () => {
    let state = sketchToolReducer(initialSketchToolState, {
      kind: "start",
      pointMm: { x: 0, y: 0 },
      target: "zone",
    });
    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 1, y: 0 },
    });
    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 1, y: 1 },
    });
    expect(state.kind).toBe("drawing");
    if (state.kind === "drawing") {
      expect(state.session.target).toBe("zone");
    }
  });

  test("target survives undo-vertex", () => {
    let state = sketchToolReducer(initialSketchToolState, {
      kind: "start",
      pointMm: { x: 0, y: 0 },
      target: "keepout",
    });
    state = sketchToolReducer(state, {
      kind: "commit-vertex",
      pointMm: { x: 1, y: 0 },
    });
    state = sketchToolReducer(state, { kind: "undo-vertex" });
    expect(state.kind).toBe("drawing");
    if (state.kind === "drawing") {
      expect(state.session.target).toBe("keepout");
      expect(state.session.verticesMm).toEqual([{ x: 0, y: 0 }]);
    }
  });

  test("undo-vertex to empty returns idle regardless of target", () => {
    const started = sketchToolReducer(initialSketchToolState, {
      kind: "start",
      pointMm: { x: 0, y: 0 },
      target: "zone",
    });
    const idle = sketchToolReducer(started, { kind: "undo-vertex" });
    expect(idle).toEqual({ kind: "idle" });
  });

  test("omitted target defaults to boardShape", () => {
    const state = sketchToolReducer(initialSketchToolState, {
      kind: "start",
      pointMm: { x: 0, y: 0 },
    });
    expect(state.kind).toBe("drawing");
    if (state.kind === "drawing") {
      expect(state.session.target).toBe("boardShape");
    }
  });
});
