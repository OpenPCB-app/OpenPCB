import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import type { ComponentFootprintType } from "@shared/types/component-library-schema.types";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "@/editor-canvas/interaction";
import { EDAText, GridShader, PadInstances } from "@/editor-canvas/primitives";
import { parseShaderColor } from "@/editor-canvas/utils";
import { GRID_PRESETS, NM_TO_SCENE, Units, nmToSceneMm } from "@/editor-canvas/coords";
import { RENDER_ORDER } from "@/editor-canvas/layers";

interface FootprintPreviewR3FProps {
  footprint?: ComponentFootprintType;
}

interface ParsedPad {
  number: string;
  type: "smd" | "thru_hole" | "np_thru_hole" | "connect";
  shape: "circle" | "rect" | "oval" | "roundrect" | "trapezoid" | "custom";
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  layers: string[];
  drillDiameter?: number;
}

interface ParsedGraphic {
  type: "line" | "rect" | "circle" | "arc" | "polygon" | "text";
  layer: string;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
  position?: { x: number; y: number };
}

interface ParsedFootprintPreview {
  pads: ParsedPad[];
  graphics: ParsedGraphic[];
}

interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PREVIEW_HEIGHT_PX = 250;
const PREVIEW_PADDING_PX = 20;
const MIN_CONTENT_SIZE_MM = 5;
const PIN1_MARKER_RADIUS_NM = Units.mmToNm(0.2);
const PAD_NUMBER_FONT_SIZE_NM = Units.mmToNm(0.18);
const GRAPHIC_SEGMENTS = 32;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function parseRawKicadFootprint(source: string): ParsedFootprintPreview {
  const pads: ParsedPad[] = [];
  const graphics: ParsedGraphic[] = [];

  const padRegex =
    /\(pad\s+"([^"]*)"\s+(\w+)\s+(\w+)\s+\(at\s+([\d.-]+)\s+([\d.-]+)(?:\s+([\d.-]+))?\)\s+\(size\s+([\d.-]+)\s+([\d.-]+)\)/g;
  for (const match of source.matchAll(padRegex)) {
    const [, number, type, shape, x, y, rotation, width, height] = match;
    pads.push({
      number: number ?? "",
      type: (type as ParsedPad["type"]) ?? "smd",
      shape: (shape as ParsedPad["shape"]) ?? "rect",
      position: {
        x: Number.parseFloat(x ?? "0"),
        y: Number.parseFloat(y ?? "0"),
      },
      size: {
        width: Number.parseFloat(width ?? "0"),
        height: Number.parseFloat(height ?? "0"),
      },
      rotation: Number.parseFloat(rotation ?? "0"),
      layers: [],
    });
  }

  const lineRegex =
    /\(fp_line\s+\(start\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(layer\s+([\w.]+)\)/g;
  for (const match of source.matchAll(lineRegex)) {
    const [, startX, startY, endX, endY, layer] = match;
    graphics.push({
      type: "line",
      layer: layer ?? "F.SilkS",
      start: {
        x: Number.parseFloat(startX ?? "0"),
        y: Number.parseFloat(startY ?? "0"),
      },
      end: {
        x: Number.parseFloat(endX ?? "0"),
        y: Number.parseFloat(endY ?? "0"),
      },
    });
  }

  const circleRegex =
    /\(fp_circle\s+\(center\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(layer\s+([\w.]+)\)/g;
  for (const match of source.matchAll(circleRegex)) {
    const [, centerX, centerY, endX, endY, layer] = match;
    const cx = Number.parseFloat(centerX ?? "0");
    const cy = Number.parseFloat(centerY ?? "0");
    const ex = Number.parseFloat(endX ?? "0");
    const ey = Number.parseFloat(endY ?? "0");
    graphics.push({
      type: "circle",
      layer: layer ?? "F.SilkS",
      center: { x: cx, y: cy },
      radius: Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2),
    });
  }

  const arcRegex =
    /\(fp_arc\s+\(start\s+([\d.-]+)\s+([\d.-]+)\)\s+\(end\s+([\d.-]+)\s+([\d.-]+)\)\s+\(angle\s+[\d.-]+\)\s+\(layer\s+([\w.]+)\)/g;
  for (const match of source.matchAll(arcRegex)) {
    const [, startX, startY, endX, endY, layer] = match;
    graphics.push({
      type: "arc",
      layer: layer ?? "F.SilkS",
      start: {
        x: Number.parseFloat(startX ?? "0"),
        y: Number.parseFloat(startY ?? "0"),
      },
      end: {
        x: Number.parseFloat(endX ?? "0"),
        y: Number.parseFloat(endY ?? "0"),
      },
    });
  }

  return { pads, graphics };
}

function parseStructuredFootprint(
  payload: Record<string, unknown>,
): ParsedFootprintPreview {
  const pads: ParsedPad[] = [];
  if (Array.isArray(payload.pads)) {
    for (const padValue of payload.pads) {
      const pad = asRecord(padValue);
      const position = asRecord(pad?.position);
      const size = asRecord(pad?.size);
      if (!pad || !position || !size) {
        continue;
      }

      pads.push({
        number: typeof pad.number === "string" ? pad.number : "",
        type:
          pad.type === "thru_hole" ||
          pad.type === "np_thru_hole" ||
          pad.type === "connect"
            ? pad.type
            : "smd",
        shape:
          pad.shape === "circle" ||
          pad.shape === "oval" ||
          pad.shape === "roundrect" ||
          pad.shape === "trapezoid" ||
          pad.shape === "custom"
            ? pad.shape
            : "rect",
        position: {
          x: typeof position.x === "number" ? position.x : 0,
          y: typeof position.y === "number" ? position.y : 0,
        },
        size: {
          width: typeof size.width === "number" ? size.width : 0,
          height: typeof size.height === "number" ? size.height : 0,
        },
        rotation: typeof pad.rotation === "number" ? pad.rotation : 0,
        layers: Array.isArray(pad.layers)
          ? pad.layers.filter(
              (layer): layer is string => typeof layer === "string",
            )
          : [],
        drillDiameter:
          typeof pad.drillDiameter === "number" ? pad.drillDiameter : undefined,
      });
    }
  }

  const graphics: ParsedGraphic[] = [];
  if (Array.isArray(payload.graphics)) {
    for (const graphicValue of payload.graphics) {
      const graphic = asRecord(graphicValue);
      if (!graphic || typeof graphic.type !== "string") {
        continue;
      }

      const layer =
        typeof graphic.layer === "string" ? graphic.layer : "F.SilkS";

      if (graphic.type === "line") {
        const start = asRecord(graphic.start);
        const end = asRecord(graphic.end);
        if (!start || !end) {
          continue;
        }

        graphics.push({
          type: "line",
          layer,
          start: {
            x: typeof start.x === "number" ? start.x : 0,
            y: typeof start.y === "number" ? start.y : 0,
          },
          end: {
            x: typeof end.x === "number" ? end.x : 0,
            y: typeof end.y === "number" ? end.y : 0,
          },
        });
        continue;
      }

      if (graphic.type === "rect") {
        const position = asRecord(graphic.position);
        if (!position) {
          continue;
        }

        const width = typeof graphic.width === "number" ? graphic.width : 0;
        const height = typeof graphic.height === "number" ? graphic.height : 0;
        const centerX = typeof position.x === "number" ? position.x : 0;
        const centerY = typeof position.y === "number" ? position.y : 0;
        graphics.push({
          type: "rect",
          layer,
          start: { x: centerX - width / 2, y: centerY - height / 2 },
          end: { x: centerX + width / 2, y: centerY + height / 2 },
        });
        continue;
      }

      if (graphic.type === "circle") {
        const center = asRecord(graphic.center);
        if (!center) {
          continue;
        }

        graphics.push({
          type: "circle",
          layer,
          center: {
            x: typeof center.x === "number" ? center.x : 0,
            y: typeof center.y === "number" ? center.y : 0,
          },
          radius: typeof graphic.radius === "number" ? graphic.radius : 0,
        });
        continue;
      }

      if (graphic.type === "arc") {
        const start = asRecord(graphic.start ?? graphic.center);
        const end = asRecord(graphic.end);
        if (!start || !end) {
          continue;
        }

        graphics.push({
          type: "arc",
          layer,
          start: {
            x: typeof start.x === "number" ? start.x : 0,
            y: typeof start.y === "number" ? start.y : 0,
          },
          end: {
            x: typeof end.x === "number" ? end.x : 0,
            y: typeof end.y === "number" ? end.y : 0,
          },
        });
        continue;
      }

      if (graphic.type === "polygon") {
        const points: Array<{ x: number; y: number }> = [];
        if (Array.isArray(graphic.points)) {
          for (const pointValue of graphic.points) {
            const point = asRecord(pointValue);
            if (!point) {
              continue;
            }

            points.push({
              x: typeof point.x === "number" ? point.x : 0,
              y: typeof point.y === "number" ? point.y : 0,
            });
          }
        }

        if (points.length > 0) {
          graphics.push({ type: "polygon", layer, points });
        }
        continue;
      }

      if (graphic.type === "text") {
        const position = asRecord(graphic.position);
        if (!position) {
          continue;
        }

        graphics.push({
          type: "text",
          layer,
          position: {
            x: typeof position.x === "number" ? position.x : 0,
            y: typeof position.y === "number" ? position.y : 0,
          },
          text: typeof graphic.text === "string" ? graphic.text : "",
        });
      }
    }
  }

  return { pads, graphics };
}

function parseFootprintPayload(
  payload: unknown,
): ParsedFootprintPreview | null {
  if (typeof payload === "string") {
    return parseRawKicadFootprint(payload);
  }

  const record = asRecord(payload);
  if (!record) {
    return null;
  }

  if (Array.isArray(record.pads) || Array.isArray(record.graphics)) {
    return parseStructuredFootprint(record);
  }

  if (typeof record.rawSource === "string") {
    return parseRawKicadFootprint(record.rawSource);
  }

  if (typeof record.rawKicadSource === "string") {
    return parseRawKicadFootprint(record.rawKicadSource);
  }

  return null;
}

function computeFootprintBounds(
  parsed: ParsedFootprintPreview,
): SceneBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const expand = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const pad of parsed.pads) {
    const halfWidth = pad.size.width / 2;
    const halfHeight = pad.size.height / 2;
    expand(pad.position.x - halfWidth, pad.position.y - halfHeight);
    expand(pad.position.x + halfWidth, pad.position.y + halfHeight);
  }

  for (const graphic of parsed.graphics) {
    if (graphic.start) {
      expand(graphic.start.x, graphic.start.y);
    }
    if (graphic.end) {
      expand(graphic.end.x, graphic.end.y);
    }
    if (graphic.center && typeof graphic.radius === "number") {
      expand(
        graphic.center.x - graphic.radius,
        graphic.center.y - graphic.radius,
      );
      expand(
        graphic.center.x + graphic.radius,
        graphic.center.y + graphic.radius,
      );
    }
    if (graphic.points) {
      for (const point of graphic.points) {
        expand(point.x, point.y);
      }
    }
    if (graphic.position) {
      expand(graphic.position.x, graphic.position.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function clampZoom(value: number) {
  return Math.min(160, Math.max(8, value));
}

function PreviewCameraFit({ bounds }: { bounds: SceneBounds | null }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const orthographicCamera = camera;
    if (!("zoom" in orthographicCamera)) {
      return;
    }

    if (!bounds) {
      orthographicCamera.position.x = 0;
      orthographicCamera.position.y = 0;
      orthographicCamera.zoom = 24;
      orthographicCamera.updateProjectionMatrix();
      invalidate();
      return;
    }

    const contentWidth = Math.max(
      bounds.maxX - bounds.minX,
      MIN_CONTENT_SIZE_MM,
    );
    const contentHeight = Math.max(
      bounds.maxY - bounds.minY,
      MIN_CONTENT_SIZE_MM,
    );
    const usableWidth = Math.max(size.width - PREVIEW_PADDING_PX * 2, 1);
    const usableHeight = Math.max(size.height - PREVIEW_PADDING_PX * 2, 1);

    orthographicCamera.position.x = (bounds.minX + bounds.maxX) / 2;
    orthographicCamera.position.y = (bounds.minY + bounds.maxY) / 2;
    orthographicCamera.zoom = clampZoom(
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
    );
    orthographicCamera.updateProjectionMatrix();
    invalidate();
  }, [bounds, camera, invalidate, size.height, size.width]);

  return null;
}

function PreviewEmptyState({
  testId,
  message,
}: {
  testId: string;
  message: string;
}) {
  return (
    <div
      className="flex h-[250px] items-center justify-center rounded border border-border-default bg-bg-input text-sm text-text-tertiary"
      data-testid={testId}
    >
      {message}
    </div>
  );
}

function FootprintPolyline({
  points,
  color,
  closed = false,
}: {
  points: Array<{ x: number; y: number }>;
  color: string;
  closed?: boolean;
}) {
  const positions = useMemo(() => {
    const vertices = points.flatMap((point) => [
      Units.mmToNm(point.x),
      Units.mmToNm(point.y),
      0,
    ]);
    return new Float32Array(vertices);
  }, [points]);

  if (positions.length === 0) {
    return null;
  }

  const Element = closed ? "lineLoop" : "line";

  return (
    <Element renderOrder={RENDER_ORDER.FRONT_SILKSCREEN} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
    </Element>
  );
}

function FootprintCircle({
  center,
  radius,
  color,
}: {
  center: { x: number; y: number };
  radius: number;
  color: string;
}) {
  const points = useMemo(() => {
    return Array.from({ length: GRAPHIC_SEGMENTS }, (_, index) => {
      const angle = (index / GRAPHIC_SEGMENTS) * Math.PI * 2;
      return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
    });
  }, [center.x, center.y, radius]);

  return <FootprintPolyline points={points} color={color} closed />;
}

function FootprintGraphicsLayer({
  graphics,
  silkscreenColor,
  fabColor,
}: {
  graphics: ParsedGraphic[];
  silkscreenColor: string;
  fabColor: string;
}) {
  return (
    <>
      {graphics.map((graphic, index) => {
        const color = graphic.layer.includes("SilkS")
          ? silkscreenColor
          : fabColor;
        const key = `${graphic.type}-${index}`;

        if (graphic.type === "line" && graphic.start && graphic.end) {
          return (
            <FootprintPolyline
              key={key}
              points={[graphic.start, graphic.end]}
              color={color}
            />
          );
        }

        if (graphic.type === "rect" && graphic.start && graphic.end) {
          return (
            <FootprintPolyline
              key={key}
              color={color}
              closed
              points={[
                graphic.start,
                { x: graphic.end.x, y: graphic.start.y },
                graphic.end,
                { x: graphic.start.x, y: graphic.end.y },
              ]}
            />
          );
        }

        if (
          graphic.type === "circle" &&
          graphic.center &&
          typeof graphic.radius === "number"
        ) {
          return (
            <FootprintCircle
              key={key}
              center={graphic.center}
              radius={graphic.radius}
              color={color}
            />
          );
        }

        if (
          graphic.type === "polygon" &&
          graphic.points &&
          graphic.points.length > 1
        ) {
          return (
            <FootprintPolyline
              key={key}
              points={graphic.points}
              color={color}
              closed
            />
          );
        }

        if (graphic.type === "arc" && graphic.start && graphic.end) {
          return (
            <FootprintPolyline
              key={key}
              points={[graphic.start, graphic.end]}
              color={color}
            />
          );
        }

        if (graphic.type === "text" && graphic.position && graphic.text) {
          return (
            <EDAText
              key={key}
              position={[
                Units.mmToNm(graphic.position.x),
                Units.mmToNm(graphic.position.y),
                0,
              ]}
              color={color}
              fontSize={PAD_NUMBER_FONT_SIZE_NM}
              anchorX="center"
              anchorY="middle"
              renderOrder={RENDER_ORDER.LABELS}
            >
              {graphic.text}
            </EDAText>
          );
        }

        return null;
      })}
    </>
  );
}

export function FootprintPreviewR3F({ footprint }: FootprintPreviewR3FProps) {
  const colors = useCanvasColors();

  const parsed = useMemo(
    () => parseFootprintPayload(footprint?.kicadPayload),
    [footprint?.kicadPayload],
  );
  const parsedData = parsed;
  const hasGeometry =
    parsedData !== null &&
    (parsedData.pads.length > 0 || parsedData.graphics.length > 0);
  const bounds = useMemo(
    () => (parsed ? computeFootprintBounds(parsed) : null),
    [parsed],
  );
  const padData = useMemo(() => {
    if (!parsed) {
      return [];
    }

    return parsed.pads.map((pad) => ({
      id: pad.number || crypto.randomUUID(),
      x: Units.mmToNm(pad.position.x),
      y: Units.mmToNm(pad.position.y),
      width: Units.mmToNm(pad.size.width),
      height: Units.mmToNm(pad.size.height),
      rotation: pad.rotation,
      shape: (pad.shape === "circle" ||
      pad.shape === "oval" ||
      pad.shape === "roundrect"
        ? pad.shape
        : "rect") as "circle" | "rect" | "oval" | "roundrect",
      selected: false as const,
    }));
  }, [parsed]);
  const pin1Pad = parsed?.pads.find((pad) => pad.number === "1") ?? null;

  if (!footprint || !parsedData || !hasGeometry) {
    return (
      <PreviewEmptyState
        testId="footprint-preview"
        message="No footprint data available"
      />
    );
  }

  return (
    <EdaCanvas
      testId="footprint-preview"
      readOnly
      backgroundColor={colors.background}
      className="rounded border border-border-default bg-bg-input"
      style={{ height: `${PREVIEW_HEIGHT_PX}px` }}
      initialZoom={24}
    >
      <PreviewCameraFit bounds={bounds} />
      <GridShader
        gridSize={nmToSceneMm(GRID_PRESETS.FINE)}
        visible
        color={parseShaderColor(colors.gridDot)}
        alpha={0.15}
      />

      <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
        <FootprintGraphicsLayer
          graphics={parsedData.graphics}
          silkscreenColor={colors.silkscreen}
          fabColor={colors.fabOutline}
        />

        <PadInstances pads={padData} defaultColor={colors.padSelectedFill} />

        {parsedData.pads.map((pad) => (
          <EDAText
            key={`${pad.number}-${pad.position.x}-${pad.position.y}`}
            position={[
              Units.mmToNm(pad.position.x),
              Units.mmToNm(pad.position.y),
              0,
            ]}
            color={colors.padNumberLight}
            fontSize={PAD_NUMBER_FONT_SIZE_NM}
            anchorX="center"
            anchorY="middle"
            renderOrder={RENDER_ORDER.LABELS}
          >
            {pad.number}
          </EDAText>
        ))}

        {pin1Pad && (
          <mesh
            position={[
              Units.mmToNm(pin1Pad.position.x),
              Units.mmToNm(pin1Pad.position.y),
              0,
            ]}
            renderOrder={RENDER_ORDER.PREVIEW}
            frustumCulled={false}
          >
            <circleGeometry args={[PIN1_MARKER_RADIUS_NM, 16]} />
            <meshBasicMaterial
              color={colors.pin1Marker}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        )}
      </group>
    </EdaCanvas>
  );
}
