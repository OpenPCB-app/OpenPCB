import { AlertTriangle, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PcbBoardOutline, PcbPointMm } from "../../../../sdks";
import { Button } from "../../../../shared/frontend/ui/button";
import { Pill } from "../../../../shared/frontend/ui/pill";
import type { usePcbWorkspace } from "./usePcbWorkspace";

type PcbWorkspace = ReturnType<typeof usePcbWorkspace>;

/** Selectable parametric board shapes. `oval` maps to a `circle` outline with
 * differing width/height; the distinction is purely an input affordance. */
type ShapeType = "rect" | "roundrect" | "circle" | "oval";

const SHAPE_OPTIONS: ReadonlyArray<{ id: ShapeType; label: string }> = [
  { id: "rect", label: "Rect" },
  { id: "roundrect", label: "Rounded" },
  { id: "circle", label: "Circle" },
  { id: "oval", label: "Oval" },
];

/** Common board sizes (mm) offered as one-click presets in edit mode. */
const SIZE_PRESETS: ReadonlyArray<{ w: number; h: number }> = [
  { w: 50, h: 30 },
  { w: 100, h: 80 },
  { w: 100, h: 100 },
];

interface PcbBoardPanelProps {
  workspace: PcbWorkspace;
  widthText: string;
  setWidthText: (value: string) => void;
  heightText: string;
  setHeightText: (value: string) => void;
  widthMm: number;
  heightMm: number;
  valid: boolean;
  /** The persisted outline — drives the shape picker's initial state + center. */
  currentOutline: PcbBoardOutline | null;
  /** Number of parts/traces currently outside the board outline. */
  outsideCount: number;
  /** Apply a fully-built outline; also re-frames the camera. */
  onApplyOutline: (outline: PcbBoardOutline) => void;
  /** Shrink-wrap the board around all parts; also re-frames the camera. */
  onFitToParts: () => void;
  /** Whether board-dimension editing (inputs + canvas drag handles) is active. */
  editMode: boolean;
  /** Toggle board-dimension editing on/off. */
  onToggleEditMode: () => void;
}

function DimensionInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}): ReactElement {
  return (
    <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-tertiary">
      {props.label}
      <div className="relative">
        <input
          ref={props.inputRef}
          value={props.value}
          disabled={props.disabled}
          inputMode="decimal"
          onChange={(event) => props.onChange(event.target.value)}
          className="h-8 w-full rounded-control border border-slate-300 bg-surface-input pl-2 pr-8 text-sm font-normal text-text-primary outline-none focus:border-accent disabled:opacity-50 dark:border-slate-700"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] normal-case text-text-tertiary">
          mm
        </span>
      </div>
    </label>
  );
}

/** Initial shape-type for the picker from the persisted outline. */
function shapeTypeFromOutline(outline: PcbBoardOutline | null): ShapeType {
  if (!outline) return "rect";
  switch (outline.kind) {
    case "roundrect":
      return "roundrect";
    case "circle":
      return outline.widthMm === outline.heightMm ? "circle" : "oval";
    default:
      return "rect";
  }
}

function shapeLabel(outline: PcbBoardOutline | null): string {
  if (!outline) return "Rectangle";
  switch (outline.kind) {
    case "rect":
      return "Rectangle";
    case "roundrect":
      return "Rounded rectangle";
    case "circle":
      return outline.widthMm === outline.heightMm ? "Circle" : "Oval";
    case "polygon":
      return "Custom polygon";
    case "contour":
      return "Custom shape";
  }
}

