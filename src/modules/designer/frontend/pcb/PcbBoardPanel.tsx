import { AlertTriangle, Pencil } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { PcbBoardOutline, PcbPointMm } from "../../../../sdks";
import { Button } from "../../../../shared/frontend/ui/button";
import { PanelSectionHeader } from "../../../../shared/frontend/ui/panel-section-header";
import {
  PropertyGrid,
  PropertyRow,
} from "../../../../shared/frontend/ui/property-grid";
import { SegmentedControl } from "../../../../shared/frontend/ui/segmented-control";
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

const INPUT_CLASS =
  "h-[18px] w-full min-w-0 rounded-control border border-border-control bg-surface-input px-1 text-right text-xs text-text-strong outline-none focus:border-selection disabled:opacity-50";

const DASHED_BUTTON =
  "h-[22px] flex-1 cursor-pointer rounded-control border border-dashed border-border-control px-2 text-2xs text-text-secondary transition-colors hover:border-selection hover:text-text-strong disabled:opacity-50";

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
  /** Enter the canvas Board Shape tool to draw a custom polygon outline. */
  onDrawShape: () => void;
  /** Open the DXF import dialog to define the outline from a CAD drawing. */
  onImportDxf: () => void;
  /** Open the shared design-rules dialog (same save path as the DRC view). */
  onEditRules: () => void;
  /** False while the projection has not loaded — the dialog has no board yet. */
  canEditRules: boolean;
}

/** `x.xx` for a millimetre rule value; `—` when the field is absent. */
function formatMm(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(2);
}

