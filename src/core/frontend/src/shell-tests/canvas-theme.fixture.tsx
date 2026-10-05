import { useFrame } from "@react-three/fiber";
import { EdaCanvas } from "@shared/frontend/canvas/interaction/EdaCanvas";
import { useCanvasTheme } from "@shared/frontend/canvas/theme";
import { useCanvasThemeMode } from "@shared/frontend/canvas/use-canvas-theme-mode";

type CanvasKind = "schematic" | "pcb";
interface ThemeFrame {
  mode: "light" | "dark";
  count: number;
  color: string;
  camera: { zoom: number; x: number; y: number };
}

declare global {
  interface Window {
    __h04CanvasFrames?: Partial<Record<CanvasKind, ThemeFrame>>;
  }
}

function ThemeProbe({ kind }: { kind: CanvasKind }) {
  const { mode, theme } = useCanvasTheme();
  const color =
    kind === "schematic"
      ? theme.schematic.partOutlineColor
      : theme.pcbCanvas.refdesLabel;
  useFrame(({ camera }) => {
    const frames = (window.__h04CanvasFrames ??= {});
    frames[kind] = {
      mode,
      color,
      count: (frames[kind]?.count ?? 0) + 1,
      camera: { zoom: camera.zoom, x: camera.position.x, y: camera.position.y },
    };
  });
  return (
    <mesh>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial color={color} depthTest={false} depthWrite={false} />
    </mesh>
  );
}

export function CanvasThemeFixture() {
  const mode = useCanvasThemeMode();
  return (
    <div className="flex h-[400px] w-full">
      <EdaCanvas themeMode={mode} testId="theme-schematic" readOnly>
        <ThemeProbe kind="schematic" />
      </EdaCanvas>
      <EdaCanvas themeMode={mode} testId="theme-pcb" readOnly>
        <ThemeProbe kind="pcb" />
      </EdaCanvas>
    </div>
  );
}