export function PcbBoardPanel({
  workspace,
  widthText,
  setWidthText,
  heightText,
  setHeightText,
  widthMm,
  heightMm,
  valid,
  currentOutline,
  outsideCount,
  onApplyOutline,
  onFitToParts,
  editMode,
  onToggleEditMode,
}: PcbBoardPanelProps): ReactElement {
  const widthRef = useRef<HTMLInputElement>(null);
  const [shapeType, setShapeType] = useState<ShapeType>(() =>
    shapeTypeFromOutline(currentOutline),
  );
  const [radiusText, setRadiusText] = useState<string>(() =>
    currentOutline?.kind === "roundrect"
      ? String(currentOutline.cornerRadiusMm)
      : "3",
  );

  // Re-seed from the outline whenever edit mode (re)opens.
  useEffect(() => {
    if (editMode) {
      widthRef.current?.focus();
      setShapeType(shapeTypeFromOutline(currentOutline));
      if (currentOutline?.kind === "roundrect") {
        setRadiusText(String(currentOutline.cornerRadiusMm));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  const canEdit = !!workspace.projection;
  const center: PcbPointMm = currentOutline?.centerMm ?? { x: 0, y: 0 };
  const radiusMm = Number.parseFloat(radiusText);
  const radiusValid = Number.isFinite(radiusMm) && radiusMm >= 0;

  const buildOutline = (
    type: ShapeType,
    w: number,
    h: number,
  ): PcbBoardOutline => {
    const base = { widthMm: w, heightMm: h, centerMm: center };
    switch (type) {
      case "rect":
        return { kind: "rect", ...base };
      case "roundrect":
        return {
          kind: "roundrect",
          ...base,
          cornerRadiusMm: radiusValid
            ? Math.min(radiusMm, w / 2, h / 2)
            : Math.min(3, w / 2, h / 2),
        };
      case "circle":
        return { kind: "circle", widthMm: w, heightMm: w, centerMm: center };
      case "oval":
        return { kind: "circle", ...base };
    }
  };

  const applyCurrent = (): void => {
    if (shapeType === "circle") {
      onApplyOutline(buildOutline("circle", widthMm, widthMm));
    } else {
      onApplyOutline(buildOutline(shapeType, widthMm, heightMm));
    }
  };

  const isCircle = shapeType === "circle";
  const valuesValid = valid && (shapeType !== "roundrect" || radiusValid);

  return (
    <div className="flex flex-col gap-3 p-3">
      {editMode ? (
        <>
          <div className="flex flex-wrap gap-1">
            {SHAPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={workspace.saving}
                onClick={() => setShapeType(opt.id)}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                  shapeType === opt.id
                    ? "bg-accent text-white"
                    : "text-slate-700 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {isCircle ? (
            <DimensionInput
              label="Diameter"
              value={widthText}
              onChange={(v) => {
                setWidthText(v);
                setHeightText(v);
              }}
              disabled={workspace.saving}
              inputRef={widthRef}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <DimensionInput
                label="Width"
                value={widthText}
                onChange={setWidthText}
                disabled={workspace.saving}
                inputRef={widthRef}
              />
              <DimensionInput
                label="Height"
                value={heightText}
                onChange={setHeightText}
                disabled={workspace.saving}
              />
            </div>
          )}

          {shapeType === "roundrect" ? (
            <DimensionInput
              label="Corner radius"
              value={radiusText}
              onChange={setRadiusText}
              disabled={workspace.saving}
            />
          ) : null}

          {!isCircle ? (
            <div className="flex flex-wrap gap-1">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={`${preset.w}x${preset.h}`}
                  type="button"
                  disabled={workspace.saving}
                  onClick={() => {
                    setWidthText(String(preset.w));
                    setHeightText(String(preset.h));
                    onApplyOutline(buildOutline(shapeType, preset.w, preset.h));
                  }}
                  className="rounded px-2 py-0.5 text-[11px] text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {preset.w} × {preset.h}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!valuesValid || workspace.saving || !canEdit}
              onClick={applyCurrent}
            >
              {workspace.saving ? "Saving" : "Apply"}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={workspace.saving || !canEdit}
              onClick={onFitToParts}
            >
              Fit to parts
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={onToggleEditMode}
            >
              Done
            </Button>
          </div>

          <p className="text-[10px] text-text-tertiary">
            Drag the board edges to resize
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              disabled={!canEdit}
              onClick={onToggleEditMode}
              title="Click to edit dimensions"
              className="text-lg font-semibold tabular-nums text-text-primary transition-colors hover:text-accent disabled:cursor-default disabled:hover:text-text-primary"
            >
              {widthText} × {heightText}
              <span className="ml-1 text-sm font-normal text-text-tertiary">
                mm
              </span>
            </button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Pencil className="h-3.5 w-3.5" />}
              disabled={!canEdit}
              onClick={onToggleEditMode}
            >
              Edit
            </Button>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
            <span>{shapeLabel(currentOutline)}</span>
            <span aria-hidden>·</span>
            <Pill tone="neutral">2-layer</Pill>
          </div>
        </>
      )}

      {outsideCount > 0 ? (
        <Pill
          tone="warning"
          icon={<AlertTriangle className="h-3 w-3" />}
          className="self-start"
        >
          {outsideCount} {outsideCount === 1 ? "item" : "items"} outside outline
        </Pill>
      ) : null}

      {workspace.error ? (
        <p className="rounded-control border border-status-danger/40 bg-status-danger-soft px-2 py-1.5 text-xs text-status-danger">
          {workspace.error}
        </p>
      ) : null}

      {workspace.projection?.warnings.length ? (
        <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto rounded-control border border-status-warning/30 bg-status-warning-soft px-4 py-1.5 text-xs text-status-warning">
          {workspace.projection.warnings.map((warning, i) => (
            <li key={i} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
