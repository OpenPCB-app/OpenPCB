import { X } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import type {
  PcbBoardSettings,
  PcbDesignRules,
  PcbNetClass,
} from "../../../../sdks";

interface PcbDesignRulesDialogProps {
  open: boolean;
  board: PcbBoardSettings;
  /** netId → display name, for the per-net assignment section. */
  netNames?: Record<string, string>;
  onClose: () => void;
  onSave: (next: {
    designRules: PcbDesignRules;
    netClasses: PcbNetClass[];
    boardThicknessMm: number;
    perNetClassAssignments: Record<string, string>;
  }) => Promise<void>;
}

const CLEARANCE_FIELDS: Array<{
  key: keyof PcbDesignRules["clearance"];
  label: string;
}> = [
  { key: "traceToTraceMm", label: "Trace ↔ trace" },
  { key: "traceToPadMm", label: "Trace ↔ pad" },
  { key: "traceToViaMm", label: "Trace ↔ via" },
  { key: "viaToViaMm", label: "Via ↔ via" },
  { key: "padToPadMm", label: "Pad ↔ pad" },
  { key: "copperToBoardEdgeMm", label: "Copper ↔ edge" },
];

const MINIMUM_FIELDS: Array<{
  key: keyof PcbDesignRules["minimums"];
  label: string;
}> = [
  { key: "traceWidthMm", label: "Trace width" },
  { key: "viaDiameterMm", label: "Via diameter" },
  { key: "viaDrillMm", label: "Via drill" },
  { key: "annularRingMm", label: "Annular ring" },
  { key: "drillSizeMm", label: "Drill size" },
  { key: "holeToHoleMm", label: "Hole ↔ hole" },
];

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={0.01}
          min={0}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-right font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
        />
        <span className="text-[10px] text-slate-400">mm</span>
      </span>
    </label>
  );
}

export function PcbDesignRulesDialog({
  open,
  board,
  netNames,
  onClose,
  onSave,
}: PcbDesignRulesDialogProps): ReactElement | null {
  const [clearance, setClearance] = useState(board.designRules.clearance);
  const [minimums, setMinimums] = useState(board.designRules.minimums);
  const [thickness, setThickness] = useState(board.boardThicknessMm ?? 1.6);
  const [netClasses, setNetClasses] = useState<PcbNetClass[]>(board.netClasses);
  const [assignments, setAssignments] = useState<Record<string, string>>(
    board.perNetClassAssignments ?? {},
  );
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever it opens against the live board.
  useEffect(() => {
    if (!open) return;
    setClearance(board.designRules.clearance);
    setMinimums(board.designRules.minimums);
    setThickness(board.boardThicknessMm ?? 1.6);
    setNetClasses(board.netClasses);
    setAssignments(board.perNetClassAssignments ?? {});
  }, [open, board]);

  if (!open) return null;

  const setNetAssignment = (netId: string, classId: string): void => {
    setAssignments((prev) => {
      const next = { ...prev };
      // Empty selection means "auto" (name heuristic) — drop the override.
      if (classId) next[netId] = classId;
      else delete next[netId];
      return next;
    });
  };

  const netEntries = Object.entries(netNames ?? {});

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await onSave({
        designRules: { clearance, minimums },
        netClasses,
        boardThicknessMm: thickness,
        perNetClassAssignments: assignments,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Design rules
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-6 gap-y-4 overflow-y-auto p-4">
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Clearances
            </h3>
            {CLEARANCE_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                value={clearance[f.key]}
                onChange={(v) => setClearance((c) => ({ ...c, [f.key]: v }))}
              />
            ))}
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Minimums
            </h3>
            {MINIMUM_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                value={minimums[f.key] ?? 0}
                onChange={(v) => setMinimums((m) => ({ ...m, [f.key]: v }))}
              />
            ))}
            <NumberField
              label="Board thickness"
              value={thickness}
              onChange={setThickness}
            />
          </section>

          <section className="col-span-2 space-y-2">
            <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Net classes
            </h3>
            <div className="space-y-1.5">
              {netClasses.map((nc, i) => (
                <div
                  key={nc.id}
                  className="flex items-center gap-3 rounded border border-slate-200 px-2 py-1.5 text-xs dark:border-slate-800"
                >
                  <span className="w-20 shrink-0 font-medium text-slate-700 dark:text-slate-200">
                    {nc.name}
                  </span>
                  <NumberField
                    label="width"
                    value={nc.traceWidthMm}
                    onChange={(v) =>
                      setNetClasses((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, traceWidthMm: v } : x,
                        ),
                      )
                    }
                  />
                  <NumberField
                    label="clearance"
                    value={nc.clearanceMm}
                    onChange={(v) =>
                      setNetClasses((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, clearanceMm: v } : x,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </section>

          {netEntries.length > 0 ? (
            <section className="col-span-2 space-y-2">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Net assignments
              </h3>
              <p className="text-[11px] text-slate-400">
                Override the auto net-class for a net. New traces &amp; vias on
                the net adopt the assigned class.
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {netEntries.map(([netId, name]) => (
                  <div
                    key={netId}
                    className="flex items-center justify-between gap-3 rounded border border-slate-200 px-2 py-1 text-xs dark:border-slate-800"
                  >
                    <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                      {name}
                    </span>
                    <select
                      value={assignments[netId] ?? ""}
                      onChange={(e) => setNetAssignment(netId, e.target.value)}
                      className="w-32 shrink-0 cursor-pointer rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
                    >
                      <option value="">Auto</option>
                      {netClasses.map((nc) => (
                        <option key={nc.id} value={nc.id}>
                          {nc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="cursor-pointer rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & re-run DRC"}
          </button>
        </footer>
      </div>
    </div>
  );
}
