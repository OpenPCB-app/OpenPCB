import { Plus, Trash2, X } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import type {
  PcbBoardSettings,
  PcbDesignRules,
  PcbLengthMatchGroup,
  PcbNetClass,
} from "../../../../sdks";
import { DEFAULT_POUR_TO_COPPER_MM } from "../../../../shared/drc/rule-resolver";
import { useFeatureFlag } from "@/feature-flags";

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
    lengthMatchGroups: PcbLengthMatchGroup[];
  }) => Promise<void>;
}

const CLEARANCE_FIELDS: Array<{
  key: keyof PcbDesignRules["clearance"];
  label: string;
  title?: string;
}> = [
  { key: "traceToTraceMm", label: "Trace ↔ trace" },
  { key: "traceToPadMm", label: "Trace ↔ pad" },
  { key: "traceToViaMm", label: "Trace ↔ via" },
  { key: "viaToViaMm", label: "Via ↔ via" },
  { key: "padToPadMm", label: "Pad ↔ pad" },
  { key: "copperToBoardEdgeMm", label: "Copper ↔ edge" },
  {
    key: "pourToCopperMm",
    label: "Pour ↔ copper",
    title:
      "Zone-fill clearance floor against foreign copper. Absent on older boards; the fill kernel's own default is 0.5 mm.",
  },
];

const MINIMUM_FIELDS: Array<{
  key: keyof PcbDesignRules["minimums"];
  label: string;
  title?: string;
}> = [
  { key: "traceWidthMm", label: "Trace width" },
  { key: "viaDiameterMm", label: "Via diameter" },
  { key: "viaDrillMm", label: "Via drill" },
  { key: "annularRingMm", label: "Annular ring" },
  { key: "drillSizeMm", label: "Drill size" },
  { key: "holeToHoleMm", label: "Hole ↔ hole" },
  {
    key: "clearanceMm",
    label: "Clearance floor",
    title: "No rule or net class may resolve below this.",
  },
];

/**
 * Materialise the optional pour clearance so the field always shows the value
 * the fill kernel actually uses. Absent on pre-S6 boards; saving then writes
 * `DEFAULT_POUR_TO_COPPER_MM` explicitly, which is the constant the kernel has
 * always applied — the board gains a key, not a different pour.
 */
export function seedClearance(
  rules: PcbDesignRules,
): PcbDesignRules["clearance"] {
  return {
    ...rules.clearance,
    pourToCopperMm: rules.clearance.pourToCopperMm ?? DEFAULT_POUR_TO_COPPER_MM,
  };
}

/**
 * The `designRules` a save sends: the STORED rules with the two blocks this
 * dialog edits replaced, so `electrical` — and any key added later — survives
 * a round-trip through the form (rule-semantics contract §9).
 */
export function designRulesForSave(
  stored: PcbDesignRules,
  clearance: PcbDesignRules["clearance"],
  minimums: PcbDesignRules["minimums"],
): PcbDesignRules {
  return { ...stored, clearance, minimums };
}

