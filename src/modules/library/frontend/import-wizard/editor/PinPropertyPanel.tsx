import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from "react";
import { Trash2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useSymbolEditorStore } from "./useSymbolEditorStore";
import type { EditorPinElement } from "./types";

const ELECTRICAL_TYPES: readonly { value: string; label: string }[] = [
  { value: "passive", label: "Passive" },
  { value: "input", label: "Input" },
  { value: "output", label: "Output" },
  { value: "bidirectional", label: "Bidirectional" },
  { value: "tri_state", label: "Tri-state" },
  { value: "open_collector", label: "Open collector" },
  { value: "open_emitter", label: "Open emitter" },
  { value: "power_in", label: "Power in" },
  { value: "power_out", label: "Power out" },
  { value: "unconnected", label: "Unconnected" },
  { value: "no_connect", label: "No connect" },
];

const ROTATIONS: readonly { value: number; label: string }[] = [
  { value: 0, label: "0° →" },
  { value: 90, label: "90° ↑" },
  { value: 180, label: "180° ←" },
  { value: 270, label: "270° ↓" },
];

/**
 * Editable property panel for drawn pins.
 * Snapshot discipline: one undo snapshot per committed field change
 * (text/number inputs: on blur, selects: on change).
 *
 * Inputs are controlled with local drafts that stay in sync with the store
 * so that undo/redo, rotate, drag, and paste updates propagate into the UI
 * even while the panel is mounted.
 */
export const PinPropertyPanel = memo(function PinPropertyPanel(): ReactElement {
  const { pins, selectedIds } = useSymbolEditorStore(
    useShallow((s) => ({ pins: s.pins, selectedIds: s.selectedIds })),
  );

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        Pins ({pins.length})
      </div>
      {pins.length === 0 ? (
        <div className="text-xs text-slate-400 dark:text-slate-500">
          Use the Pin tool (P) to place pins.
        </div>
      ) : (
        <div className="max-h-[28rem] space-y-1.5 overflow-auto">
          {pins.map((pin) => (
            <PinRow key={pin.id} pin={pin} selected={selectedIds.has(pin.id)} />
          ))}
        </div>
      )}
    </section>
  );
});

interface PinRowProps {
  pin: EditorPinElement;
  selected: boolean;
}

function PinRow({ pin, selected }: PinRowProps): ReactElement {
  // Local drafts for text / number inputs. Kept in sync with the prop so
  // external store updates (undo/redo, paste, etc.) propagate to the UI
  // without clobbering the user's in-progress typing.
  const [numberDraft, setNumberDraft] = useState(pin.number);
  const [nameDraft, setNameDraft] = useState(pin.name);
  const [lengthDraft, setLengthDraft] = useState(String(pin.lengthMm));

  useEffect(() => setNumberDraft(pin.number), [pin.number]);
  useEffect(() => setNameDraft(pin.name), [pin.name]);
  useEffect(() => setLengthDraft(String(pin.lengthMm)), [pin.lengthMm]);

  const selectOnly = useCallback(() => {
    useSymbolEditorStore.getState().setSelection(new Set([pin.id]));
  }, [pin.id]);

  const commitPatch = useCallback(
    (patch: Partial<Omit<EditorPinElement, "id">>) => {
      const store = useSymbolEditorStore.getState();
      store.pushSnapshot();
      store.updatePin(pin.id, patch);
    },
    [pin.id],
  );

  const handleRemove = useCallback(() => {
    const store = useSymbolEditorStore.getState();
    store.pushSnapshot();
    store.setSelection(new Set([pin.id]));
    store.removeSelected();
  }, [pin.id]);

  return (
    <div
      onClick={selectOnly}
      className={`space-y-1 rounded-md border px-2 py-1.5 text-[11px] transition-colors ${
        selected
          ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
          : "border-slate-200 bg-slate-50 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-slate-600"
      }`}
    >
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
              if (next !== pin.number) commitPatch({ number: next });
              else if (numberDraft !== pin.number) setNumberDraft(pin.number);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                setNumberDraft(pin.number);
                e.currentTarget.blur();
              }
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 font-mono text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <label className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Name
          </span>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.currentTarget.value)}
            onBlur={() => {
              if (nameDraft !== pin.name) commitPatch({ name: nameDraft });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                setNameDraft(pin.name);
                e.currentTarget.blur();
              }
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          title="Delete pin"
          className="inline-flex h-6 w-6 flex-none items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <label className="min-w-0 flex-1 space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Type
          </span>
          <select
            value={pin.electricalType}
            onChange={(e) =>
              commitPatch({ electricalType: e.currentTarget.value })
            }
            className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {ELECTRICAL_TYPES.some(
              (t) => t.value === pin.electricalType,
            ) ? null : (
              <option value={pin.electricalType}>{pin.electricalType}</option>
            )}
            {ELECTRICAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex-[0_0_72px] space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Rotation
          </span>
          <select
            value={pin.rotationDeg}
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
        <label className="flex-[0_0_68px] space-y-0.5">
          <span className="block text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Length
          </span>
          <input
            type="number"
            step={0.635}
            min={0}
            value={lengthDraft}
            onChange={(e) => setLengthDraft(e.currentTarget.value)}
            onBlur={() => {
              const next = Number(lengthDraft);
              if (Number.isFinite(next) && next >= 0 && next !== pin.lengthMm) {
                commitPatch({ lengthMm: next });
              } else if (
                !Number.isFinite(next) ||
                next < 0 ||
                next === pin.lengthMm
              ) {
                // Reject invalid input → revert draft to prop
                setLengthDraft(String(pin.lengthMm));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                setLengthDraft(String(pin.lengthMm));
                e.currentTarget.blur();
              }
            }}
            className="h-6 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>
      </div>
    </div>
  );
}
