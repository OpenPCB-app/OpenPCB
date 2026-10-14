import { formatShortcut } from "@shared/frontend/ui/shortcut";
import {
  ArrowRightFromLine,
  ChevronsDown,
  Frame,
  MessageSquarePlus,
  ScanSearch,
  Search,
  ShieldCheck,
  Undo2,
  Redo2,
  Zap,
} from "lucide-react";
import type { ReactElement } from "react";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
} from "@shared/frontend/ui/toolbar";

interface SchematicToolbarProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  /** Frame the current selection; disabled when nothing is selected. */
  onZoomToSelection?: () => void;
  canZoomToSelection?: boolean;
  onPlaceComponent?: () => void;
  onPlaceGnd?: () => void;
  onPlacePwr?: () => void;
  onPlaceNetPortal?: () => void;
  commentMode?: boolean;
  onToggleCommentMode?: () => void;
  /** Opens the right dock's ERC tab. */
  onOpenErc?: () => void;
  /** Outstanding ERC errors + warnings; omitted until a report exists. */
  ercCount?: number;
  /** Whether the dock is currently showing the ERC tab. */
  ercPanelOpen?: boolean;
}

/**
 * The schematic editor's docked 30px tool row (design D2 §4). Accessible names
 * and tooltips are frozen — "Fit schematic", "Undo" and "Redo" are e2e
 * locators.
 */
export function SchematicToolbar({
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onFit,
  onZoomToSelection,
  canZoomToSelection = false,
  onPlaceComponent,
  onPlaceGnd,
  onPlacePwr,
  onPlaceNetPortal,
  commentMode = false,
  onToggleCommentMode,
  onOpenErc,
  ercCount,
  ercPanelOpen = false,
}: SchematicToolbarProps): ReactElement {
  return (
    <Toolbar aria-label="Schematic tools">
      <ToolbarButton
        label="Undo"
        title={`Undo (${formatShortcut("Mod+Z")})`}
        icon={<Undo2 />}
        onClick={onUndo}
        disabled={!canUndo}
      />
      <ToolbarButton
        label="Redo"
        title={`Redo (${formatShortcut("Mod+Shift+Z")})`}
        icon={<Redo2 />}
        onClick={onRedo}
        disabled={!canRedo}
      />

      <ToolbarSeparator />

      <ToolbarButton
        label="Fit schematic"
        title="Fit"
        icon={<ScanSearch />}
        onClick={onFit}
      />
      {onZoomToSelection ? (
        <ToolbarButton
          label="Zoom to selection"
          icon={<Frame />}
          onClick={onZoomToSelection}
          disabled={!canZoomToSelection}
        />
      ) : null}

      {onPlaceComponent || onPlaceGnd || onPlacePwr || onPlaceNetPortal ? (
        <ToolbarSeparator />
      ) : null}

      {onPlaceComponent ? (
        <ToolbarButton
          label="Place component"
          title={`Place component (${formatShortcut("Mod+K")})`}
          icon={<Search />}
          onClick={onPlaceComponent}
        >
          Components
        </ToolbarButton>
      ) : null}
      {onPlaceGnd ? (
        <ToolbarButton
          label="Place GND port"
          title="Place GND port (G)"
          icon={<ChevronsDown />}
          onClick={onPlaceGnd}
        >
          GND
        </ToolbarButton>
      ) : null}
      {onPlacePwr ? (
        <ToolbarButton
          label="Place power port"
          title="Place power port (P)"
          icon={<Zap />}
          onClick={onPlacePwr}
        >
          PWR
        </ToolbarButton>
      ) : null}
      {onPlaceNetPortal ? (
        <ToolbarButton
          label="Place net portal"
          title="Place net portal (H)"
          icon={<ArrowRightFromLine />}
          onClick={onPlaceNetPortal}
        >
          Portal
        </ToolbarButton>
      ) : null}

      {onToggleCommentMode ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton
            label="Comment"
            title="Comment (C)"
            icon={<MessageSquarePlus />}
            pressable
            active={commentMode}
            onClick={onToggleCommentMode}
          >
            Comment
          </ToolbarButton>
        </>
      ) : null}

      {onOpenErc ? (
        <>
          <ToolbarSpacer />
          {/* Mirrors the PCB toolbar's DRC button: a dock-tab toggle whose
              count flags outstanding violations. */}
          <ToolbarButton
            label="ERC"
            title="Electrical rules check"
            icon={<ShieldCheck />}
            active={ercPanelOpen}
            pressable
            onClick={onOpenErc}
          >
            ERC
            {ercCount !== undefined && ercCount > 0 ? (
              <span className="font-mono text-2xs text-status-danger">
                {ercCount}
              </span>
            ) : null}
          </ToolbarButton>
        </>
      ) : null}
    </Toolbar>
  );
}
