import type { ReactElement } from "react";
import { Box, Camera, Layers, Maximize2, Ruler, Video } from "lucide-react";

export type CameraPreset = "iso" | "persp" | "top" | "front" | "side" | "back";

export interface DisplayToggles {
  components: boolean;
  silkscreen: boolean;
  labels: boolean;
  heatmap: boolean;
  grid: boolean;
}

export interface Board3DInfo {
  widthMm: number;
  heightMm: number;
  layerCount: number;
  thicknessMm: number;
  parts: number;
  traces: number;
  vias: number;
}

const PRESET_LABELS: { key: CameraPreset; label: string }[] = [
  { key: "iso", label: "Iso" },
  { key: "persp", label: "Persp" },
  { key: "top", label: "Top" },
  { key: "front", label: "Front" },
  { key: "side", label: "Side" },
  { key: "back", label: "Back" },
];

const BOARD_COLORS: { id: string; hex: string; label: string }[] = [
  { id: "green", hex: "#0D4D2C", label: "Matte green" },
  { id: "black", hex: "#1A1A1A", label: "Matte black" },
  { id: "blue", hex: "#10367E", label: "Blue" },
  { id: "red", hex: "#7E1416", label: "Red" },
  { id: "white", hex: "#E5E5E5", label: "White" },
  { id: "yellow", hex: "#C9A227", label: "Yellow" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="border-b border-slate-800 px-3 py-2.5">
      <div className="mb-1.5 text-[9px] font-medium uppercase tracking-wide text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  stub = false,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  stub?: boolean;
}): ReactElement {
  return (
    <label
      className="flex cursor-pointer items-center justify-between py-0.5 text-[11px] text-slate-300"
      title={stub ? "Coming soon" : undefined}
    >
      <span className={stub ? "text-slate-400" : undefined}>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3 w-3"
      />
    </label>
  );
}

/**
 * Left-rail 3D controls. Rendered (via portal) into the Designer's left
 * sidebar slot — same pattern the PCB view uses for its layer/board panels —
 * so the controls live in the real sidebar, not floating over the canvas.
 */
