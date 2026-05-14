import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Layers,
  Replace,
} from "lucide-react";
import type {
  DesignerPlacedPart,
  LibraryComponentFootprintVariant,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";

interface PartInspectorPanelProps {
  part: DesignerPlacedPart;
  variants: readonly LibraryComponentFootprintVariant[];
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
  onOpenInLibrary?(componentId: string): void;
  onReplaceComponentDisabledMessage?: string;
}

function inferValueKind(
  part: DesignerPlacedPart,
): "resistor" | "capacitor" | "generic" {
  const text =
    `${part.reference} ${part.symbol.name} ${part.footprint.name}`.toLowerCase();
  if (part.reference.startsWith("R") || text.includes("resistor"))
    return "resistor";
  if (part.reference.startsWith("C") || text.includes("capacitor"))
    return "capacitor";
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
      ω: "Ω",
      Ω: "Ω",
      k: "kΩ",
      kohm: "kΩ",
      kohms: "kΩ",
      kω: "kΩ",
      kΩ: "kΩ",
      m: "MΩ",
      mohm: "MΩ",
      mohms: "MΩ",
      mω: "MΩ",
      MΩ: "MΩ",
    };
  }
  if (kind === "capacitor") {
    return {
      pf: "pF",
      nf: "nF",
      uf: "uF",
      µf: "µF",
      μf: "µF",
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
  const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([a-zA-ZΩωµμ]*)$/.exec(trimmed);
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

export function PartInspectorPanel({
  part,
  variants,
  dispatchCommand,
  setError,
  onOpenInLibrary,
  onReplaceComponentDisabledMessage,
}: PartInspectorPanelProps): ReactElement {
  const [valueDraft, setValueDraft] = useState(part.value);
  const structured = part.propertiesJson.valueStructured;
  const inferredKind = structured?.kind ?? inferValueKind(part);
  const [toleranceDraft, setToleranceDraft] = useState(
    structured?.tolerance ?? "",
  );
  const [xDraft, setXDraft] = useState(
    (part.positionNm.x / 1_000_000).toFixed(3),
  );
  const [yDraft, setYDraft] = useState(
    (part.positionNm.y / 1_000_000).toFixed(3),
  );
  const [rotDraft, setRotDraft] = useState(String(part.rotationDeg));
  const [footprintMenuOpen, setFootprintMenuOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setValueDraft(part.value);
  }, [part.value]);
  useEffect(() => {
    setToleranceDraft(part.propertiesJson.valueStructured?.tolerance ?? "");
  }, [part.propertiesJson.valueStructured?.tolerance]);
  useEffect(() => {
    setXDraft((part.positionNm.x / 1_000_000).toFixed(3));
    setYDraft((part.positionNm.y / 1_000_000).toFixed(3));
  }, [part.positionNm.x, part.positionNm.y]);
  useEffect(() => {
    setRotDraft(String(part.rotationDeg));
  }, [part.rotationDeg]);

  const commitValue = useCallback(async () => {
    const trimmedValue = valueDraft.trim();
    if (trimmedValue === part.value) return;
    try {
      const kind = inferValueKind(part);
      const parsed = parseInlineValue(trimmedValue, kind);
      if (kind !== "generic" && trimmedValue.length > 0 && !parsed) {
        setError(
          `Value must include a valid ${kind} unit (${unitsForKind(kind).join(", ")})`,
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
      setError(
        error instanceof Error ? error.message : "Failed to update value",
      );
      setValueDraft(part.value);
    }
  }, [valueDraft, part, dispatchCommand, setError, toleranceDraft]);

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
      setError(
        error instanceof Error ? error.message : "Failed to update tolerance",
      );
      setToleranceDraft(current.tolerance ?? "");
    }
  }, [dispatchCommand, part, setError, toleranceDraft]);

  const commitPosition = useCallback(async () => {
    const xMm = Number.parseFloat(xDraft);
    const yMm = Number.parseFloat(yDraft);
    if (!Number.isFinite(xMm) || !Number.isFinite(yMm)) {
      setXDraft((part.positionNm.x / 1_000_000).toFixed(3));
      setYDraft((part.positionNm.y / 1_000_000).toFixed(3));
      return;
    }
    const nextX = Math.round(xMm * 1_000_000);
    const nextY = Math.round(yMm * 1_000_000);
    if (nextX === part.positionNm.x && nextY === part.positionNm.y) return;
    try {
      await dispatchCommand({
        type: "move_part",
        partId: part.id,
        positionNm: { x: nextX, y: nextY },
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to move part");
      setXDraft((part.positionNm.x / 1_000_000).toFixed(3));
      setYDraft((part.positionNm.y / 1_000_000).toFixed(3));
    }
  }, [dispatchCommand, part, setError, xDraft, yDraft]);

  const commitRotation = useCallback(async () => {
    const raw = Number.parseFloat(rotDraft);
    const normalized = (((Math.round(raw / 90) * 90) % 360) + 360) % 360;
    if (!Number.isFinite(raw)) {
      setRotDraft(String(part.rotationDeg));
      return;
    }
    if (normalized === part.rotationDeg) {
      setRotDraft(String(normalized));
      return;
    }
    try {
      await dispatchCommand({
        type: "rotate_part",
        partId: part.id,
        rotationDeg: normalized as 0 | 90 | 180 | 270,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to rotate part",
      );
      setRotDraft(String(part.rotationDeg));
    }
  }, [dispatchCommand, part.id, part.rotationDeg, rotDraft, setError]);

  const currentVariant = useMemo(
    () =>
      variants.find(
        (variant) => variant.footprintId === part.footprint.footprintId,
      ) ??
      variants.find((variant) => variant.isDefault) ??
      variants[0] ??
      null,
    [variants, part.footprint.footprintId],
  );

  const hasAlternatives = variants.length > 1;

  return (
    <div className="flex flex-col gap-3">
      {/* Identity */}
      <section className="flex flex-col gap-2">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Value
          </span>
          <input
            value={valueDraft}
            onChange={(event) => setValueDraft(event.target.value)}
            onBlur={() => void commitValue()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder={
              inferredKind === "generic"
                ? "—"
                : `e.g. 10${unitsForKind(inferredKind)[0] ?? ""}`
            }
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </label>
        {inferredKind !== "generic" && (
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Tolerance
            </span>
            <input
              value={toleranceDraft}
              onChange={(event) => setToleranceDraft(event.target.value)}
              onBlur={() => void commitTolerance()}
              placeholder="1%, 5%"
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
        )}
      </section>

      <div className="h-px bg-slate-200 dark:bg-slate-800" />

      {/* Footprint */}
      {variants.length > 0 && currentVariant && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Footprint
            </span>
            {hasAlternatives ? (
              <button
                type="button"
                onClick={() => setFootprintMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Layers className="h-3 w-3 text-violet-500 dark:text-violet-300" />
                <span className="max-w-[10rem] truncate">
                  {currentVariant.variantLabel}
                </span>
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>
            ) : (
              <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {currentVariant.variantLabel}
              </span>
            )}
          </div>
          {footprintMenuOpen && hasAlternatives && (
            <ul
              role="listbox"
              className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 dark:border-slate-700 dark:bg-slate-900"
            >
              {variants
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((variant) => {
                  const active =
                    variant.footprintId === currentVariant.footprintId;
                  const disabled = Boolean(onReplaceComponentDisabledMessage);
                  return (
                    <li key={variant.footprintId}>
                      <button
                        type="button"
                        disabled={disabled || active}
                        onClick={() => setFootprintMenuOpen(false)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[11px] transition-colors ${
                          active
                            ? "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-200"
                            : disabled
                              ? "cursor-not-allowed text-slate-400 dark:text-slate-600"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                        }`}
                      >
                        <span className="flex flex-col">
                          <span className="font-medium">
                            {variant.variantLabel}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {variant.mountType ?? "—"} · {variant.padCount} pads
                          </span>
                        </span>
                        {variant.isDefault && (
                          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            Default
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
          {onReplaceComponentDisabledMessage && (
            <p className="text-[10px] leading-snug text-amber-500 dark:text-amber-400/80">
              {onReplaceComponentDisabledMessage}
            </p>
          )}
        </section>
      )}

      <div className="h-px bg-slate-200 dark:bg-slate-800" />

      {/* Placement */}
      <section>
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Placement
        </p>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-500">
              X (mm)
            </span>
            <input
              value={xDraft}
              onChange={(event) => setXDraft(event.target.value)}
              onBlur={() => void commitPosition()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-500">
              Y (mm)
            </span>
            <input
              value={yDraft}
              onChange={(event) => setYDraft(event.target.value)}
              onBlur={() => void commitPosition()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-500">
              Rotation (°)
            </span>
            <input
              value={rotDraft}
              onChange={(event) => setRotDraft(event.target.value)}
              onBlur={() => void commitRotation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-slate-500 dark:text-slate-500">
              Mirrored
            </span>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
              {part.mirrored ? "Yes" : "No"}
            </div>
          </div>
        </div>
      </section>

      <div className="h-px bg-slate-200 dark:bg-slate-800" />

      {/* Quick actions */}
      <section className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled
          title="Replace component — coming in a future designer phase"
          className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-600"
        >
          <span className="flex items-center gap-2">
            <Replace className="h-3.5 w-3.5" />
            Replace component
          </span>
          <span className="text-[10px] uppercase tracking-wider">soon</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenInLibrary?.(part.componentId)}
          disabled={!onOpenInLibrary}
          className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <BookOpen className="h-3.5 w-3.5 text-slate-400" />
          Open in Library
        </button>
      </section>

      {/* Advanced */}
      <button
        type="button"
        onClick={() => setAdvancedOpen((prev) => !prev)}
        className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300"
      >
        {advancedOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Advanced
      </button>
      {advancedOpen && (
        <section className="flex flex-col gap-0.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-[10px] dark:border-slate-800 dark:bg-slate-900">
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Component</span>
            <span
              className="max-w-[60%] truncate font-mono text-slate-700 dark:text-slate-300"
              title={part.componentId}
            >
              {part.componentId.slice(0, 12)}…
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Symbol</span>
            <span
              className="max-w-[60%] truncate text-slate-700 dark:text-slate-300"
              title={part.symbol.name}
            >
              {part.symbol.name}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-slate-500">Pins</span>
            <span className="text-slate-700 dark:text-slate-300">
              {part.pins.length}
            </span>
          </div>
          {part.propertiesJson?.pcb?.staleReason && (
            <div className="mt-1 rounded border border-amber-300/60 bg-amber-50 p-1.5 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
              PCB: {part.propertiesJson.pcb.staleReason}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
