import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import type { EditorPadElement, PadShape } from "./types";

const PAD_SHAPES: readonly { value: PadShape; label: string }[] = [
  { value: "rect", label: "Rect" },
  { value: "circle", label: "Circle" },
  { value: "oval", label: "Oval" },
  { value: "roundrect", label: "Rounded rect" },
];

const PAD_LAYERS: readonly { value: string; label: string }[] = [
  { value: "F.Cu", label: "F.Cu" },
  { value: "B.Cu", label: "B.Cu" },
  { value: "*.Cu", label: "*.Cu (TH)" },
];

const ROTATIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "0°" },
  { value: 90, label: "90°" },
  { value: 180, label: "180°" },
  { value: 270, label: "270°" },
];

const MIN_ANNULAR_RING_MM = 0.15;

export const PadPropertyPanel = memo(function PadPropertyPanel(): ReactElement {
  const { pads, selectedIds } = useFootprintEditorStore(
    useShallow((s) => ({ pads: s.pads, selectedIds: s.selectedIds })),
  );

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        Pads ({pads.length})
      </div>
      {pads.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          Use the Pad tool (D) to place pads.
        </div>
      ) : (
        <div className="max-h-[28rem] space-y-1.5 overflow-auto">
          {pads.map((pad) => (
            <PadRow key={pad.id} pad={pad} selected={selectedIds.has(pad.id)} />
          ))}
        </div>
      )}
    </section>
  );
});