export function Board3DControls({
  cameraPreset,
  onPreset,
  display,
  onToggleDisplay,
  boardColor,
  onBoardColor,
  scene,
  onScene,
  transparency,
  onTransparency,
}: {
  cameraPreset: CameraPreset;
  onPreset: (preset: CameraPreset) => void;
  display: DisplayToggles;
  onToggleDisplay: (key: keyof DisplayToggles) => void;
  boardColor: string;
  onBoardColor: (id: string) => void;
  scene: string;
  onScene: (scene: string) => void;
  transparency: number;
  onTransparency: (value: number) => void;
}): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto text-slate-200">
      <Section title="Camera">
        <div className="grid grid-cols-3 gap-1">
          {PRESET_LABELS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPreset(p.key)}
              className={`rounded px-1 py-1 text-[10px] ${
                cameraPreset === p.key
                  ? "bg-accent-soft text-accent-text"
                  : "bg-slate-800/60 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Display">
        <ToggleRow
          label="Components"
          checked={display.components}
          onChange={() => onToggleDisplay("components")}
        />
        <ToggleRow
          label="Silkscreen"
          checked={display.silkscreen}
          onChange={() => onToggleDisplay("silkscreen")}
        />
        <ToggleRow
          label="Refdes labels"
          checked={display.labels}
          onChange={() => onToggleDisplay("labels")}
          stub
        />
        <ToggleRow
          label="Height heatmap"
          checked={display.heatmap}
          onChange={() => onToggleDisplay("heatmap")}
          stub
        />
        <ToggleRow
          label="Floor grid"
          checked={display.grid}
          onChange={() => onToggleDisplay("grid")}
        />
      </Section>

      <Section title="Board color">
        <div className="flex flex-wrap gap-1.5">
          {BOARD_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              onClick={() => onBoardColor(c.id)}
              className={`h-5 w-5 rounded ${boardColor === c.id ? "ring-2 ring-accent ring-offset-1 ring-offset-slate-950" : ""}`}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>
      </Section>

      <Section title="Scene">
        <select
          value={scene}
          onChange={(e) => onScene(e.target.value)}
          title="Lighting scene"
          className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-300 outline-none"
        >
          <option value="studio-dark">Studio dark</option>
          <option value="studio-light">Studio light</option>
          <option value="outdoor">Outdoor</option>
          <option value="transparent">Transparent</option>
        </select>
      </Section>

      <Section title="Transparency">
        <input
          type="range"
          min={0}
          max={100}
          value={transparency}
          onChange={(e) => onTransparency(Number(e.target.value))}
          title="Board transparency"
          className="w-full accent-violet-500"
        />
      </Section>
    </div>
  );
}

/** Canvas-area overlays: right inspector, floating toolbar, status bar. */
export function Board3DSceneOverlay({
  cameraPreset,
  scene,
  display,
  board,
  onSnapshot,
}: {
  cameraPreset: CameraPreset;
  scene: string;
  display: DisplayToggles;
  board: Board3DInfo;
  onSnapshot: () => void;
}): ReactElement {
  const enclosureX = (board.widthMm + 2).toFixed(0);
  const enclosureY = (board.heightMm + 2).toFixed(0);

  return (
    <>
      {/* Right inspector */}
      <div className="pointer-events-auto absolute right-3 top-3 w-48 overflow-hidden rounded-lg border border-slate-800 bg-slate-900/90 text-slate-200 shadow-xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            Mechanical
          </span>
          <button
            type="button"
            disabled
            title="STEP / STL export — coming soon"
            className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 opacity-70"
          >
            Export STEP
          </button>
        </div>
        <div className="space-y-1.5 px-3 py-2.5 text-[11px]">
          <Stat
            icon={<Maximize2 className="h-3 w-3" />}
            label="Board"
            value={`${board.widthMm.toFixed(1)} × ${board.heightMm.toFixed(1)} mm`}
          />
          <Stat
            icon={<Layers className="h-3 w-3" />}
            label="Stackup"
            value={`${board.layerCount} layer · ${board.thicknessMm} mm`}
          />
          <Stat
            icon={<Box className="h-3 w-3" />}
            label="Parts"
            value={`${board.parts} · ${board.traces} traces · ${board.vias} vias`}
          />
        </div>
        <div className="border-t border-slate-800 px-3 py-2.5">
          <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">
            Tallest parts
          </div>
          <div className="text-[11px] text-slate-500">
            — needs component heights
          </div>
        </div>
        <div className="border-t border-slate-800 bg-accent-soft px-3 py-2.5">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-accent-text">
            <Ruler className="h-3 w-3" /> Min enclosure
          </div>
          <div className="font-mono text-sm text-slate-100">
            {enclosureX} × {enclosureY} × — mm
          </div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            Board + 1 mm margin + tallest part + 1 mm air gap
          </div>
        </div>
      </div>

      {/* Floating toolbar */}
      <div className="pointer-events-auto absolute bottom-9 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-1.5 py-1 shadow-xl backdrop-blur">
        <button
          type="button"
          onClick={onSnapshot}
          className="flex items-center gap-1.5 rounded bg-violet-600 px-2.5 py-1 text-[11px] text-white hover:bg-violet-500"
        >
          <Camera className="h-3.5 w-3.5" /> Snapshot
        </button>
        <button
          type="button"
          disabled
          title="Measure tool — coming soon"
          className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] text-slate-400 opacity-70"
        >
          <Ruler className="h-3.5 w-3.5" /> Measure
        </button>
      </div>

      {/* Height heatmap legend (when toggled) */}
      {display.heatmap ? (
        <div className="pointer-events-none absolute bottom-9 left-3 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300 shadow-xl backdrop-blur">
          <div className="mb-1 uppercase tracking-wide text-slate-500">
            Height
          </div>
          <div className="flex items-center gap-1.5">
            <span>0</span>
            <span
              className="h-2 w-24 rounded-pill"
              style={{
                background:
                  "linear-gradient(90deg,#34D399 0%,#FBBF24 50%,#F87171 100%)",
              }}
            />
            <span>12 mm</span>
          </div>
        </div>
      ) : null}

      {/* Status bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-4 border-t border-slate-800 bg-slate-950/90 px-3 py-1 text-[10px] text-slate-400">
        <span className="flex items-center gap-1">
          <Video className="h-3 w-3" /> {cameraPreset}
        </span>
        <span>{scene.replace("-", " ")}</span>
        <span className="ml-auto">FPS —</span>
        <span>Zoom —</span>
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactElement;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <span className="text-slate-500">{icon}</span>
      <span className="w-14 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-slate-200">
        {value}
      </span>
    </div>
  );
}
