import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { PcbLayerCount, PcbLayerId } from "../../../../sdks";
import {
  Ban,
  Cable,
  PenTool,
  CircleDot,
  Eye,
  EyeOff,
  Factory,
  FlipHorizontal2,
  LayoutGrid,
  Magnet,
  Maximize,
  MessageSquarePlus,
  Network,
  Plus,
  Redo2,
  ShieldCheck,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import type { PcbTraceSegmentMode } from "../../../../sdks";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
} from "@shared/frontend/ui/toolbar";
import { SegmentedControl } from "@shared/frontend/ui/segmented-control";
import { PCB_LAYER_LABELS } from "../../../../shared/frontend/canvas/layers";
import type { RoutePosture } from "./tools/route-tool-state";
import { VIA_PRESETS, type PcbViaPreset } from "../../backend/pcb/via-presets";
import { LAYER_PAIR_PRESETS } from "./tools/route-layer";
import { usePcbViewStore } from "./pcb-view-store";

const LAYER_LABELS = PCB_LAYER_LABELS as Record<string, string | undefined>;

/** Shared look for the parameter row's dropdown triggers + value chips. */
const CHIP_CLASS =
  "inline-flex h-[20px] shrink-0 items-center gap-1.5 rounded-control border border-border-control bg-surface-input px-1.5 text-2xs text-text-secondary transition-colors hover:text-text-strong";

const MENU_CLASS =
  "absolute top-full z-30 mt-1 overflow-hidden rounded-float border border-border bg-surface-raised text-xs shadow-lg";

const MENU_ITEM_CLASS =
  "block w-full px-3 py-1 text-left text-text transition-colors hover:bg-surface-hover hover:text-text-strong";

const MENU_ITEM_ACTIVE_CLASS =
  "block w-full bg-surface-selected px-3 py-1 text-left font-medium text-text-strong";

/**
 * Smart-via layer pair selector (4-layer boards): where the V key jumps.
 * Session-only state in the view store.
 */
function LayerPairSelect(): ReactElement {
  const layerPair = usePcbViewStore((s) => s.layerPair);
  const setLayerPair = usePcbViewStore((s) => s.setLayerPair);
  const value = `${layerPair[0]}|${layerPair[1]}`;
  return (
    <select
      value={value}
      title="Smart-via layer pair — V jumps between these layers"
      aria-label="Smart-via layer pair"
      className="h-[20px] shrink-0 rounded-control border border-border-control bg-surface-input px-1 text-2xs text-text-secondary outline-none"
      onChange={(e) => {
        const preset = LAYER_PAIR_PRESETS.find(
          (p) => `${p[0]}|${p[1]}` === e.target.value,
        );
        if (preset) setLayerPair(preset);
      }}
    >
      {LAYER_PAIR_PRESETS.map((p) => (
        <option key={`${p[0]}|${p[1]}`} value={`${p[0]}|${p[1]}`}>
          {p[0].replace(".Cu", "")}↔{p[1].replace(".Cu", "")}
        </option>
      ))}
    </select>
  );
}

interface PcbTopToolbarProps {
  selectedPlacementCount: number;
  onFlipSelection: () => void;
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  /** Figma-style alignment guides + magnetic snap (Shift+G). */
  alignmentGuidesVisible: boolean;
  onToggleAlignmentGuides: () => void;
  /** Whether the right dock's DRC tab is showing. */
  drcPanelOpen: boolean;
  onToggleDrcPanel: () => void;
  /** Active batch-DRC error count; drives the red alarm dot on the button. */
  drcErrorCount?: number;
  /** Whether DRC violation markers are drawn on the canvas. */
  drcMarkersVisible: boolean;
  onToggleDrcMarkers: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  /** Opens the manufacturing export dialog (Gerber + Drill + BOM + PnP). */
  onExport: () => void;
  routeMode: boolean;
  onToggleRouteMode: () => void;
  boardShapeMode: boolean;
  onToggleBoardShape: () => void;
  commentMode?: boolean;
  onToggleCommentMode?: () => void;
  /** F5 mounting-hole drop tool. Click on canvas drops a free hole. */
  holeMode: boolean;
  onToggleHoleMode: () => void;
  /** F5 free-pad drop tool. Click on canvas drops a free SMD pad. */
  padMode: boolean;
  onTogglePadMode: () => void;
  /** F5 overlay-text drop tool. Click on canvas opens prompt → silkscreen label. */
  textMode: boolean;
  onToggleTextMode: () => void;
  /** Copper-zone draw tool (Z) — sketches a polygon zone (contract §12.3). */
  zoneMode: boolean;
  onToggleZoneMode: () => void;
  /** Keepout ("rule area") draw tool (K). */
  keepoutMode: boolean;
  onToggleKeepoutMode: () => void;
}