function PadRow({
  pad,
  selected,
}: {
  pad: EditorPadElement;
  selected: boolean;
}): ReactElement {
  // Local drafts for text/number inputs
  const [numberDraft, setNumberDraft] = useState(pad.number);
  const [widthDraft, setWidthDraft] = useState(String(pad.widthMm));
  const [heightDraft, setHeightDraft] = useState(String(pad.heightMm));
  const [drillDraft, setDrillDraft] = useState(
    String(pad.drillDiameterMm ?? 0),
  );
  const [ratioDraft, setRatioDraft] = useState(
    String(pad.roundrectRatio ?? 0.25),
  );

  useEffect(() => setNumberDraft(pad.number), [pad.number]);
  useEffect(() => setWidthDraft(String(pad.widthMm)), [pad.widthMm]);
  useEffect(() => setHeightDraft(String(pad.heightMm)), [pad.heightMm]);
  useEffect(
    () => setDrillDraft(String(pad.drillDiameterMm ?? 0)),
    [pad.drillDiameterMm],
  );
  useEffect(
    () => setRatioDraft(String(pad.roundrectRatio ?? 0.25)),
    [pad.roundrectRatio],
  );

  const selectOnly = useCallback(() => {
    useFootprintEditorStore.getState().setSelection(new Set([pad.id]));
  }, [pad.id]);

  const commitPatch = useCallback(
    (patch: Partial<Omit<EditorPadElement, "id">>) => {
      const store = useFootprintEditorStore.getState();
      store.pushSnapshot();
      store.updatePad(pad.id, patch);
    },
    [pad.id],
  );

  const handleRemove = useCallback(() => {
    const store = useFootprintEditorStore.getState();
    store.pushSnapshot();
    store.setSelection(new Set([pad.id]));
    store.removeSelected();
  }, [pad.id]);

  const drill = pad.drillDiameterMm ?? 0;
  const minDim = Math.min(pad.widthMm, pad.heightMm);
  const annularRing = drill > 0 ? (minDim - drill) / 2 : null;
  const annularWarn = annularRing !== null && annularRing < MIN_ANNULAR_RING_MM;

  return (
    <div
      onClick={selectOnly}
      className={`space-y-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
        selected
          ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
          : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600"
      }`}
    >
      {/* Row 1: Number + Shape + Delete */}
      <div className="flex items-center gap-1.5">
        <label className="flex-[0_0_48px] space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            #
          </span>
          <input
            type="text"
            value={numberDraft}
            onChange={(e) => setNumberDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = numberDraft.trim();
              if (next !== pad.number) commitPatch({ number: next });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Shape
          </span>
          <select
            value={pad.shape}
            onChange={(e) => {
              const shape = e.currentTarget.value as PadShape;
              const patch: Partial<Omit<EditorPadElement, "id">> = { shape };
              if (shape === "circle") patch.heightMm = pad.widthMm;
              if (shape === "roundrect" && !pad.roundrectRatio)
                patch.roundrectRatio = 0.25;
              commitPatch(patch);
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {PAD_SHAPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          title="Delete pad"
          className="inline-flex h-6 w-6 flex-none items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Row 2: Width + Height + Rotation */}
      <div className="flex items-center gap-1.5">
        <label className="flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            W (mm)
          </span>
          <input
            type="number"
            step={0.1}
            min={0.01}
            value={widthDraft}
            onChange={(e) => setWidthDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = Number(widthDraft);
              if (Number.isFinite(next) && next > 0 && next !== pad.widthMm) {
                const patch: Partial<Omit<EditorPadElement, "id">> = {
                  widthMm: next,
                };
                if (pad.shape === "circle") patch.heightMm = next;
                commitPatch(patch);
              } else {
                setWidthDraft(String(pad.widthMm));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        {pad.shape !== "circle" && (
          <label className="flex-1 space-y-0.5">
            <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              H (mm)
            </span>
            <input
              type="number"
              step={0.1}
              min={0.01}
              value={heightDraft}
              onChange={(e) => setHeightDraft(e.currentTarget.value)}
              onBlur={() => {
                const next = Number(heightDraft);
                if (
                  Number.isFinite(next) &&
                  next > 0 &&
                  next !== pad.heightMm
                ) {
                  commitPatch({ heightMm: next });
                } else {
                  setHeightDraft(String(pad.heightMm));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        )}
        <label className="flex-[0_0_64px] space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Rot
          </span>
          <select
            value={pad.rotationDeg}
            onChange={(e) =>
              commitPatch({ rotationDeg: Number(e.currentTarget.value) })
            }
            className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {ROTATIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Row 3: Layer + Drill */}
      <div className="flex items-center gap-1.5">
        <label className="flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Layer
          </span>
          <select
            value={pad.layer}
            onChange={(e) => commitPatch({ layer: e.currentTarget.value })}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {PAD_LAYERS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Drill (mm)
          </span>
          <input
            type="number"
            step={0.05}
            min={0}
            value={drillDraft}
            onChange={(e) => setDrillDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = Number(drillDraft);
              if (!Number.isFinite(next) || next < 0) {
                setDrillDraft(String(pad.drillDiameterMm ?? 0));
                return;
              }
              const prev = pad.drillDiameterMm ?? 0;
              if (next !== prev) {
                const patch: Partial<Omit<EditorPadElement, "id">> = {
                  drillDiameterMm: next > 0 ? next : undefined,
                };
                // Auto-switch layer to *.Cu for TH pads
                if (next > 0 && pad.layer !== "*.Cu") patch.layer = "*.Cu";
                if (next === 0 && pad.layer === "*.Cu") patch.layer = "F.Cu";
                commitPatch(patch);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </div>

      {/* Conditional: Roundrect ratio */}
      {pad.shape === "roundrect" && (
        <div className="flex items-center gap-1.5">
          <label className="flex-1 space-y-0.5">
            <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Corner ratio
            </span>
            <input
              type="number"
              step={0.05}
              min={0}
              max={0.5}
              value={ratioDraft}
              onChange={(e) => setRatioDraft(e.currentTarget.value)}
              onBlur={() => {
                const next = Number(ratioDraft);
                if (
                  Number.isFinite(next) &&
                  next >= 0 &&
                  next <= 0.5 &&
                  next !== (pad.roundrectRatio ?? 0.25)
                ) {
                  commitPatch({ roundrectRatio: next });
                } else {
                  setRatioDraft(String(pad.roundrectRatio ?? 0.25));
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
        </div>
      )}

      {/* Annular ring warning */}
      {annularWarn && (
        <div className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          Annular ring {annularRing!.toFixed(2)}mm &lt; {MIN_ANNULAR_RING_MM}mm
          minimum
        </div>
      )}
    </div>
  );
}
