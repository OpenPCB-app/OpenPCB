import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import type { DesignerPlacedPart } from "../../../../sdks";
import type {
  DesignerWorkspaceActions,
  DesignerWorkspaceState,
} from "../hooks/useDesignerWorkspace";
import type { DesignerView } from "../types";

export const COMPONENT_DND_MIME = "application/x-openpcb-component-id";

interface DesignerSidebarProps {
  state: DesignerWorkspaceState;
  actions: DesignerWorkspaceActions;
  activeView: DesignerView;
}

function inferValueKind(part: DesignerPlacedPart): "resistor" | "capacitor" | "generic" {
  const text = `${part.reference} ${part.symbol.name} ${part.footprint.name}`.toLowerCase();
  if (part.reference.startsWith("R") || text.includes("resistor")) return "resistor";
  if (part.reference.startsWith("C") || text.includes("capacitor")) return "capacitor";
  return "generic";
}

function unitsForKind(kind: "resistor" | "capacitor" | "generic"): string[] {
  if (kind === "resistor") return ["Ω", "kΩ", "MΩ"];
  if (kind === "capacitor") return ["pF", "nF", "µF", "uF", "mF", "F"];
  return [];
}

function unitAliasesForKind(
  kind: "resistor" | "capacitor" | "generic",
): Record<string, string> {
  if (kind === "resistor") {
    return {
      "": "Ω",
      r: "Ω",
      ohm: "Ω",
      ohms: "Ω",
      "ω": "Ω",
      "Ω": "Ω",
      k: "kΩ",
      kohm: "kΩ",
      kohms: "kΩ",
      "kω": "kΩ",
      "kΩ": "kΩ",
      m: "MΩ",
      mohm: "MΩ",
      mohms: "MΩ",
      "mω": "MΩ",
      "MΩ": "MΩ",
    };
  }
  if (kind === "capacitor") {
    return {
      pf: "pF",
      nf: "nF",
      uf: "uF",
      "µf": "µF",
      "μf": "µF",
      mf: "mF",
      f: "F",
    };
  }
  return {};
}

function parseInlineValue(
  rawValue: string,
  kind: "resistor" | "capacitor" | "generic",
): { amount: number; unit: string; canonicalValue: string } | null {
  const trimmed = rawValue.trim().replace(/\s+/g, "");
  if (!trimmed || kind === "generic") return null;
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([a-zA-ZΩωµμ]*)$/.exec(
    trimmed,
  );
  if (!match) return null;
  const amountText = match[1];
  if (!amountText) return null;
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return null;
  const unitRaw = match[2] ?? "";
  const aliases = unitAliasesForKind(kind);
  const unit = aliases[unitRaw] ?? aliases[unitRaw.toLowerCase()];
  if (!unit) return null;
  return { amount, unit, canonicalValue: `${amountText}${unit}` };
}