const POSTURE_LABEL: Record<RoutePosture, string> = {
  auto: "Auto",
  axis: "Axis",
  diagonal: "Diag",
};

/** Outside-click-to-close for the hand-rolled dropdowns. */
function useOutsideClose(
  open: boolean,
  ref: React.RefObject<HTMLDivElement | null>,
  close: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [close, open, ref]);
}

function WidthDropdown({
  activeWidthMm,
  presets,
  onPick,
}: {
  activeWidthMm: number;
  presets: ReadonlyArray<number>;
  onPick: (widthMm: number) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Trace width — W cycles forward, Shift+W backward, Alt+W custom"
        className={CHIP_CLASS}
      >
        <span className="text-text-caps">W</span>
        <span className="font-mono text-text-strong">
          {activeWidthMm.toFixed(3)}
        </span>
        <span className="text-text-disabled">mm</span>
        <span aria-hidden className="text-text-disabled">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${MENU_CLASS} left-0 min-w-[140px]`}>
          {presets.map((w) => {
            const active = Math.abs(w - activeWidthMm) < 1e-6;
            return (
              <button
                key={w}
                type="button"
                onClick={() => {
                  onPick(w);
                  setOpen(false);
                }}
                className={`font-mono ${active ? MENU_ITEM_ACTIVE_CLASS : MENU_ITEM_CLASS}`}
              >
                {w.toFixed(3)} mm
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const input = window.prompt(
                "Custom trace width (mm):",
                activeWidthMm.toString(),
              );
              if (input !== null) {
                const next = Number(input);
                if (Number.isFinite(next) && next > 0) onPick(next);
              }
              setOpen(false);
            }}
            className={`border-t border-border ${MENU_ITEM_CLASS}`}
          >
            Custom… (Alt+W)
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ViaSizeDropdown({
  label,
  hotkeyTitle,
  activeMm,
  defaultMm,
  presets,
  onPick,
}: {
  label: "Ø" | "⌀";
  hotkeyTitle: string;
  activeMm: number;
  defaultMm: number;
  presets: ReadonlyArray<number>;
  onPick: (mm: number | undefined) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const isOverride = Math.abs(activeMm - defaultMm) > 1e-9;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={hotkeyTitle}
        className={`${CHIP_CLASS} ${isOverride ? "border-selection" : ""}`}
      >
        <span className="text-text-caps">{label}</span>
        <span className="font-mono text-text-strong">{activeMm.toFixed(2)}</span>
        <span className="text-text-disabled">mm</span>
        <span aria-hidden className="text-text-disabled">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${MENU_CLASS} left-0 min-w-[160px]`}>
          <button
            type="button"
            onClick={() => {
              onPick(undefined);
              setOpen(false);
            }}
            className={!isOverride ? MENU_ITEM_ACTIVE_CLASS : MENU_ITEM_CLASS}
          >
            Net-class default ({defaultMm.toFixed(2)} mm)
          </button>
          {presets.map((mm) => {
            const active = Math.abs(mm - activeMm) < 1e-6 && isOverride;
            return (
              <button
                key={mm}
                type="button"
                onClick={() => {
                  onPick(mm);
                  setOpen(false);
                }}
                className={`font-mono ${active ? MENU_ITEM_ACTIVE_CLASS : MENU_ITEM_CLASS}`}
              >
                {mm.toFixed(2)} mm
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const input = window.prompt(
                `Custom ${label === "Ø" ? "diameter" : "drill"} (mm):`,
                activeMm.toString(),
              );
              if (input !== null) {
                const next = Number(input);
                if (Number.isFinite(next) && next > 0) onPick(next);
              }
              setOpen(false);
            }}
            className={`border-t border-border ${MENU_ITEM_CLASS}`}
          >
            Custom…
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ViaPresetDropdown({
  activeDiameterMm,
  activeDrillMm,
  onPick,
}: {
  activeDiameterMm: number;
  activeDrillMm: number;
  onPick: (preset: PcbViaPreset) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const matched = VIA_PRESETS.find(
    (p) =>
      Math.abs(p.diameterMm - activeDiameterMm) < 1e-6 &&
      Math.abs(p.drillMm - activeDrillMm) < 1e-6,
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Via preset (paired drill + diameter)"
        className={CHIP_CLASS}
      >
        <span className="text-text-strong">{matched?.name ?? "Custom"}</span>
        <span aria-hidden className="text-text-disabled">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${MENU_CLASS} left-0 min-w-[260px]`}>
          {VIA_PRESETS.map((preset) => {
            const active = matched?.id === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onPick(preset);
                  setOpen(false);
                }}
                className={active ? MENU_ITEM_ACTIVE_CLASS : MENU_ITEM_CLASS}
              >
                <div className="flex items-baseline justify-between gap-3 font-mono">
                  <span className="font-sans font-medium">{preset.name}</span>
                  <span>
                    {preset.drillMm.toFixed(2)} / {preset.diameterMm.toFixed(2)}{" "}
                    mm
                  </span>
                </div>
                <div className="text-2xs text-text-tertiary">
                  {preset.description}
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AddDropdown({
  holeMode,
  onToggleHoleMode,
  padMode,
  onTogglePadMode,
  textMode,
  onToggleTextMode,
  zoneMode,
  onToggleZoneMode,
  keepoutMode,
  onToggleKeepoutMode,
  commentMode,
  onToggleCommentMode,
}: {
  holeMode: boolean;
  onToggleHoleMode: () => void;
  padMode: boolean;
  onTogglePadMode: () => void;
  textMode: boolean;
  onToggleTextMode: () => void;
  zoneMode: boolean;
  onToggleZoneMode: () => void;
  keepoutMode: boolean;
  onToggleKeepoutMode: () => void;
  /** Comment tool — only offered when the caller wires it. */
  commentMode?: boolean;
  onToggleCommentMode?: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const items = [
    {
      key: "hole",
      label: "Hole",
      hotkey: "H",
      title:
        "Drop mounting hole (H) — click on the board to place a 3.2 mm hole",
      Icon: CircleDot,
      active: holeMode,
      onToggle: onToggleHoleMode,
    },
    {
      key: "pad",
      label: "Pad",
      hotkey: "P",
      title:
        "Drop free pad (P) — click on the board to place a free SMD pad on the active copper layer",
      Icon: Square,
      active: padMode,
      onToggle: onTogglePadMode,
    },
    {
      key: "text",
      label: "Text",
      hotkey: "T",
      title:
        "Add silkscreen text (T) — click on the board, then type the label",
      Icon: Type,
      active: textMode,
      onToggle: onToggleTextMode,
    },
    {
      key: "zone",
      label: "Zone",
      hotkey: "Z",
      title:
        "Draw copper zone (Z) — click to place vertices, click the first one to close. Shift+Z cuts a hole in the selected zone",
      Icon: LayoutGrid,
      active: zoneMode,
      onToggle: onToggleZoneMode,
    },
    {
      key: "keepout",
      label: "Keepout",
      hotkey: "K",
      title:
        "Draw keepout / rule area (K) — click to place vertices, click the first one to close",
      Icon: Ban,
      active: keepoutMode,
      onToggle: onToggleKeepoutMode,
    },
    ...(onToggleCommentMode
      ? [
          {
            key: "comment",
            label: "Comment",
            hotkey: "C",
            title: "Comment (C) — click on the board to drop a comment pin",
            Icon: MessageSquarePlus,
            active: commentMode ?? false,
            onToggle: onToggleCommentMode,
          },
        ]
      : []),
  ];

  const activeItem = items.find((it) => it.active);
  const ButtonIcon = activeItem ? activeItem.Icon : Plus;
  const name = activeItem
    ? activeItem.title
    : "Add hole, pad, text, zone, or keepout";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={name}
        aria-label={activeItem ? activeItem.label : "Add"}
        aria-pressed={Boolean(activeItem)}
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-control px-1.5 text-xs transition-colors outline-none ${
          activeItem
            ? "bg-surface-control text-text-strong"
            : "text-text-secondary hover:bg-surface-hover hover:text-text-strong"
        }`}
      >
        <ButtonIcon className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
        {activeItem ? activeItem.label : "Add"}
        <span aria-hidden className="text-text-disabled">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${MENU_CLASS} left-0 min-w-[160px]`}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              title={it.title}
              onClick={() => {
                it.onToggle();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left transition-colors ${
                it.active
                  ? "bg-surface-selected font-medium text-text-strong"
                  : "text-text hover:bg-surface-hover hover:text-text-strong"
              }`}
            >
              <it.Icon className="h-3.5 w-3.5" />
              <span className="flex-1">{it.label}</span>
              <span className="font-mono text-2xs text-text-disabled">
                {it.hotkey}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Canvas-overlay toggles (Ratsnest / Guides / DRC markers) collapsed into a
 * single dropdown — only things drawn on the board or that change canvas
 * behavior. UI panels (e.g. the DRC dock) stay as toolbar buttons. Rows stay
 * open on click so several can be flipped at once; only an outside click
 * closes.
 */
function ViewToggleDropdown({
  ratsnestVisible,
  onToggleRatsnest,
  alignmentGuidesVisible,
  onToggleAlignmentGuides,
  drcMarkersVisible,
  onToggleDrcMarkers,
}: {
  ratsnestVisible: boolean;
  onToggleRatsnest: () => void;
  alignmentGuidesVisible: boolean;
  onToggleAlignmentGuides: () => void;
  drcMarkersVisible: boolean;
  onToggleDrcMarkers: () => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const rows = [
    {
      key: "ratsnest",
      label: "Ratsnest",
      hint: "⇧B",
      Icon: Network,
      on: ratsnestVisible,
      onToggle: onToggleRatsnest,
    },
    {
      key: "guides",
      label: "Guides",
      hint: "⇧G",
      Icon: Magnet,
      on: alignmentGuidesVisible,
      onToggle: onToggleAlignmentGuides,
    },
    {
      key: "markers",
      label: "DRC markers",
      hint: "",
      Icon: drcMarkersVisible ? Eye : EyeOff,
      on: drcMarkersVisible,
      onToggle: onToggleDrcMarkers,
    },
  ];

  const activeCount = rows.filter((r) => r.on).length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Show/hide ratsnest, guides, and DRC overlays"
        aria-label="View"
        aria-expanded={open}
        className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-control px-1.5 text-xs transition-colors outline-none ${
          open
            ? "bg-surface-control text-text-strong"
            : "text-text-secondary hover:bg-surface-hover hover:text-text-strong"
        }`}
      >
        <Eye className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
        View
        {activeCount > 0 ? (
          <span className="font-mono text-2xs text-text-disabled">
            {activeCount}
          </span>
        ) : null}
        <span aria-hidden className="text-text-disabled">
          ▾
        </span>
      </button>
      {open ? (
        <div className={`${MENU_CLASS} right-0 min-w-[190px]`}>
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={row.onToggle}
              aria-pressed={row.on}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-text transition-colors hover:bg-surface-hover hover:text-text-strong"
            >
              <row.Icon
                className={`h-3.5 w-3.5 ${row.on ? "text-text-strong" : "text-text-disabled"}`}
              />
              <span className="flex-1">{row.label}</span>
              {row.hint ? (
                <span className="font-mono text-2xs text-text-disabled">
                  {row.hint}
                </span>
              ) : null}
              <span
                className={`text-2xs font-medium ${row.on ? "text-text-strong" : "text-text-disabled"}`}
              >
                {row.on ? "On" : "Off"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Docked 30px PCB toolbar. Route-mode controls live in the parameter row
 * below it (`PcbRouteParamRow`); Measure (M), Tune (U) and Bundle stay
 * hotkey-only (their handlers are still wired through props).
 *
 * Frozen accessible names (`title` === `aria-label`, composed by
 * `ToolbarButton` as `label` or `label (hotkey)`) — E2E locators depend on
 * them verbatim: "Undo", "Redo", "Fit board", "Flip part", "Route (R)",
 * "Board (O)", "Export…", "DRC", "Add", "View". Zoom in / Zoom out moved to the
 * canvas-corner `CanvasZoomCluster` (same accessible names).
 */
export function PcbTopToolbar({
  selectedPlacementCount,
  onFlipSelection,
  ratsnestVisible,
  onToggleRatsnest,
  alignmentGuidesVisible,
  onToggleAlignmentGuides,
  drcPanelOpen,
  onToggleDrcPanel,
  drcErrorCount,
  drcMarkersVisible,
  onToggleDrcMarkers,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFit,
  onExport,
  routeMode,
  onToggleRouteMode,
  boardShapeMode,
  onToggleBoardShape,
  commentMode = false,
  onToggleCommentMode,
  holeMode,
  onToggleHoleMode,
  padMode,
  onTogglePadMode,
  textMode,
  onToggleTextMode,
  zoneMode,
  onToggleZoneMode,
  keepoutMode,
  onToggleKeepoutMode,
}: PcbTopToolbarProps): ReactElement {
  return (
    <Toolbar aria-label="PCB tools">
      <ToolbarButton
        label="Undo"
        title="Undo (⌘/Ctrl+Z)"
        icon={<Undo2 />}
        onClick={onUndo}
        disabled={!canUndo}
      />
      <ToolbarButton
        label="Redo"
        title="Redo (⌘/Ctrl+Shift+Z)"
        icon={<Redo2 />}
        onClick={onRedo}
        disabled={!canRedo}
      />

      <ToolbarSeparator />

      <ToolbarButton label="Fit board" icon={<Maximize />} onClick={onFit} />

      <ToolbarSeparator />

      <ToolbarButton
        label="Flip part"
        icon={<FlipHorizontal2 />}
        onClick={onFlipSelection}
        disabled={selectedPlacementCount === 0}
      />
      <ToolbarButton
        label="Route"
        hotkey="R"
        icon={<Cable />}
        active={routeMode}
        pressable
        onClick={onToggleRouteMode}
      />
      <ToolbarButton
        label="Board"
        hotkey="O"
        icon={<PenTool />}
        active={boardShapeMode}
        pressable
        onClick={onToggleBoardShape}
      />

      <ToolbarSeparator />

      <AddDropdown
        holeMode={holeMode}
        onToggleHoleMode={onToggleHoleMode}
        padMode={padMode}
        onTogglePadMode={onTogglePadMode}
        textMode={textMode}
        onToggleTextMode={onToggleTextMode}
        zoneMode={zoneMode}
        onToggleZoneMode={onToggleZoneMode}
        keepoutMode={keepoutMode}
        onToggleKeepoutMode={onToggleKeepoutMode}
        commentMode={commentMode}
        onToggleCommentMode={onToggleCommentMode}
      />

      <ToolbarSpacer />

      <ToolbarButton
        label="Export…"
        title="Export manufacturing files (Gerber + Drill + BOM + PnP)"
        icon={<Factory />}
        data-testid="pcb-export-button"
        onClick={onExport}
      >
        Export…
      </ToolbarButton>

      {/* The DRC dock tab is a UI panel toggle (not a canvas overlay) — it
          stays a toolbar button; the count flags outstanding violations. */}
      <ToolbarButton
        label="DRC"
        icon={<ShieldCheck />}
        active={drcPanelOpen}
        pressable
        onClick={onToggleDrcPanel}
      >
        DRC
        {drcErrorCount !== undefined && drcErrorCount > 0 ? (
          <span className="font-mono text-2xs text-status-danger">
            {drcErrorCount}
          </span>
        ) : null}
      </ToolbarButton>

      <ViewToggleDropdown
        ratsnestVisible={ratsnestVisible}
        onToggleRatsnest={onToggleRatsnest}
        alignmentGuidesVisible={alignmentGuidesVisible}
        onToggleAlignmentGuides={onToggleAlignmentGuides}
        drcMarkersVisible={drcMarkersVisible}
        onToggleDrcMarkers={onToggleDrcMarkers}
      />
    </Toolbar>
  );
}

/** One 28px parameter-row shell. Used by the route/tune/bundle rows. */
export function PcbParamRow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`flex h-[28px] shrink-0 items-center gap-2.5 border-b border-border bg-surface-panel-head px-2.5 font-mono text-xs text-text-secondary ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export interface PcbRouteParamRowProps {
  segmentMode: PcbTraceSegmentMode;
  onToggleSegmentMode: () => void;
  posture: RoutePosture;
  onCyclePosture: () => void;
  activeWidthMm: number;
  tracePresets: ReadonlyArray<number>;
  onPickWidth: (widthMm: number) => void;
  layerCount?: PcbLayerCount;
  routeSessionActive: boolean;
  viaDiameterMm: number;
  viaDrillMm: number;
  viaDiameterDefaultMm: number;
  viaDrillDefaultMm: number;
  viaDiameterPresets: ReadonlyArray<number>;
  viaDrillPresets: ReadonlyArray<number>;
  onPickViaDiameter: (mm: number | undefined) => void;
  onPickViaDrill: (mm: number | undefined) => void;
  onPickViaPreset: (preset: PcbViaPreset) => void;
  /** Copper layer the route targets (chip on the left). */
  layer: PcbLayerId;
  layerColor: string;
  /** Net class driving the defaults; shown as `Class <name>`. */
  netClassName?: string | null;
  /** Right-aligned live status (net, length, clearance) from the route HUD. */
  status?: ReactNode;
}

/**
 * 28px route parameter row: the controls that used to expand the floating
 * toolbar, plus the route HUD's status text on the right.
 */
export function PcbRouteParamRow({
  segmentMode,
  onToggleSegmentMode,
  posture,
  onCyclePosture,
  activeWidthMm,
  tracePresets,
  onPickWidth,
  layerCount = 2,
  routeSessionActive,
  viaDiameterMm,
  viaDrillMm,
  viaDiameterDefaultMm,
  viaDrillDefaultMm,
  viaDiameterPresets,
  viaDrillPresets,
  onPickViaDiameter,
  onPickViaDrill,
  onPickViaPreset,
  layer,
  layerColor,
  netClassName,
  status,
}: PcbRouteParamRowProps): ReactElement {
  return (
    <PcbParamRow>
      <span className="shrink-0 font-sans font-medium text-text-strong">
        Route
      </span>
      <span className={CHIP_CLASS} title={`Routing on ${layer}`}>
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 ring-1 ring-black/40"
          style={{ backgroundColor: layerColor }}
        />
        <span className="font-sans text-text-strong">
          {LAYER_LABELS[layer] ?? layer}
        </span>
        <span className="text-text-disabled">{layer}</span>
      </span>
      <WidthDropdown
        activeWidthMm={activeWidthMm}
        presets={tracePresets}
        onPick={onPickWidth}
      />
      {layerCount >= 4 ? <LayerPairSelect /> : null}
      {routeSessionActive ? (
        <>
          <ViaPresetDropdown
            activeDiameterMm={viaDiameterMm}
            activeDrillMm={viaDrillMm}
            onPick={onPickViaPreset}
          />
          <ViaSizeDropdown
            label="Ø"
            hotkeyTitle="Via diameter (route-time override)"
            activeMm={viaDiameterMm}
            defaultMm={viaDiameterDefaultMm}
            presets={viaDiameterPresets}
            onPick={onPickViaDiameter}
          />
          <ViaSizeDropdown
            label="⌀"
            hotkeyTitle="Via drill (route-time override)"
            activeMm={viaDrillMm}
            defaultMm={viaDrillDefaultMm}
            presets={viaDrillPresets}
            onPick={onPickViaDrill}
          />
        </>
      ) : null}
      <SegmentedControl
        size="sm"
        aria-label="Corner mode"
        options={[
          { id: "manhattan-45", label: "45°", title: "45° corners (Shift+Space)" },
          { id: "manhattan-90", label: "90°", title: "90° corners (Shift+Space)" },
        ]}
        value={segmentMode === "manhattan-90" ? "manhattan-90" : "manhattan-45"}
        onChange={(next) => {
          if (next !== segmentMode) onToggleSegmentMode();
        }}
      />
      <button
        type="button"
        onClick={onCyclePosture}
        title="Track posture: auto / axis-first / diagonal-first (/)"
        className={CHIP_CLASS}
      >
        {POSTURE_LABEL[posture]}
      </button>
      <span className={`${CHIP_CLASS} pointer-events-none`}>
        <span className="text-text-caps">Class</span>
        <span className="text-text-strong">{netClassName ?? "Default"}</span>
      </span>
      <span className="flex-1" />
      {status}
    </PcbParamRow>
  );
}
