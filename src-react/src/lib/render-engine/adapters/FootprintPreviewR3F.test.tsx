import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  camera: {
    position: { x: 0, y: 0 },
    zoom: 1,
    updateProjectionMatrix: vi.fn(),
  },
  invalidate: vi.fn(),
  edaCanvasProps: null as Record<string, unknown> | null,
  padInstancesProps: [] as Array<Record<string, unknown>>,
  edaTextProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      camera: mockState.camera,
      size: { width: 640, height: 250 },
      invalidate: mockState.invalidate,
    }),
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#0f172a",
    gridDot: "#334155",
    padFill: "#f59e0b",
    padSelectedFill: "#38bdf8",
    padNumberLight: "#e2e8f0",
    silkscreen: "#cbd5e1",
    fabOutline: "#64748b",
    pin1Marker: "#f43f5e",
  }),
}));

vi.mock("../interaction/EdaCanvas", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "footprint-preview")}>
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("../primitives/GridShader", () => ({
  GridShader: () => <div data-testid="grid-shader" />,
}));

vi.mock("../primitives/PadInstances", () => ({
  PadInstances: (props: Record<string, unknown>) => {
    mockState.padInstancesProps.push(props);
    return <div data-testid="pad-instances" />;
  },
}));

vi.mock("../primitives/EDAText", () => ({
  EDAText: (props: Record<string, unknown>) => {
    mockState.edaTextProps.push(props);
    return (
      <div data-testid="eda-text">{props.children as React.ReactNode}</div>
    );
  },
}));

import { FootprintPreviewR3F } from "./FootprintPreviewR3F";

describe("FootprintPreviewR3F", () => {
  beforeEach(() => {
    mockState.edaCanvasProps = null;
    mockState.padInstancesProps = [];
    mockState.edaTextProps = [];
    mockState.camera.position.x = 0;
    mockState.camera.position.y = 0;
    mockState.camera.zoom = 1;
    mockState.camera.updateProjectionMatrix.mockReset();
    mockState.invalidate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an empty state when footprint data is missing", () => {
    render(<FootprintPreviewR3F />);

    expect(screen.getByTestId("footprint-preview")).toHaveTextContent(
      "No footprint data available",
    );
  });

  it("parses structured payloads, renders pad labels, graphics layers, and a pin-1 marker", () => {
    render(
      <FootprintPreviewR3F
        footprint={
          {
            kicadPayload: {
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: -1.5, y: 0 },
                  size: { width: 0.8, height: 1.2 },
                  rotation: 90,
                  layers: ["F.Cu"],
                },
                {
                  number: "2",
                  type: "smd",
                  shape: "circle",
                  position: { x: 1.5, y: 0 },
                  size: { width: 0.8, height: 0.8 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
              graphics: [
                {
                  type: "line",
                  layer: "F.SilkS",
                  start: { x: -2, y: -1 },
                  end: { x: 2, y: -1 },
                },
                {
                  type: "rect",
                  layer: "F.Fab",
                  position: { x: 0, y: 0 },
                  width: 5,
                  height: 3,
                },
                {
                  type: "circle",
                  layer: "F.SilkS",
                  center: { x: 0, y: 0 },
                  radius: 0.5,
                },
                {
                  type: "arc",
                  layer: "F.SilkS",
                  start: { x: -1, y: 1 },
                  end: { x: 1, y: 1 },
                },
                {
                  type: "polygon",
                  layer: "F.SilkS",
                  points: [
                    { x: -1, y: -1 },
                    { x: 0, y: -2 },
                    { x: 1, y: -1 },
                  ],
                },
                {
                  type: "text",
                  layer: "F.Fab",
                  position: { x: 0, y: 2 },
                  text: "REF**",
                },
              ],
            },
          } as never
        }
      />,
    );

    expect(mockState.edaCanvasProps).toMatchObject({
      testId: "footprint-preview",
      readOnly: true,
      initialZoom: 24,
    });
    expect(mockState.padInstancesProps.at(-1)?.pads).toEqual([
      expect.objectContaining({ id: "1", shape: "rect", rotation: 90 }),
      expect.objectContaining({ id: "2", shape: "circle", rotation: 0 }),
    ]);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("REF**")).toBeInTheDocument();

    const preview = screen.getByTestId("footprint-preview");
    expect(preview.querySelector("mesh")).not.toBeNull();
    expect(preview.querySelectorAll("line, lineloop").length).toBeGreaterThan(
      0,
    );
  });

  it("falls back to raw KiCad source parsing and normalizes unsupported pad shapes", () => {
    render(
      <FootprintPreviewR3F
        footprint={
          {
            kicadPayload: {
              rawSource:
                '(footprint test (pad "1" smd oval (at 0 0) (size 0.6 0.8)) (pad "2" smd roundrect (at 1 0) (size 0.6 0.8)) (pad "3" smd trapezoid (at 2 0) (size 0.6 0.8)))',
            },
          } as never
        }
      />,
    );

    expect(mockState.padInstancesProps.at(-1)?.pads).toEqual([
      expect.objectContaining({ id: "1", shape: "oval" }),
      expect.objectContaining({ id: "2", shape: "roundrect" }),
      expect.objectContaining({ id: "3", shape: "rect" }),
    ]);
  });

  it("renders an empty state when payload has no usable geometry", () => {
    render(
      <FootprintPreviewR3F
        footprint={
          { kicadPayload: { rawSource: "(footprint empty)" } } as never
        }
      />,
    );

    expect(screen.getByTestId("footprint-preview")).toHaveTextContent(
      "No footprint data available",
    );
  });

  it("auto-fits the camera to the parsed footprint bounds", async () => {
    render(
      <FootprintPreviewR3F
        footprint={
          {
            kicadPayload: {
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: 10, y: 5 },
                  size: { width: 1, height: 1 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
                {
                  number: "2",
                  type: "smd",
                  shape: "rect",
                  position: { x: 20, y: 10 },
                  size: { width: 1, height: 1 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
              graphics: [
                {
                  type: "line",
                  layer: "F.SilkS",
                  start: { x: 8, y: 4 },
                  end: { x: 22, y: 11 },
                },
              ],
            },
          } as never
        }
      />,
    );

    await waitFor(() => {
      expect(mockState.camera.updateProjectionMatrix).toHaveBeenCalled();
    });

    expect(mockState.camera.position.x).not.toBe(0);
    expect(mockState.camera.position.y).not.toBe(0);
    expect(mockState.camera.zoom).toBeGreaterThan(1);
    expect(mockState.invalidate).toHaveBeenCalled();
  });
});
