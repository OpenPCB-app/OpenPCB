import { useState, type ReactElement } from "react";
import { Circle, Square, X } from "lucide-react";
import type {
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbOverlayText,
} from "../../../../sdks";

type PcbOverlayLayer =
  | "F.SilkS"
  | "B.SilkS"
  | "F.Fab"
  | "B.Fab"
  | "F.CrtYd"
  | "B.CrtYd"
  | "Edge.Cuts";

export type PcbInspectorSelection =
  | { kind: "freeHole"; hole: PcbFreeHole }
  | { kind: "freePad"; pad: PcbFreePad }
  | { kind: "overlayText"; text: PcbOverlayText }
  | null;

interface PcbSelectionInspectorProps {
  selection: PcbInspectorSelection;
  onClose(): void;
  onUpdateFreeHole(id: string, patch: { drillMm?: number }): Promise<void>;
  onDeleteFreeHole(id: string): Promise<void>;
  onUpdateFreePad(
    id: string,
    patch: {
      widthMm?: number;
      heightMm?: number;
      shape?: "rect" | "circle" | "oval" | "roundrect";
      layer?: PcbCopperLayerId;
      drillMm?: number | null;
      rotationDeg?: number;
    },
  ): Promise<void>;
  onDeleteFreePad(id: string): Promise<void>;
  onUpdateOverlayText(
    id: string,
    patch: {
      text?: string;
      fontSizeMm?: number;
      layer?: PcbOverlayLayer;
      rotationDeg?: number;
    },
  ): Promise<void>;
  onDeleteOverlayText(id: string): Promise<void>;
}

function NumericField({
  label,
  value,
  unit,
  onCommit,
  min,
  step,
}: {
  label: string;
  value: number;
  unit?: string;
  onCommit(v: number): void;
  min?: number;
  step?: number;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  const displayValue = draft ?? String(value);

  const commit = () => {
    const n = Number(draft ?? value);
    setDraft(null);
    if (Number.isFinite(n) && (min === undefined || n >= min) && n > 0) {
      onCommit(n);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={displayValue}
          min={min}
          step={step ?? 0.1}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setDraft(null);
            }
          }}
          className="w-20 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-right text-xs text-slate-100 outline-none focus:border-violet-500"
        />
        {unit ? (
          <span className="text-[11px] text-slate-500">{unit}</span>
        ) : null}
      </div>
    </div>
  );
}

