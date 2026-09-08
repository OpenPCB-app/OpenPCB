import { useState, type ReactElement } from "react";
import type {
  DesignerPcbUpdateKeepoutCommand,
  DesignerPcbUpdateZoneCommand,
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbKeepoutRestrictions,
  PcbLayerCount,
  PcbOverlayText,
  PcbZone,
  PcbZoneIslandRemoval,
  PcbZoneNetRef,
  PcbZonePadConnection,
} from "../../../../sdks";
import { copperLayersForCount } from "../../../../sdks/designer";
import { PropertyGrid, PropertyRow } from "@shared/frontend/ui/property-grid";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { Button } from "@shared/frontend/ui/button";
import { netRefForPick } from "./tools/area-tool-options";

type PcbOverlayLayer =
  | "F.SilkS"
  | "B.SilkS"
  | "F.Fab"
  | "B.Fab"
  | "F.CrtYd"
  | "B.CrtYd"
  | "Edge.Cuts";

export type PcbInspectorSelection =
  | { kind: "freeHole"; hole: PcbFreeHole }
  | { kind: "freePad"; pad: PcbFreePad }
  | { kind: "overlayText"; text: PcbOverlayText }
  | { kind: "zone"; zone: PcbZone }
  | { kind: "keepout"; keepout: PcbKeepout }
  | null;

const FIELD_CLASS =
  "h-[18px] w-full min-w-0 rounded-control border border-border-control bg-surface-input px-1 text-xs text-text-strong outline-none focus:border-selection";

/**
 * Edit-then-commit numeric field. Escape reverts to the committed value
 * without dispatching; Enter (via blur) and blur commit.
 */
export function NumericField({
  label,
  value,
  unit,
  onCommit,
  min,
  step,
  readOnly = false,
}: {
  label: string;
  value: number;
  unit?: string;
  onCommit(v: number): void;
  min?: number;
  step?: number;
  /** Renders the value as plain text (no editable affordance). */
  readOnly?: boolean;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);

  const displayValue = draft ?? String(value);

  const commit = () => {
    const n = Number(draft ?? value);
    setDraft(null);
    if (Number.isFinite(n) && (min === undefined || n >= min) && n > 0) {
      onCommit(n);
    }
  };

  if (readOnly) {
    return (
      <PropertyRow label={label} mono hint={unit}>
        {value}
      </PropertyRow>
    );
  }

  return (
    <PropertyRow label={label} mono hint={unit}>
      <input
        type="number"
        value={displayValue}
        min={min}
        step={step ?? 0.1}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
          }
        }}
        className={`${FIELD_CLASS} text-right`}
      />
    </PropertyRow>
  );
}

function DeleteRow({
  label,
  onDelete,
  disabled = false,
}: {
  label: string;
  onDelete: () => void;
  /** A locked row rejects the delete command; do not offer it. */
  disabled?: boolean;
}): ReactElement {
  return (
    <div className="flex items-center px-2 py-2">
      <Button
        variant="danger"
        size="sm"
        className="w-full"
        onClick={onDelete}
        disabled={disabled}
      >
        {label}
      </Button>
    </div>
  );
}

