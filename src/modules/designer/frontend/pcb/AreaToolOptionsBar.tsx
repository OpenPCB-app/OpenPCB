import type { ReactElement } from "react";
import type {
  PcbCopperLayerId,
  PcbKeepoutRestrictions,
  PcbLayerCount,
  PcbZonePadConnection,
} from "../../../../sdks";
import { copperLayersForCount } from "../../../../sdks/designer";
import type {
  KeepoutToolOptions,
  ZoneToolOptions,
} from "./tools/area-tool-options";
import { NetSelect } from "./PcbSelectionInspector";

const PAD_CONNECTIONS: Array<{ value: PcbZonePadConnection; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "thermal", label: "Thermal relief" },
  { value: "thruHoleThermal", label: "Thermal (THT only)" },
  { value: "none", label: "No connection" },
];

const RESTRICTIONS: Array<{ key: keyof PcbKeepoutRestrictions; label: string }> =
  [
    { key: "tracks", label: "Tracks" },
    { key: "vias", label: "Vias" },
    { key: "pads", label: "Pads" },
    { key: "copperPour", label: "Copper pour" },
    { key: "footprints", label: "Footprints" },
  ];

const SELECT_CLASS =
  "h-[20px] rounded-control border border-border-control bg-surface-input px-1 text-[11px] text-text-strong outline-none focus:border-selection";

/**
 * Options bar for the zone (Z) / keepout (K) draw tools — rendered next to the
 * sketch dimension readout while a ring is being drawn (contract §12.3). The
 * error line carries `checkAreaRing`'s reason when a close attempt is rejected;
 * the sketch stays open so the user can fix the ring.
 *
 * `target === "zoneHole"` is the Zone tool's cutout sub-mode (copper-pour
 * contract §11): the ring being drawn is subtracted from the selected zone, so
 * the layer / net / pad pickers do not apply and are replaced by the toggle.
 */
export function AreaToolOptionsBar({
  target,
  zoneOptions,
  onZoneChange,
  keepoutOptions,
  onKeepoutChange,
  layerCount,
  nets,
  error,
  cutoutMode = false,
  canCutout = false,
  onToggleCutout,
}: {
  target: "zone" | "keepout" | "zoneHole";
  zoneOptions: ZoneToolOptions;
  onZoneChange: (patch: Partial<ZoneToolOptions>) => void;
  keepoutOptions: KeepoutToolOptions;
  onKeepoutChange: (patch: Partial<KeepoutToolOptions>) => void;
  layerCount: PcbLayerCount;
  nets: ReadonlyArray<{ id: string; name: string }>;
  error: string | null;
  /** True while the cutout sub-mode is active. */
  cutoutMode?: boolean;
  /** False when no zone is selected — the toggle is offered but refuses. */
  canCutout?: boolean;
  onToggleCutout?: () => void;
}): ReactElement {
  const stackup = copperLayersForCount(layerCount);
  return (
    <div
      data-testid="area-tool-options"
      className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-col gap-1 rounded-control border border-border bg-surface-raised/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
    >
      {target === "zoneHole" ? (
        <div className="flex items-center gap-2 text-text-tertiary">
          <span>Cutout — click to place vertices, Enter to close</span>
          <CutoutToggle
            active
            canCutout={canCutout}
            onToggle={onToggleCutout}
          />
        </div>
      ) : target === "zone" ? (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-text-tertiary">
            Layer
            <select
              aria-label="Zone layer"
              value={zoneOptions.layer}
              onChange={(e) =>
                onZoneChange({ layer: e.target.value as PcbCopperLayerId })
              }
              className={SELECT_CLASS}
            >
              {stackup.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-1 text-text-tertiary">
            Net
            <NetSelect
              value={zoneOptions.net}
              nets={nets}
              ariaLabel="Zone net"
              onChange={(net) => onZoneChange({ net })}
            />
          </span>
          <label className="flex items-center gap-1 text-text-tertiary">
            Pads
            <select
              aria-label="Zone pad connection"
              value={zoneOptions.padConnection}
              onChange={(e) =>
                onZoneChange({
                  padConnection: e.target.value as PcbZonePadConnection,
                })
              }
              className={SELECT_CLASS}
            >
              {PAD_CONNECTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <CutoutToggle
            active={false}
            canCutout={canCutout}
            onToggle={onToggleCutout}
          />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary">Layers</span>
            {stackup.map((l) => (
              <label
                key={l}
                className="flex cursor-pointer items-center gap-1 text-text-secondary"
              >
                <input
                  type="checkbox"
                  aria-label={`Keepout layer ${l}`}
                  checked={keepoutOptions.layers.includes(l)}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? stackup.filter(
                          (s) => s === l || keepoutOptions.layers.includes(s),
                        )
                      : keepoutOptions.layers.filter((s) => s !== l);
                    // A keepout with no layer restricts nothing; keep the last one.
                    if (next.length === 0) return;
                    onKeepoutChange({ layers: next });
                  }}
                  className="accent-[var(--selection)]"
                />
                {l}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-tertiary">Forbid</span>
            {RESTRICTIONS.map((r) => (
              <label
                key={r.key}
                className="flex cursor-pointer items-center gap-1 text-text-secondary"
              >
                <input
                  type="checkbox"
                  aria-label={`Forbid ${r.label}`}
                  checked={keepoutOptions.restrictions[r.key]}
                  onChange={(e) =>
                    onKeepoutChange({
                      restrictions: {
                        ...keepoutOptions.restrictions,
                        [r.key]: e.target.checked,
                      },
                    })
                  }
                  className="accent-[var(--selection)]"
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>
      )}
      {error ? (
        <div data-testid="area-tool-error" className="text-status-warning">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/**
 * "Cutout" checkbox — enters / leaves the Zone-cutout sub-mode (Shift+Z). It
 * stays clickable with nothing selected so the refusal notice can explain what
 * is missing, rather than the control silently disappearing.
 */
function CutoutToggle({
  active,
  canCutout,
  onToggle,
}: {
  active: boolean;
  canCutout: boolean;
  onToggle?: () => void;
}): ReactElement | null {
  if (!onToggle) return null;
  return (
    <label
      className="flex cursor-pointer items-center gap-1 text-text-secondary"
      title={
        canCutout
          ? "Cut a hole in the selected zone (Shift+Z)"
          : "Select one unlocked polygon zone first (Shift+Z)"
      }
    >
      <input
        type="checkbox"
        aria-label="Cutout"
        checked={active}
        onChange={onToggle}
        className="accent-[var(--selection)]"
      />
      Cutout
    </label>
  );
}