function FreeHolePanel({
  hole,
  onUpdate,
  onDelete,
}: {
  hole: PcbFreeHole;
  onUpdate: (patch: { drillMm?: number }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <NumericField
        label="Drill diameter"
        value={hole.drillMm}
        unit="mm"
        min={0.1}
        step={0.1}
        onCommit={(v) => void onUpdate({ drillMm: v })}
      />
      <NumericField
        label="X position"
        value={hole.centerMm.x}
        unit="mm"
        step={0.1}
        onCommit={() => {}}
      />
      <NumericField
        label="Y position"
        value={hole.centerMm.y}
        unit="mm"
        step={0.1}
        onCommit={() => {}}
      />
      <div className="border-t border-slate-700 pt-2">
        <button
          type="button"
          onClick={() => void onDelete()}
          className="w-full rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
        >
          Delete hole
        </button>
      </div>
    </div>
  );
}

const PAD_SHAPES = ["rect", "circle", "oval", "roundrect"] as const;
const COPPER_LAYERS: PcbCopperLayerId[] = ["F.Cu", "B.Cu", "In1.Cu", "In2.Cu"];

function FreePadPanel({
  pad,
  onUpdate,
  onDelete,
}: {
  pad: PcbFreePad;
  onUpdate: (patch: {
    widthMm?: number;
    heightMm?: number;
    shape?: "rect" | "circle" | "oval" | "roundrect";
    layer?: PcbCopperLayerId;
    drillMm?: number | null;
    rotationDeg?: number;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          Shape
        </span>
        <select
          value={pad.shape}
          onChange={(e) =>
            void onUpdate({
              shape: e.target.value as "rect" | "circle" | "oval" | "roundrect",
            })
          }
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-violet-500"
        >
          {PAD_SHAPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <NumericField
        label="Width"
        value={pad.widthMm}
        unit="mm"
        min={0.05}
        step={0.1}
        onCommit={(v) => void onUpdate({ widthMm: v })}
      />
      <NumericField
        label="Height"
        value={pad.heightMm}
        unit="mm"
        min={0.05}
        step={0.1}
        onCommit={(v) => void onUpdate({ heightMm: v })}
      />
      <NumericField
        label="Rotation"
        value={pad.rotationDeg}
        unit="°"
        step={45}
        onCommit={(v) => void onUpdate({ rotationDeg: v })}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          Layer
        </span>
        <select
          value={pad.layer}
          onChange={(e) =>
            void onUpdate({ layer: e.target.value as PcbCopperLayerId })
          }
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-violet-500"
        >
          {COPPER_LAYERS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {(pad.padType === "hole" || pad.padType === "std") && (
        <NumericField
          label="Drill"
          value={pad.drillMm ?? 0.8}
          unit="mm"
          min={0.1}
          step={0.1}
          onCommit={(v) => void onUpdate({ drillMm: v })}
        />
      )}
      <div className="border-t border-slate-700 pt-2">
        <button
          type="button"
          onClick={() => void onDelete()}
          className="w-full rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
        >
          Delete pad
        </button>
      </div>
    </div>
  );
}

const OVERLAY_TEXT_LAYERS: Array<{ value: PcbOverlayLayer; label: string }> = [
  { value: "F.SilkS", label: "Top Overlay (F.SilkS)" },
  { value: "B.SilkS", label: "Bottom Overlay (B.SilkS)" },
];

function OverlayTextPanel({
  text,
  onUpdate,
  onDelete,
}: {
  text: PcbOverlayText;
  onUpdate: (patch: {
    text?: string;
    fontSizeMm?: number;
    layer?: PcbOverlayLayer;
    rotationDeg?: number;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          Text
        </span>
        <input
          type="text"
          value={textDraft ?? text.text}
          onChange={(e) => setTextDraft(e.target.value)}
          onBlur={() => {
            const val = textDraft?.trim();
            setTextDraft(null);
            if (val !== undefined && val.length > 0 && val !== text.text) {
              void onUpdate({ text: val });
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") setTextDraft(null);
          }}
          className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-violet-500"
        />
      </div>
      <NumericField
        label="Font size"
        value={text.fontSizeMm}
        unit="mm"
        min={0.2}
        step={0.2}
        onCommit={(v) => void onUpdate({ fontSizeMm: v })}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          Layer
        </span>
        <select
          value={text.layer}
          onChange={(e) =>
            void onUpdate({ layer: e.target.value as PcbOverlayLayer })
          }
          className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100 outline-none focus:border-violet-500"
        >
          {OVERLAY_TEXT_LAYERS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <NumericField
        label="Rotation"
        value={text.rotationDeg}
        unit="°"
        step={45}
        onCommit={(v) => void onUpdate({ rotationDeg: v })}
      />
      <div className="border-t border-slate-700 pt-2">
        <button
          type="button"
          onClick={() => void onDelete()}
          className="w-full rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
        >
          Delete text
        </button>
      </div>
    </div>
  );
}

export function PcbSelectionInspector({
  selection,
  onClose,
  onUpdateFreeHole,
  onDeleteFreeHole,
  onUpdateFreePad,
  onDeleteFreePad,
  onUpdateOverlayText,
  onDeleteOverlayText,
}: PcbSelectionInspectorProps): ReactElement | null {
  if (!selection) return null;

  let icon: ReactElement;
  let title: string;
  let subtitle: string;
  let body: ReactElement;

  switch (selection.kind) {
    case "freeHole":
      icon = <Circle className="h-3.5 w-3.5 text-violet-400" />;
      title = "Hole";
      subtitle = `Ø ${selection.hole.drillMm} mm`;
      body = (
        <FreeHolePanel
          hole={selection.hole}
          onUpdate={(patch) => onUpdateFreeHole(selection.hole.id, patch)}
          onDelete={() => onDeleteFreeHole(selection.hole.id)}
        />
      );
      break;
    case "freePad":
      icon = <Square className="h-3.5 w-3.5 text-violet-400" />;
      title = "Pad";
      subtitle = `${selection.pad.widthMm}×${selection.pad.heightMm} mm`;
      body = (
        <FreePadPanel
          pad={selection.pad}
          onUpdate={(patch) => onUpdateFreePad(selection.pad.id, patch)}
          onDelete={() => onDeleteFreePad(selection.pad.id)}
        />
      );
      break;
    case "overlayText":
      icon = <span className="text-[11px] font-bold text-violet-400">T</span>;
      title = selection.text.text;
      subtitle =
        selection.text.layer === "F.SilkS"
          ? "Top Overlay"
          : selection.text.layer === "B.SilkS"
            ? "Bottom Overlay"
            : selection.text.layer;
      body = (
        <OverlayTextPanel
          text={selection.text}
          onUpdate={(patch) => onUpdateOverlayText(selection.text.id, patch)}
          onDelete={() => onDeleteOverlayText(selection.text.id)}
        />
      );
      break;
  }

  return (
    <div
      className="pointer-events-auto absolute right-4 top-4 z-40 flex w-72 max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 text-xs text-slate-100 shadow-xl backdrop-blur"
      data-testid="pcb-selection-inspector"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 px-3 py-2">
        {icon}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-tight">
          {title}
        </span>
        <span className="shrink-0 truncate text-[11px] text-slate-400">
          {subtitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-1 shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
    </div>
  );
}