function DimensionRow(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}): ReactElement {
  return (
    <PropertyRow label={props.label} mono hint="mm">
      <input
        ref={props.inputRef}
        value={props.value}
        disabled={props.disabled}
        inputMode="decimal"
        aria-label={props.label}
        onChange={(event) => props.onChange(event.target.value)}
        className={INPUT_CLASS}
      />
    </PropertyRow>
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
  onDrawShape,
  onImportDxf,
  onEditRules,
  canEditRules,
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
  const board = workspace.projection?.board ?? null;
  const designRules = board?.designRules ?? null;
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
  // A drawn/imported outline: the parametric W/H picker would overwrite it, so
  // edit mode shows a read-only bbox + on-canvas editing hint instead.
  const isCustom =
    currentOutline?.kind === "polygon" || currentOutline?.kind === "contour";

  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="Outline" />

      {editMode ? (
        isCustom ? (
          <>
            <div className="flex gap-1 px-2 py-1.5">
              <button
                type="button"
                disabled={workspace.saving || !canEdit}
                onClick={onDrawShape}
                className={DASHED_BUTTON}
              >
                ✏ Redraw shape
              </button>
              <button
                type="button"
                disabled={workspace.saving || !canEdit}
                onClick={onImportDxf}
                className={DASHED_BUTTON}
              >
                ⭳ Import DXF…
              </button>
            </div>
            <PropertyGrid>
              <PropertyRow label="Shape">{shapeLabel(currentOutline)}</PropertyRow>
              <PropertyRow label="Bounding box" mono hint="mm">
                {widthText} × {heightText}
              </PropertyRow>
            </PropertyGrid>
            <p className="px-2 py-1.5 text-2xs leading-snug text-text-tertiary">
              Edit on the canvas: drag a corner, or right-click an edge →{" "}
              <span className="font-medium text-text">Set length…</span> · a
              corner → <span className="font-medium text-text">Set position…</span>{" "}
              / <span className="font-medium text-text">Fillet</span>.
            </p>
            <div className="flex items-center gap-1.5 px-2 pb-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={workspace.saving || !canEdit}
                onClick={() =>
                  currentOutline &&
                  onApplyOutline({
                    kind: "rect",
                    widthMm: currentOutline.widthMm,
                    heightMm: currentOutline.heightMm,
                    centerMm: currentOutline.centerMm,
                  })
                }
              >
                Reset to rectangle
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
          </>
        ) : (
          <>
            <div className="flex items-center px-2 py-1.5">
              <SegmentedControl
                size="sm"
                aria-label="Board shape"
                options={SHAPE_OPTIONS.map((opt) => ({
                  id: opt.id,
                  label: opt.label,
                  disabled: workspace.saving,
                }))}
                value={shapeType}
                onChange={setShapeType}
              />
            </div>

            <div className="flex gap-1 px-2 pb-1.5">
              <button
                type="button"
                disabled={workspace.saving || !canEdit}
                onClick={onDrawShape}
                className={DASHED_BUTTON}
              >
                ✏ Draw custom shape
              </button>
              <button
                type="button"
                disabled={workspace.saving || !canEdit}
                onClick={onImportDxf}
                className={DASHED_BUTTON}
              >
                ⭳ Import DXF…
              </button>
            </div>

            <PropertyGrid>
              {isCircle ? (
                <DimensionRow
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
                <>
                  <DimensionRow
                    label="Width"
                    value={widthText}
                    onChange={setWidthText}
                    disabled={workspace.saving}
                    inputRef={widthRef}
                  />
                  <DimensionRow
                    label="Height"
                    value={heightText}
                    onChange={setHeightText}
                    disabled={workspace.saving}
                  />
                </>
              )}
              {shapeType === "roundrect" ? (
                <DimensionRow
                  label="Corner radius"
                  value={radiusText}
                  onChange={setRadiusText}
                  disabled={workspace.saving}
                />
              ) : null}
            </PropertyGrid>

            {!isCircle ? (
              <div className="flex flex-wrap gap-1 px-2 py-1.5">
                {SIZE_PRESETS.map((preset) => (
                  <button
                    key={`${preset.w}x${preset.h}`}
                    type="button"
                    disabled={workspace.saving}
                    onClick={() => {
                      setWidthText(String(preset.w));
                      setHeightText(String(preset.h));
                      onApplyOutline(
                        buildOutline(shapeType, preset.w, preset.h),
                      );
                    }}
                    className="h-[18px] rounded-control border border-border-control px-1.5 font-mono text-2xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-strong disabled:opacity-50"
                  >
                    {preset.w} × {preset.h}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-1.5 px-2 pb-2">
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

            <p className="px-2 pb-2 text-2xs text-text-disabled">
              Drag the board edges to resize
            </p>
          </>
        )
      ) : (
        <>
          <PropertyGrid>
            <PropertyRow label="Shape">{shapeLabel(currentOutline)}</PropertyRow>
            <PropertyRow label="Width" mono hint="mm">
              {widthText}
            </PropertyRow>
            <PropertyRow label="Height" mono hint="mm">
              {heightText}
            </PropertyRow>
          </PropertyGrid>
          <div className="flex items-center gap-1.5 px-2 py-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<Pencil className="h-3 w-3" />}
              disabled={!canEdit}
              onClick={onToggleEditMode}
            >
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canEdit || workspace.saving}
              onClick={onFitToParts}
            >
              Fit to parts
            </Button>
          </div>

          <PanelSectionHeader variant="uppercase" title="Stackup" />
          <PropertyGrid>
            <PropertyRow label="Copper layers" mono>
              {board?.layerCount ?? 2}
            </PropertyRow>
            {/* `boardThicknessMm` is optional; 1.6 mm (FR4) is the documented
                reader default — the rules dialog seeds the same value. */}
            <PropertyRow label="Thickness" mono hint="mm">
              {board ? formatMm(board.boardThicknessMm ?? 1.6) : "—"}
            </PropertyRow>
            {/* Copper weight lives on the optional electrical block; omitted
                entirely on boards that never set it. */}
            {designRules?.electrical?.copperWeightOz !== undefined ? (
              <PropertyRow label="Copper weight" mono hint="oz">
                {designRules.electrical.copperWeightOz}
              </PropertyRow>
            ) : null}
          </PropertyGrid>

          <PanelSectionHeader variant="uppercase" title="Design rules" />
          <PropertyGrid>
            <PropertyRow label="Clearance" mono hint="mm">
              {formatMm(designRules?.clearance.traceToTraceMm)}
            </PropertyRow>
            {/* The absolute floor: no scoped rule or net class may resolve
                below it. Optional/additive — absent reads as 0. */}
            <PropertyRow label="Clearance floor" mono hint="mm">
              {formatMm(
                designRules ? (designRules.minimums.clearanceMm ?? 0) : undefined,
              )}
            </PropertyRow>
            <PropertyRow label="Min track" mono hint="mm">
              {formatMm(designRules?.minimums.traceWidthMm)}
            </PropertyRow>
            <PropertyRow label="Min via" mono hint="mm">
              {formatMm(designRules?.minimums.viaDiameterMm)}
            </PropertyRow>
          </PropertyGrid>
          <div className="flex items-center px-2 py-2">
            <Button
              variant="outline"
              size="md"
              disabled={!canEditRules}
              onClick={onEditRules}
            >
              Edit rules…
            </Button>
          </div>

          <PanelSectionHeader variant="uppercase" title="Summary" />
          <PropertyGrid>
            <PropertyRow label="Components" mono>
              {workspace.projection?.placements.length ?? 0}
            </PropertyRow>
            <PropertyRow label="Nets" mono>
              {Object.keys(workspace.projection?.netNames ?? {}).length}
            </PropertyRow>
          </PropertyGrid>
        </>
      )}

      {outsideCount > 0 ? (
        <p className="mx-2 mb-2 flex items-center gap-1.5 rounded-control border border-status-warning/40 bg-status-warning-soft px-2 py-1 text-2xs text-status-warning">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {outsideCount} {outsideCount === 1 ? "item" : "items"} outside outline
        </p>
      ) : null}

      {workspace.error ? (
        <p className="mx-2 mb-2 rounded-control border border-status-danger/40 bg-status-danger-soft px-2 py-1 text-2xs text-status-danger">
          {workspace.error}
        </p>
      ) : null}

      {workspace.projection?.warnings.length ? (
        <ul className="mx-2 mb-2 max-h-40 list-disc space-y-0.5 overflow-y-auto rounded-control border border-status-warning/30 bg-status-warning-soft py-1 pl-5 pr-2 text-2xs text-status-warning">
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
