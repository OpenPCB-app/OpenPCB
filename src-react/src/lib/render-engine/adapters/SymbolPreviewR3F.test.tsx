import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const parseKicadSymbolImportMock = vi.fn();
const convertParsedKicadSymbolToDraftMock = vi.fn();
const convertBodyGraphicMock = vi.fn();

const mockState = vi.hoisted(() => ({
  camera: {
    position: { x: 0, y: 0 },
    zoom: 1,
    updateProjectionMatrix: vi.fn(),
  },
  invalidate: vi.fn(),
  edaCanvasProps: null as Record<string, unknown> | null,
  symbolBodyProps: [] as Array<Record<string, unknown>>,
  pinDotsProps: [] as Array<Record<string, unknown>>,
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

vi.mock("@/lib/api/component-api", () => ({
  parseKicadSymbolImport: (...args: unknown[]) =>
    parseKicadSymbolImportMock(...args),
}));

vi.mock("@/components/symbol-editor/kicad-import", () => ({
  convertParsedKicadSymbolToDraft: (...args: unknown[]) =>
    convertParsedKicadSymbolToDraftMock(...args),
  convertBodyGraphic: (...args: unknown[]) => convertBodyGraphicMock(...args),
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#0f172a",
    gridDot: "#334155",
    bodyStroke: "#e2e8f0",
    bodyFill: "#0b1120",
    pinLine: "#f8fafc",
    pinDot: "#94a3b8",
    pinLabel: "#cbd5e1",
    pinNumber: "#f59e0b",
    refLabel: "#fde68a",
  }),
}));

vi.mock("../interaction/EdaCanvas", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "symbol-preview")}>
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("../primitives/GridShader", () => ({
  GridShader: () => <div data-testid="grid-shader" />,
}));

vi.mock("../primitives/SymbolBody", () => ({
  SymbolBody: (props: Record<string, unknown>) => {
    mockState.symbolBodyProps.push(props);
    return <div data-testid="symbol-body" />;
  },
}));