function NumberField({
  label,
  value,
  onChange,
  title,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  title?: string;
}): ReactElement {
  return (
    <label
      className="flex items-center justify-between gap-2 text-xs text-text-secondary"
      {...(title ? { title } : {})}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number"
          step={0.01}
          min={0}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          className="w-20 rounded-control border border-border-control bg-surface-input px-1.5 py-0.5 text-right font-mono text-xs"
        />
        <span className="text-[10px] text-text-tertiary">mm</span>
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
  const [clearance, setClearance] = useState(
    seedClearance(board.designRules),
  );
  const [minimums, setMinimums] = useState(board.designRules.minimums);
  const [thickness, setThickness] = useState(board.boardThicknessMm ?? 1.6);
  const [netClasses, setNetClasses] = useState<PcbNetClass[]>(board.netClasses);
  const [assignments, setAssignments] = useState<Record<string, string>>(
    board.perNetClassAssignments ?? {},
  );
  const [lengthGroups, setLengthGroups] = useState<PcbLengthMatchGroup[]>(
    board.lengthMatchGroups ?? [],
  );
  const [saving, setSaving] = useState(false);
  const lengthTuningEnabled = useFeatureFlag("pcb.lengthTuning");

  // Re-seed the form whenever it opens against the live board.
  useEffect(() => {
    if (!open) return;
    setClearance(seedClearance(board.designRules));
    setMinimums(board.designRules.minimums);
    setThickness(board.boardThicknessMm ?? 1.6);
    setNetClasses(board.netClasses);
    setAssignments(board.perNetClassAssignments ?? {});
    setLengthGroups(board.lengthMatchGroups ?? []);
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
        designRules: designRulesForSave(
          board.designRules,
          clearance,
          minimums,
        ),
        netClasses,
        boardThicknessMm: thickness,
        perNetClassAssignments: assignments,
        lengthMatchGroups: lengthGroups.filter(
          (g) => g.name.trim().length > 0,
        ),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const patchGroup = (
    index: number,
    patch: Partial<PcbLengthMatchGroup>,
  ): void => {
    setLengthGroups((arr) =>
      arr.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    );
  };

  const toggleGroupNet = (index: number, netId: string): void => {
    setLengthGroups((arr) =>
      arr.map((g, i) =>
        i === index
          ? {
              ...g,
              netIds: g.netIds.includes(netId)
                ? g.netIds.filter((n) => n !== netId)
                : [...g.netIds, netId],
            }
          : g,
      ),
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-[560px] max-w-[92vw] flex-col overflow-hidden rounded-float border border-border bg-surface-raised shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-text-strong">
            Design rules
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-control p-1 text-text-tertiary hover:bg-surface-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-x-6 gap-y-4 overflow-y-auto p-4">
          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold text-text-strong">
              Clearances
            </h3>
            {CLEARANCE_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                {...(f.title ? { title: f.title } : {})}
                value={clearance[f.key] ?? 0}
                onChange={(v) => setClearance((c) => ({ ...c, [f.key]: v }))}
              />
            ))}
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-semibold text-text-strong">
              Minimums
            </h3>
            {MINIMUM_FIELDS.map((f) => (
              <NumberField
                key={f.key}
                label={f.label}
                {...(f.title ? { title: f.title } : {})}
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
            <h3 className="text-xs font-semibold text-text-strong">
              Net classes
            </h3>
            <div className="space-y-1.5">
              {netClasses.map((nc, i) => (
                <div
                  key={nc.id}
                  className="flex items-center gap-3 rounded-control border border-border px-2 py-1.5 text-xs"
                >
                  <span className="w-20 shrink-0 font-medium text-text-strong">
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

          {lengthTuningEnabled ? (
            <section className="col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-strong">
                  Length match groups
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setLengthGroups((arr) => [
                      ...arr,
                      {
                        id: crypto.randomUUID(),
                        name: `Group ${arr.length + 1}`,
                        netIds: [],
                        target: { kind: "longest" },
                        toleranceMm: 0.5,
                      },
                    ])
                  }
                  className="flex cursor-pointer items-center gap-1 rounded-control border border-border-control px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-surface-hover"
                >
                  <Plus className="h-3 w-3" /> Add group
                </button>
              </div>
              <p className="text-[11px] text-text-tertiary">
                Member nets must match the longest member (or an absolute
                length) within tolerance. DRC reports out-of-range nets; the
                Tune tool adds serpentine length.
              </p>
              {lengthGroups.map((group, i) => (
                <div
                  key={group.id}
                  className="space-y-1.5 rounded-control border border-border px-2 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={group.name}
                      aria-label="Group name"
                      onChange={(e) => patchGroup(i, { name: e.target.value })}
                      className="w-32 rounded-control border border-border-control bg-surface-input px-1.5 py-0.5 text-xs"
                    />
                    <select
                      value={group.target.kind}
                      aria-label="Target kind"
                      onChange={(e) =>
                        patchGroup(i, {
                          target:
                            e.target.value === "absolute"
                              ? { kind: "absolute", mm: 10 }
                              : { kind: "longest" },
                        })
                      }
                      className="cursor-pointer rounded-control border border-border-control bg-surface-input px-1.5 py-0.5 text-xs"
                    >
                      <option value="longest">Match longest</option>
                      <option value="absolute">Absolute</option>
                    </select>
                    {group.target.kind === "absolute" ? (
                      <NumberField
                        label="target"
                        value={group.target.mm}
                        onChange={(v) =>
                          patchGroup(i, { target: { kind: "absolute", mm: v } })
                        }
                      />
                    ) : null}
                    <NumberField
                      label="± tol"
                      value={group.toleranceMm}
                      onChange={(v) => patchGroup(i, { toleranceMm: v })}
                    />
                    <button
                      type="button"
                      aria-label={`Remove group ${group.name}`}
                      onClick={() =>
                        setLengthGroups((arr) =>
                          arr.filter((_, j) => j !== i),
                        )
                      }
                      className="ml-auto cursor-pointer rounded-control p-1 text-text-tertiary hover:bg-surface-hover hover:text-status-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {netEntries.length > 0 ? (
                    <div className="flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                      {netEntries.map(([netId, name]) => {
                        const member = group.netIds.includes(netId);
                        return (
                          <button
                            key={netId}
                            type="button"
                            onClick={() => toggleGroupNet(i, netId)}
                            className={
                              member
                                ? "cursor-pointer rounded-control border border-selection bg-selection-soft px-2 py-0.5 font-mono text-[11px] text-selection"
                                : "cursor-pointer rounded-control border border-border px-2 py-0.5 font-mono text-[11px] text-text-tertiary hover:border-border-control"
                            }
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-tertiary">
                      No named nets on this board yet.
                    </p>
                  )}
                </div>
              ))}
            </section>
          ) : null}

          {netEntries.length > 0 ? (
            <section className="col-span-2 space-y-2">
              <h3 className="text-xs font-semibold text-text-strong">
                Net assignments
              </h3>
              <p className="text-[11px] text-text-tertiary">
                Override the auto net-class for a net. New traces &amp; vias on
                the net adopt the assigned class.
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                {netEntries.map(([netId, name]) => (
                  <div
                    key={netId}
                    className="flex items-center justify-between gap-3 rounded-control border border-border px-2 py-1 text-xs"
                  >
                    <span className="truncate font-mono text-text-strong">
                      {name}
                    </span>
                    <select
                      value={assignments[netId] ?? ""}
                      onChange={(e) => setNetAssignment(netId, e.target.value)}
                      className="w-32 shrink-0 cursor-pointer rounded-control border border-border-control bg-surface-input px-1.5 py-0.5 text-xs"
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

        <footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-control border border-border-control px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover hover:text-text-strong"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="cursor-pointer rounded-control bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & re-run DRC"}
          </button>
        </footer>
      </div>
    </div>
  );
}