function PartInspector({
  part,
  dispatchCommand,
  setError,
}: {
  part: DesignerPlacedPart;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}): ReactElement {
  const [referenceDraft, setReferenceDraft] = useState(part.reference);
  const [valueDraft, setValueDraft] = useState(part.value);
  const structured = part.propertiesJson.valueStructured;
  const inferredKind = structured?.kind ?? inferValueKind(part);
  const [toleranceDraft, setToleranceDraft] = useState(
    structured?.tolerance ?? "",
  );

  useEffect(() => {
    setReferenceDraft(part.reference);
  }, [part.reference]);

  useEffect(() => {
    setValueDraft(part.value);
  }, [part.value]);

  useEffect(() => {
    setToleranceDraft(part.propertiesJson.valueStructured?.tolerance ?? "");
  }, [part.propertiesJson.valueStructured?.tolerance]);

  const commitReference = useCallback(async () => {
    const trimmed = referenceDraft.trim();
    if (trimmed === part.reference) return;
    if (trimmed.length === 0) {
      setReferenceDraft(part.reference);
      return;
    }
    try {
      await dispatchCommand({
        type: "update_part_properties",
        partId: part.id,
        reference: trimmed,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update reference");
      setReferenceDraft(part.reference);
    }
  }, [referenceDraft, part.reference, part.id, dispatchCommand, setError]);

  const commitValue = useCallback(async () => {
    const trimmedValue = valueDraft.trim();
    if (trimmedValue === part.value) return;
    try {
      const kind = inferValueKind(part);
      const parsed = parseInlineValue(trimmedValue, kind);
      if (kind !== "generic" && trimmedValue.length > 0 && !parsed) {
        setError(
          `Value must include a valid ${kind} unit (${unitsForKind(kind).join(
            ", ",
          )})`,
        );
        setValueDraft(part.value);
        return;
      }
      await dispatchCommand({
        type: "update_part_properties",
        partId: part.id,
        value: parsed?.canonicalValue ?? trimmedValue,
        propertiesJson: parsed
          ? {
              ...part.propertiesJson,
              valueStructured: {
                kind,
                amount: parsed.amount,
                unit: parsed.unit,
                tolerance: toleranceDraft,
              },
            }
          : part.propertiesJson,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update value");
      setValueDraft(part.value);
    }
  }, [
    valueDraft,
    part,
    dispatchCommand,
    setError,
    toleranceDraft,
  ]);

  const commitTolerance = useCallback(async () => {
    const current = part.propertiesJson.valueStructured;
    if (!current || toleranceDraft === (current.tolerance ?? "")) return;
    try {
      await dispatchCommand({
        type: "update_part_properties",
        partId: part.id,
        propertiesJson: {
          ...part.propertiesJson,
          valueStructured: { ...current, tolerance: toleranceDraft },
        },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update tolerance");
      setToleranceDraft(current.tolerance ?? "");
    }
  }, [dispatchCommand, part, setError, toleranceDraft]);

  const positionMm = useMemo(
    () => ({
      x: (part.positionNm.x / 1_000_000).toFixed(3),
      y: (part.positionNm.y / 1_000_000).toFixed(3),
    }),
    [part.positionNm],
  );

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Identity
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Reference
            </span>
            <input
              value={referenceDraft}
              onChange={(e) => setReferenceDraft(e.target.value)}
              onBlur={() => void commitReference()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Value
            </span>
            <input
              value={valueDraft}
              onChange={(e) => setValueDraft(e.target.value)}
              onBlur={() => void commitValue()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Structured Value
        </p>
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                Kind
              </span>
              <div className="text-xs capitalize text-slate-700 dark:text-slate-300">
                {inferredKind}
              </div>
            </div>
            <div>
              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                Accepted units
              </span>
              <div className="text-xs text-slate-700 dark:text-slate-300">
                {unitsForKind(inferredKind).join(", ") || "free text"}
              </div>
            </div>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Tolerance
            </span>
            <input
              value={toleranceDraft}
              onChange={(e) => setToleranceDraft(e.target.value)}
              onBlur={() => void commitTolerance()}
              placeholder="1%, 5%"
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Placement
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">X</span>
            <div className="text-xs text-slate-700 dark:text-slate-300">{positionMm.x} mm</div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Y</span>
            <div className="text-xs text-slate-700 dark:text-slate-300">{positionMm.y} mm</div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Rotation</span>
            <div className="text-xs text-slate-700 dark:text-slate-300">{part.rotationDeg}°</div>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Mirrored</span>
            <div className="text-xs text-slate-700 dark:text-slate-300">{part.mirrored ? "Yes" : "No"}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Metadata
        </p>
        <div className="flex flex-col gap-1">
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Component</span>
            <span className="max-w-[60%] truncate text-xs text-slate-700 dark:text-slate-300" title={part.componentId}>
              {part.componentId.slice(0, 8)}...
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Symbol</span>
            <span className="max-w-[60%] truncate text-xs text-slate-700 dark:text-slate-300" title={part.symbol.name}>
              {part.symbol.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Footprint</span>
            <span className="max-w-[60%] truncate text-xs text-slate-700 dark:text-slate-300" title={part.footprint.name}>
              {part.footprint.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Pins</span>
            <span className="text-xs text-slate-700 dark:text-slate-300">{part.pins.length}</span>
          </div>
        </div>
      </div>

      {part.propertiesJson?.pcb?.staleReason ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-400">
            PCB Warning
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {part.propertiesJson.pcb.staleReason}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function MultiPartInspector({
  parts,
  dispatchCommand,
  setError,
}: {
  parts: DesignerPlacedPart[];
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}): ReactElement {
  const commonComponentId = useMemo(() => {
    const first = parts[0]?.componentId;
    if (!first) return null;
    return parts.every((p) => p.componentId === first) ? first : null;
  }, [parts]);

  const [batchValue, setBatchValue] = useState("");

  const applyBatchValue = useCallback(async () => {
    if (!batchValue.trim()) return;
    try {
      await dispatchCommand({
        type: "update_parts_properties",
        partIds: parts.map((p) => p.id),
        value: batchValue,
      });
      setBatchValue("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to batch edit");
    }
  }, [batchValue, parts, dispatchCommand, setError]);

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Selection
        </p>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {parts.length} parts selected
        </p>
        {commonComponentId && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Same component type
          </p>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
          Batch Edit
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              Set Value
            </span>
            <div className="flex gap-2">
              <input
                value={batchValue}
                onChange={(e) => setBatchValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void applyBatchValue();
                  }
                }}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void applyBatchValue()}
                className="rounded bg-violet-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-700"
              >
                Apply
              </button>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

function SchematicDesignerSidebar({
  state,
  actions,
}: Omit<DesignerSidebarProps, "activeView">): ReactElement {
  const hasSelection =
    state.selectedPartIds.size > 0 ||
    state.selectedPartId != null ||
    state.selectedLabelId != null;

  const selectedParts = useMemo(() => {
    if (!state.projection) return [];
    const ids =
      state.selectedPartIds.size > 0
        ? state.selectedPartIds
        : state.selectedPartId
          ? new Set([state.selectedPartId])
          : new Set<string>();
    return state.projection.parts.filter((p) => ids.has(p.id));
  }, [state.projection, state.selectedPartIds, state.selectedPartId]);

  const singlePart =
    selectedParts.length === 1 ? selectedParts[0] ?? null : null;
  const multiParts = selectedParts.length > 1 ? selectedParts : [];

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950">
      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {hasSelection ? "Properties" : "Components"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {singlePart ? (
          <PartInspector
            part={singlePart}
            dispatchCommand={actions.dispatchCommand}
            setError={actions.setError}
          />
        ) : multiParts.length > 0 ? (
          <MultiPartInspector
            parts={multiParts}
            dispatchCommand={actions.dispatchCommand}
            setError={actions.setError}
          />
        ) : state.selectedLabelId ? (
          <div className="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
            Label properties coming soon
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Use{" "}
              <kbd className="rounded border border-slate-300 bg-white px-1 py-0.5 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-900">
                ⌘/Ctrl K
              </kbd>{" "}
              or the toolbar button to place components
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}

export function DesignerSidebar({
  state,
  actions,
  activeView,
}: DesignerSidebarProps): ReactElement {
  if (activeView !== "schem") {
    return (
      <aside className="flex h-full min-h-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950" />
    );
  }

  return <SchematicDesignerSidebar state={state} actions={actions} />;
}