export function FreeHolePanel({
  hole,
  onUpdate,
  onDelete,
}: {
  hole: PcbFreeHole;
  onUpdate: (patch: { drillMm?: number }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="Hole" />
      <PropertyGrid>
        <NumericField
          label="Drill"
          value={hole.drillMm}
          unit="mm"
          min={0.1}
          step={0.1}
          onCommit={(v) => void onUpdate({ drillMm: v })}
        />
        {/* Position is read-only until a move command exists for free holes. */}
        <NumericField
          label="X"
          value={hole.centerMm.x}
          unit="mm"
          readOnly
          onCommit={() => {}}
        />
        <NumericField
          label="Y"
          value={hole.centerMm.y}
          unit="mm"
          readOnly
          onCommit={() => {}}
        />
      </PropertyGrid>
      <DeleteRow label="Delete hole" onDelete={() => void onDelete()} />
    </div>
  );
}

const PAD_SHAPES = ["rect", "circle", "oval", "roundrect"] as const;
const COPPER_LAYERS: PcbCopperLayerId[] = ["F.Cu", "B.Cu", "In1.Cu", "In2.Cu"];

export function FreePadPanel({
  pad,
  onUpdate,
  onDelete,
}: {
  pad: PcbFreePad;
  onUpdate: (patch: {
    widthMm?: number;
    heightMm?: number;
    shape?: "rect" | "circle" | "oval" | "roundrect";
    layer?: PcbCopperLayerId;
    drillMm?: number | null;
    rotationDeg?: number;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="Pad" />
      <PropertyGrid>
        <PropertyRow label="Shape">
          <select
            value={pad.shape}
            aria-label="Shape"
            onChange={(e) =>
              void onUpdate({
                shape: e.target.value as
                  | "rect"
                  | "circle"
                  | "oval"
                  | "roundrect",
              })
            }
            className={FIELD_CLASS}
          >
            {PAD_SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </PropertyRow>
        <NumericField
          label="Width"
          value={pad.widthMm}
          unit="mm"
          min={0.05}
          step={0.1}
          onCommit={(v) => void onUpdate({ widthMm: v })}
        />
        <NumericField
          label="Height"
          value={pad.heightMm}
          unit="mm"
          min={0.05}
          step={0.1}
          onCommit={(v) => void onUpdate({ heightMm: v })}
        />
        <NumericField
          label="Rotation"
          value={pad.rotationDeg}
          unit="°"
          step={45}
          onCommit={(v) => void onUpdate({ rotationDeg: v })}
        />
        <PropertyRow label="Layer">
          <select
            value={pad.layer}
            aria-label="Layer"
            onChange={(e) =>
              void onUpdate({ layer: e.target.value as PcbCopperLayerId })
            }
            className={FIELD_CLASS}
          >
            {COPPER_LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </PropertyRow>
        {pad.padType === "hole" || pad.padType === "std" ? (
          <NumericField
            label="Drill"
            value={pad.drillMm ?? 0.8}
            unit="mm"
            min={0.1}
            step={0.1}
            onCommit={(v) => void onUpdate({ drillMm: v })}
          />
        ) : null}
      </PropertyGrid>
      <DeleteRow label="Delete pad" onDelete={() => void onDelete()} />
    </div>
  );
}

const OVERLAY_TEXT_LAYERS: Array<{ value: PcbOverlayLayer; label: string }> = [
  { value: "F.SilkS", label: "Top Overlay (F.SilkS)" },
  { value: "B.SilkS", label: "Bottom Overlay (B.SilkS)" },
];

export function OverlayTextPanel({
  text,
  onUpdate,
  onDelete,
}: {
  text: PcbOverlayText;
  onUpdate: (patch: {
    text?: string;
    fontSizeMm?: number;
    layer?: PcbOverlayLayer;
    rotationDeg?: number;
  }) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const [textDraft, setTextDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="Text" />
      <PropertyGrid>
        <PropertyRow label="Text">
          <input
            type="text"
            aria-label="Text"
            value={textDraft ?? text.text}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={() => {
              const val = textDraft?.trim();
              setTextDraft(null);
              if (val !== undefined && val.length > 0 && val !== text.text) {
                void onUpdate({ text: val });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") setTextDraft(null);
            }}
            className={FIELD_CLASS}
          />
        </PropertyRow>
        <NumericField
          label="Font size"
          value={text.fontSizeMm}
          unit="mm"
          min={0.2}
          step={0.2}
          onCommit={(v) => void onUpdate({ fontSizeMm: v })}
        />
        <PropertyRow label="Layer">
          <select
            value={text.layer}
            aria-label="Layer"
            onChange={(e) =>
              void onUpdate({ layer: e.target.value as PcbOverlayLayer })
            }
            className={FIELD_CLASS}
          >
            {OVERLAY_TEXT_LAYERS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </PropertyRow>
        <NumericField
          label="Rotation"
          value={text.rotationDeg}
          unit="°"
          step={45}
          onCommit={(v) => void onUpdate({ rotationDeg: v })}
        />
      </PropertyGrid>
      <DeleteRow label="Delete text" onDelete={() => void onDelete()} />
    </div>
  );
}

/**
 * Net picker for a zone, in the persisted `PcbZoneNetRef` shape: "" is "no
 * net" (both fields null), a named net persists as `{ netId: null, netName }`
 * and an unnamed one as `{ netId, netName: null }` (contract §12.2). The
 * current value maps back to the option whose name — or, for an unnamed net,
 * id — matches.
 */
export function NetSelect({
  value,
  nets,
  onChange,
  disabled = false,
  ariaLabel = "Net",
}: {
  value: PcbZoneNetRef;
  nets: ReadonlyArray<{ id: string; name: string }>;
  onChange: (next: PcbZoneNetRef) => void;
  disabled?: boolean;
  ariaLabel?: string;
}): ReactElement {
  // The projection binds names case-insensitively (trim + upper-case), so the
  // picker must find the same net the pour uses.
  const nameKey = value.netName?.trim().toUpperCase() ?? null;
  const pick =
    nameKey !== null
      ? (nets.find((n) => n.name.trim().toUpperCase() === nameKey)?.id ?? "")
      : (value.netId ?? "");
  return (
    <select
      value={pick}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(e) => onChange(netRefForPick(nets, e.target.value))}
      className={FIELD_CLASS}
    >
      <option value="">No net</option>
      {nets.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Edit-then-commit field for a NULLABLE number. Distinct from `NumericField`,
 * which rejects an empty value and zero: here an empty input is the clear
 * affordance and commits `null` (= "board default" for a zone override).
 */
export function OptionalNumericField({
  label,
  value,
  unit,
  min,
  step,
  placeholder = "Board default",
  disabled = false,
  onCommit,
}: {
  label: string;
  value: number | null;
  unit?: string;
  min?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  onCommit(v: number | null): void;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? (value === null ? "" : String(value));

  const commit = (): void => {
    const raw = draft;
    setDraft(null);
    if (raw === null) return;
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    if (min !== undefined && n < min) return;
    if (n !== value) onCommit(n);
  };

  return (
    <PropertyRow label={label} mono hint={unit}>
      <input
        type="number"
        value={displayValue}
        min={min}
        step={step ?? 0.1}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setDraft(null);
        }}
        className={`${FIELD_CLASS} text-right`}
      />
    </PropertyRow>
  );
}

function CheckboxRow({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <PropertyRow label={label}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer accent-[var(--selection)] disabled:cursor-not-allowed"
      />
    </PropertyRow>
  );
}

/** Edit-then-commit text field committing `null` for an empty value. */
function NameRow({
  value,
  disabled,
  onCommit,
}: {
  value: string | null;
  disabled: boolean;
  onCommit: (next: string | null) => void;
}): ReactElement {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <PropertyRow label="Name">
      <input
        type="text"
        aria-label="Name"
        value={draft ?? value ?? ""}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const raw = draft;
          setDraft(null);
          if (raw === null) return;
          const next = raw.trim() === "" ? null : raw.trim();
          if (next !== value) onCommit(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setDraft(null);
        }}
        className={FIELD_CLASS}
      />
    </PropertyRow>
  );
}

const ZONE_PAD_CONNECTIONS: Array<{
  value: PcbZonePadConnection;
  label: string;
}> = [
  { value: "solid", label: "Solid" },
  { value: "thermal", label: "Thermal relief" },
  { value: "thruHoleThermal", label: "Thermal (THT only)" },
  { value: "none", label: "No connection" },
];

const KEEPOUT_RESTRICTIONS: Array<{
  key: keyof PcbKeepoutRestrictions;
  label: string;
}> = [
  { key: "tracks", label: "Tracks" },
  { key: "vias", label: "Vias" },
  { key: "pads", label: "Pads" },
  { key: "copperPour", label: "Copper pour" },
  { key: "footprints", label: "Footprints" },
];

type IslandRemovalPick = "default" | "always" | "never" | "minArea";

function islandRemovalPick(v: PcbZoneIslandRemoval | undefined): IslandRemovalPick {
  if (v === undefined) return "default";
  if (v === "always") return "always";
  if (v === "never") return "never";
  return "minArea";
}

/**
 * Copper-zone inspector — every §2 field. Layer and region are fixed for a
 * board zone (the layers panel owns its lifecycle), and a locked row disables
 * everything except the lock toggle itself.
 */
export function ZonePanel({
  zone,
  nets,
  layerCount,
  onUpdate,
  onDelete,
}: {
  zone: PcbZone;
  nets: ReadonlyArray<{ id: string; name: string }>;
  layerCount: PcbLayerCount;
  onUpdate: (
    patch: Omit<DesignerPcbUpdateZoneCommand, "type" | "zoneId">,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const isBoard = zone.region.kind === "board";
  const locked = zone.lockedAt !== null;
  const stackup = copperLayersForCount(layerCount);
  const thermal = zone.thermal ?? null;
  const island = islandRemovalPick(zone.islandRemoval);
  return (
    <div className="flex flex-col">
      <PanelSectionHeader
        variant="uppercase"
        title={isBoard ? "Board zone" : "Zone"}
      />
      <PropertyGrid>
        <NameRow
          value={zone.name}
          disabled={locked}
          onCommit={(name) => void onUpdate({ name })}
        />
        <CheckboxRow
          label="Enabled"
          checked={zone.enabled}
          disabled={locked}
          onChange={(enabled) => void onUpdate({ enabled })}
        />
        <CheckboxRow
          label="Locked"
          checked={locked}
          onChange={(next) => void onUpdate({ locked: next })}
        />
        <PropertyRow label="Layer">
          <select
            value={zone.layer}
            aria-label="Layer"
            disabled={locked || isBoard}
            onChange={(e) =>
              void onUpdate({ layer: e.target.value as PcbCopperLayerId })
            }
            className={FIELD_CLASS}
          >
            {stackup.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </PropertyRow>
        <PropertyRow label="Net">
          <NetSelect
            value={{ netId: zone.netId, netName: zone.netName }}
            nets={nets}
            disabled={locked}
            onChange={(net) => void onUpdate({ net })}
          />
        </PropertyRow>
        <OptionalNumericField
          label="Priority"
          value={zone.priority}
          min={0}
          step={1}
          placeholder="0"
          disabled={locked || isBoard}
          onCommit={(v) => {
            if (v !== null) void onUpdate({ priority: Math.round(v) });
          }}
        />
        <PropertyRow label="Pads">
          <select
            value={zone.padConnection ?? "solid"}
            aria-label="Pad connection"
            disabled={locked}
            onChange={(e) =>
              void onUpdate({
                padConnection: e.target.value as PcbZonePadConnection,
              })
            }
            className={FIELD_CLASS}
          >
            {ZONE_PAD_CONNECTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </PropertyRow>
        <OptionalNumericField
          label="Clearance"
          value={zone.clearanceMm ?? null}
          unit="mm"
          min={0}
          step={0.05}
          disabled={locked}
          onCommit={(clearanceMm) => void onUpdate({ clearanceMm })}
        />
        <OptionalNumericField
          label="Min width"
          value={zone.minWidthMm ?? null}
          unit="mm"
          min={0}
          step={0.05}
          disabled={locked}
          onCommit={(minWidthMm) => void onUpdate({ minWidthMm })}
        />
        {/* `thermal` is both-or-nothing: clearing either member drops the pair. */}
        <OptionalNumericField
          label="Thermal gap"
          value={thermal?.gapMm ?? null}
          unit="mm"
          min={0}
          step={0.05}
          disabled={locked}
          onCommit={(v) =>
            void onUpdate({
              thermal:
                v === null
                  ? null
                  : { gapMm: v, spokeWidthMm: thermal?.spokeWidthMm ?? v },
            })
          }
        />
        <OptionalNumericField
          label="Spoke width"
          value={thermal?.spokeWidthMm ?? null}
          unit="mm"
          min={0}
          step={0.05}
          disabled={locked}
          onCommit={(v) =>
            void onUpdate({
              thermal:
                v === null
                  ? null
                  : { gapMm: thermal?.gapMm ?? v, spokeWidthMm: v },
            })
          }
        />
        <PropertyRow label="Islands">
          <select
            value={island}
            aria-label="Island removal"
            disabled={locked}
            onChange={(e) => {
              const pick = e.target.value as IslandRemovalPick;
              if (pick === "default") {
                // `undefined` would be dropped by JSON; `null` clears the override.
                void onUpdate({ islandRemoval: null });
                return;
              }
              if (pick === "minArea") {
                const current = zone.islandRemoval;
                void onUpdate({
                  islandRemoval: {
                    minAreaMm2:
                      typeof current === "object" ? current.minAreaMm2 : 0,
                  },
                });
                return;
              }
              void onUpdate({ islandRemoval: pick });
            }}
            className={FIELD_CLASS}
          >
            <option value="default">Board default</option>
            <option value="always">Remove always</option>
            <option value="never">Keep always</option>
            <option value="minArea">Min area…</option>
          </select>
        </PropertyRow>
        <ZoneCutoutRows zone={zone} disabled={locked} onUpdate={onUpdate} />
        {island === "minArea" ? (
          <OptionalNumericField
            label="Min area"
            value={
              typeof zone.islandRemoval === "object"
                ? zone.islandRemoval.minAreaMm2
                : null
            }
            unit="mm²"
            min={0}
            step={0.1}
            placeholder="0"
            disabled={locked}
            onCommit={(v) => {
              if (v !== null) void onUpdate({ islandRemoval: { minAreaMm2: v } });
            }}
          />
        ) : null}
      </PropertyGrid>
      {/* A board zone's lifecycle control is the layers-panel fill toggle. */}
      {isBoard ? null : (
        <DeleteRow
          label="Delete zone"
          onDelete={() => void onDelete()}
          disabled={locked}
        />
      )}
    </div>
  );
}

/**
 * "Cutouts: n" plus a Remove button per cutout (copper-pour contract §11).
 * Removing one dispatches `pcb_update_zone` with the region rebuilt without
 * that hole — the executor re-checks the whole region.
 */
function ZoneCutoutRows({
  zone,
  disabled,
  onUpdate,
}: {
  zone: PcbZone;
  disabled: boolean;
  onUpdate: (
    patch: Omit<DesignerPcbUpdateZoneCommand, "type" | "zoneId">,
  ) => Promise<void>;
}): ReactElement | null {
  if (zone.region.kind !== "polygon") return null;
  const holes = zone.region.holesMm ?? [];
  const pointsMm = zone.region.pointsMm;
  if (holes.length === 0) return null;
  return (
    <>
      <PropertyRow label="Cutouts">
        <span data-testid="zone-cutout-count" className="text-xs text-text-secondary">
          {holes.length}
        </span>
      </PropertyRow>
      {holes.map((hole, i) => (
        <PropertyRow key={`cutout-${i}`} label={`Cutout ${i + 1}`}>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={`Remove cutout ${i + 1}`}
            onClick={() => {
              const next = holes.filter((_, j) => j !== i);
              void onUpdate({
                region: {
                  kind: "polygon",
                  pointsMm: pointsMm.map((p) => ({ x: p.x, y: p.y })),
                  ...(next.length === 0
                    ? {}
                    : { holesMm: next.map((h) => h.map((p) => ({ ...p }))) }),
                },
              });
            }}
          >
            Remove
          </Button>
        </PropertyRow>
      ))}
    </>
  );
}

/** Keepout ("rule area") inspector — layers plus the five restriction flags. */
export function KeepoutPanel({
  keepout,
  layerCount,
  onUpdate,
  onDelete,
}: {
  keepout: PcbKeepout;
  layerCount: PcbLayerCount;
  onUpdate: (
    patch: Omit<DesignerPcbUpdateKeepoutCommand, "type" | "keepoutId">,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
}): ReactElement {
  const locked = keepout.lockedAt !== null;
  const stackup = copperLayersForCount(layerCount);
  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="Keepout" />
      <PropertyGrid>
        <NameRow
          value={keepout.name}
          disabled={locked}
          onCommit={(name) => void onUpdate({ name })}
        />
        <CheckboxRow
          label="Enabled"
          checked={keepout.enabled}
          disabled={locked}
          onChange={(enabled) => void onUpdate({ enabled })}
        />
        <CheckboxRow
          label="Locked"
          checked={locked}
          onChange={(next) => void onUpdate({ locked: next })}
        />
        <PropertyRow label="Layers">
          <span className="flex flex-wrap items-center gap-2">
            {stackup.map((l) => (
              <label
                key={l}
                className="flex cursor-pointer items-center gap-1 text-2xs text-text-secondary"
              >
                <input
                  type="checkbox"
                  aria-label={`Layer ${l}`}
                  checked={keepout.layers.includes(l)}
                  disabled={locked}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? stackup.filter(
                          (s) => s === l || keepout.layers.includes(s),
                        )
                      : keepout.layers.filter((s) => s !== l);
                    // A keepout with no layer restricts nothing — refuse.
                    if (next.length === 0) return;
                    void onUpdate({ layers: next });
                  }}
                  className="cursor-pointer accent-[var(--selection)]"
                />
                {l}
              </label>
            ))}
          </span>
        </PropertyRow>
        {KEEPOUT_RESTRICTIONS.map((r) => (
          <CheckboxRow
            key={r.key}
            label={`No ${r.label.toLowerCase()}`}
            checked={keepout.restrictions[r.key]}
            disabled={locked}
            onChange={(next) =>
              void onUpdate({
                restrictions: { ...keepout.restrictions, [r.key]: next },
              })
            }
          />
        ))}
      </PropertyGrid>
      <DeleteRow
        label="Delete keepout"
        onDelete={() => void onDelete()}
        disabled={locked}
      />
    </div>
  );
}