vi.mock("../primitives/PinDots", () => ({
  PinDots: (props: Record<string, unknown>) => {
    mockState.pinDotsProps.push(props);
    return <div data-testid="pin-dots" />;
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

import { SymbolPreviewR3F } from "./SymbolPreviewR3F";

describe("SymbolPreviewR3F", () => {
  beforeEach(() => {
    parseKicadSymbolImportMock.mockReset();
    convertParsedKicadSymbolToDraftMock.mockReset();
    convertBodyGraphicMock.mockReset();
    mockState.edaCanvasProps = null;
    mockState.symbolBodyProps = [];
    mockState.pinDotsProps = [];
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

  it("renders an empty state when symbol data is missing", () => {
    render(<SymbolPreviewR3F />);

    expect(screen.getByTestId("symbol-preview")).toHaveTextContent(
      "No symbol data available",
    );
  });

  it("builds a fallback layout from pinDefinitions and renders body graphics", () => {
    render(
      <SymbolPreviewR3F
        symbolData={
          {
            referencePrefix: "U",
            properties: {},
            pinDefinitions: [
              { id: "pin-1", name: "IN", electricalType: "input" },
              { id: "pin-2", name: "OUT", electricalType: "output" },
            ],
            bodyGraphics: [
              {
                type: "rect",
                x: -2_000_000,
                y: -1_000_000,
                width: 4_000_000,
                height: 2_000_000,
                filled: false,
                strokeWidth: 254_000,
              },
            ],
          } as never
        }
      />,
    );

    expect(mockState.symbolBodyProps.at(-1)?.graphics).toEqual([
      expect.objectContaining({ type: "rect", width: 4_000_000 }),
    ]);
    expect(mockState.pinDotsProps.at(-1)?.pins).toEqual([
      expect.objectContaining({ id: "fallback-pin-0" }),
      expect.objectContaining({ id: "fallback-pin-1" }),
    ]);
  });

  it("parses KiCad raw source and positions pin name/number labels", async () => {
    parseKicadSymbolImportMock.mockResolvedValue({ symbol: { id: "parsed" } });
    convertParsedKicadSymbolToDraftMock.mockReturnValue({
      pins: [
        {
          id: "pin-left",
          name: "A",
          number: "1",
          side: "left",
          length: 2_540_000,
          position: { x: 10_000_000, y: 2_000_000 },
        },
      ],
      graphics: [
        {
          id: "line-1",
          type: "line",
          x1: 0,
          y1: 0,
          x2: 20_000_000,
          y2: 0,
          zIndex: 0,
          strokeWidth: 254_000,
        },
      ],
    });

    render(
      <SymbolPreviewR3F
        symbolData={
          {
            rawKicadSource: "(symbol parsed-device)",
            pinDefinitions: [],
            referencePrefix: "U",
            properties: {},
          } as never
        }
      />,
    );

    await waitFor(() => {
      expect(parseKicadSymbolImportMock).toHaveBeenCalledWith(
        "(symbol parsed-device)",
      );
    });

    expect(mockState.symbolBodyProps.at(-1)?.graphics).toHaveLength(1);
    expect(mockState.pinDotsProps.at(-1)?.pins).toEqual([
      { id: "pin-left", x: 10_000_000, y: 2_000_000, connected: false },
    ]);

    const nameText = mockState.edaTextProps.find(
      (entry) => entry.children === "A",
    );
    const numberText = mockState.edaTextProps.find(
      (entry) => entry.children === "1",
    );
    expect(nameText).toMatchObject({
      anchorX: "left",
      position: [12_940_000, 2_000_000, 0],
    });
    expect(numberText).toMatchObject({
      anchorX: "right",
      position: [9_300_000, 2_000_000, 0],
    });
  });

  it("supports raw KiCad body graphic conversion in fallback mode", () => {
    convertBodyGraphicMock.mockReturnValue({
      id: "converted-graphic",
      zIndex: 0,
      type: "line",
      x1: -1_000_000,
      y1: 0,
      x2: 1_000_000,
      y2: 0,
      strokeWidth: 254_000,
    });

    render(
      <SymbolPreviewR3F
        symbolData={
          {
            referencePrefix: "U",
            properties: {},
            pinDefinitions: [],
            bodyGraphics: [{ unit: 0, node: ["polyline"] }],
          } as never
        }
      />,
    );

    expect(convertBodyGraphicMock).toHaveBeenCalled();
    expect(mockState.symbolBodyProps.at(-1)?.graphics).toEqual([
      expect.objectContaining({ id: "converted-graphic", type: "line" }),
    ]);
  });

  it("detects power symbols and places the preview label at the bottom", () => {
    render(
      <SymbolPreviewR3F
        symbolData={
          {
            referencePrefix: "#PWR",
            properties: { value: "GND" },
            pinDefinitions: [
              { id: "pin-1", name: "VCC", electricalType: "power_in" },
            ],
          } as never
        }
      />,
    );

    expect(screen.getByText("GND").className).toContain("bottom-3");
    expect(screen.queryByText("VCC")).not.toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("auto-fits the camera to preview content", async () => {
    parseKicadSymbolImportMock.mockResolvedValue({ symbol: { id: "parsed" } });
    convertParsedKicadSymbolToDraftMock.mockReturnValue({
      pins: [
        {
          id: "pin-right",
          name: "B",
          number: "2",
          side: "right",
          length: 2_540_000,
          position: { x: 30_000_000, y: 8_000_000 },
        },
      ],
      graphics: [
        {
          id: "rect-1",
          type: "rect",
          x: 20_000_000,
          y: 4_000_000,
          width: 10_000_000,
          height: 8_000_000,
          filled: false,
          zIndex: 0,
          strokeWidth: 254_000,
        },
      ],
    });

    render(
      <SymbolPreviewR3F
        symbolData={
          {
            rawKicadSource: "(symbol fit-me)",
            pinDefinitions: [],
            referencePrefix: "U",
            properties: {},
          } as never
        }
      />,
    );

    await waitFor(() => {
      expect(mockState.camera.updateProjectionMatrix).toHaveBeenCalled();
    });

    expect(mockState.camera.updateProjectionMatrix).toHaveBeenCalled();
    expect(mockState.invalidate).toHaveBeenCalled();
  });
});
