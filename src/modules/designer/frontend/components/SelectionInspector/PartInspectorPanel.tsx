import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { BookOpen, CircuitBoard, Layers, Replace } from "lucide-react";
import type {
  DesignerPlacedPart,
  DesignerSchematicProjection,
  LibraryComponent,
  LibraryComponentFootprintVariant,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";
import { classifyNet, netClassTextClass } from "../../lib/net-class";
import { Button } from "@shared/frontend/ui/button";
import { Checkbox } from "@shared/frontend/ui/checkbox";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { PropertyGrid, PropertyRow } from "@shared/frontend/ui/property-grid";
import { TableHeaderRow, TableRow } from "@shared/frontend/ui/data-table";
import { PinElectricalIntentEditor } from "./PinElectricalIntentEditor";

const INPUT_CLASS =
  "h-[22px] w-full rounded-control border border-border-control bg-surface-input px-1.5 text-xs text-text-strong outline-none placeholder:text-text-disabled focus:border-selection";
const NUMBER_INPUT_CLASS = `${INPUT_CLASS} font-mono tabular-nums`;
const PIN_COLS = "28px 1fr 70px";

/** `PartPropertiesJson` is not re-exported from the SDK barrel. */
type PartProps = DesignerPlacedPart["propertiesJson"];

interface PartInspectorPanelProps {
  part: DesignerPlacedPart;
  projection: DesignerSchematicProjection;
  variants: readonly LibraryComponentFootprintVariant[];
  /** Library record behind the part; fallback source for the Fields rows. */
  component?: LibraryComponent | null;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
  onOpenInLibrary?(componentId: string): void;
  onCrossProbePcb?(): void;
  /** Opens the change-footprint flow for this part's component. */
  onChangeFootprint?(): void;
}

function readPropString(
  props: PartProps,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const raw = props[key];
    if (typeof raw === "string" && raw.trim().length > 0) return raw;
  }
  return null;
}

function readPropBoolean(props: PartProps, key: string): boolean {
  return props[key] === true;
}

/**
 * Merge a per-part field override, dropping the key entirely when cleared so
 * the library value takes over again instead of an empty string shadowing it.
 */
function mergeProp(
  props: PartProps,
  key: string,
  value: string,
): PartProps {
  const next: PartProps = { ...props };
  if (value.length === 0) delete next[key];
  else next[key] = value;
  return next;
}

/** Prefer the Electron shell for external links; fall back to a new tab. */
function openExternalUrl(url: string): void {
  const api = (
    window as unknown as {
      electronAPI?: { openExternal?: (target: string) => Promise<void> };
    }
  ).electronAPI;
  if (api?.openExternal) {
    void api.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
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
  projection,
  variants,
  component = null,
  dispatchCommand,
  setError,
  onOpenInLibrary,
  onCrossProbePcb,
  onChangeFootprint,
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
  const [refreshingFootprint, setRefreshingFootprint] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Fields: a per-part override in `propertiesJson` wins; otherwise the
  // library record behind the part. Same precedence the BOM writer applies.
  const props = part.propertiesJson;
  const mpnValue =
    readPropString(props, "manufacturerPartNumber", "mpn") ??
    component?.manufacturerPartNumber ??
    "";
  const manufacturerValue =
    readPropString(props, "manufacturer") ?? component?.manufacturer ?? "";
  const datasheetUrl =
    readPropString(props, "datasheetUrl", "datasheet") ??
    component?.datasheetUrl ??
    "";
  const dnp = readPropBoolean(props, "dnp");

  const [mpnDraft, setMpnDraft] = useState(mpnValue);
  const [manufacturerDraft, setManufacturerDraft] = useState(manufacturerValue);
  // Optimistic DNP so the checkbox flips instantly; reset from the projection
  // once the command round-trips, and on failure.
  const [dnpPending, setDnpPending] = useState<boolean | null>(null);
  const dnpChecked = dnpPending ?? dnp;

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
  useEffect(() => {
    setMpnDraft(mpnValue);
  }, [mpnValue]);
  useEffect(() => {
    setManufacturerDraft(manufacturerValue);
  }, [manufacturerValue]);
  useEffect(() => {
    setDnpPending(null);
  }, [dnp, part.id]);

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

  const commitField = useCallback(
    async (key: string, draft: string, current: string, label: string) => {
      const trimmed = draft.trim();
      if (trimmed === current) return;
      try {
        await dispatchCommand({
          type: "update_part_properties",
          partId: part.id,
          propertiesJson: mergeProp(part.propertiesJson, key, trimmed),
        });
      } catch (error) {
        setError(
          error instanceof Error ? error.message : `Failed to update ${label}`,
        );
        return current;
      }
      return undefined;
    },
    [dispatchCommand, part.id, part.propertiesJson, setError],
  );

  const commitMpn = useCallback(async () => {
    const revert = await commitField(
      "manufacturerPartNumber",
      mpnDraft,
      mpnValue,
      "MPN",
    );
    if (revert !== undefined) setMpnDraft(revert);
  }, [commitField, mpnDraft, mpnValue]);

  const commitManufacturer = useCallback(async () => {
    const revert = await commitField(
      "manufacturer",
      manufacturerDraft,
      manufacturerValue,
      "manufacturer",
    );
    if (revert !== undefined) setManufacturerDraft(revert);
  }, [commitField, manufacturerDraft, manufacturerValue]);

  const commitDnp = useCallback(
    async (next: boolean) => {
      setDnpPending(next);
      try {
        await dispatchCommand({
          type: "update_part_properties",
          partId: part.id,
          propertiesJson: { ...part.propertiesJson, dnp: next },
        });
      } catch (error) {
        setDnpPending(null);
        setError(
          error instanceof Error ? error.message : "Failed to update DNP",
        );
      }
    },
    [dispatchCommand, part.id, part.propertiesJson, setError],
  );

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

  const refreshFootprint = useCallback(async () => {
    setRefreshingFootprint(true);
    try {
      await dispatchCommand({
        type: "refresh_part_footprint",
        partIds: [part.id],
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Failed to update footprint from library",
      );
    } finally {
      setRefreshingFootprint(false);
    }
  }, [dispatchCommand, part.id, setError]);

  const pinNets = useMemo(() => {
    const rows = part.pins.map((pin) => ({
      pin,
      net:
        projection.nets.find((net) => net.pinIds.includes(pin.id))?.name ??
        null,
    }));
    rows.sort((a, b) => {
      const an = a.pin.number;
      const bn = b.pin.number;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      return an.localeCompare(bn, undefined, { numeric: true });
    });
    return rows;
  }, [part.pins, projection.nets]);

  return (
    <div className="flex flex-col">
      <PanelSectionHeader variant="uppercase" title="General" />
      <PropertyGrid>
        <PropertyRow label="Reference" mono title={part.reference}>
          {part.reference || "—"}
        </PropertyRow>
        <PropertyRow label="Value" className="h-[26px]">
          <input
            value={valueDraft}
            onChange={(event) => setValueDraft(event.target.value)}
            onBlur={() => void commitValue()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Value"
            placeholder={
              inferredKind === "generic"
                ? "—"
                : `e.g. 10${unitsForKind(inferredKind)[0] ?? ""}`
            }
            className={INPUT_CLASS}
          />
        </PropertyRow>
        {inferredKind !== "generic" ? (
          <PropertyRow label="Tolerance" className="h-[26px]">
            <input
              value={toleranceDraft}
              onChange={(event) => setToleranceDraft(event.target.value)}
              onBlur={() => void commitTolerance()}
              aria-label="Tolerance"
              placeholder="1%, 5%"
              className={INPUT_CLASS}
            />
          </PropertyRow>
        ) : null}
        <PropertyRow label="Footprint">
          <span className="flex min-w-0 items-center gap-1">
            <Layers className="h-3 w-3 shrink-0 text-text-tertiary" />
            <span
              className="min-w-0 flex-1 truncate font-mono text-2xs"
              title={currentVariant?.variantLabel ?? part.footprint.name}
            >
              {currentVariant?.variantLabel ?? part.footprint.name}
            </span>
            {onChangeFootprint ? (
              <button
                type="button"
                onClick={onChangeFootprint}
                className="shrink-0 cursor-pointer rounded-control border border-border-control px-1.5 text-2xs text-text hover:bg-surface-hover"
              >
                Change…
              </button>
            ) : null}
          </span>
        </PropertyRow>
        <PropertyRow label="Symbol" mono title={part.symbol.name}>
          {part.symbol.name}
        </PropertyRow>
      </PropertyGrid>

      {part.footprintStale ? (
        <div
          className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5"
          data-testid="footprint-stale-badge"
        >
          <span className="text-2xs leading-snug text-status-warning">
            Footprint updated in library
          </span>
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            disabled={refreshingFootprint}
            onClick={() => void refreshFootprint()}
          >
            {refreshingFootprint ? "Updating…" : "Update from library"}
          </Button>
        </div>
      ) : null}

      <PanelSectionHeader variant="uppercase" title="Attributes" />
      <div className="flex items-center border-b border-border px-2 py-1.5">
        <Checkbox
          checked={dnpChecked}
          onChange={(event) => void commitDnp(event.target.checked)}
          label="DNP (do not populate)"
          wrapperClassName="text-xs text-text"
        />
      </div>

      <PanelSectionHeader variant="uppercase" title="Fields" />
      <PropertyGrid>
        <PropertyRow label="MPN" className="h-[26px]">
          <input
            value={mpnDraft}
            onChange={(event) => setMpnDraft(event.target.value)}
            onBlur={() => void commitMpn()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="MPN"
            placeholder="—"
            className={`${INPUT_CLASS} font-mono`}
          />
        </PropertyRow>
        <PropertyRow label="Manufacturer" className="h-[26px]">
          <input
            value={manufacturerDraft}
            onChange={(event) => setManufacturerDraft(event.target.value)}
            onBlur={() => void commitManufacturer()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Manufacturer"
            placeholder="—"
            className={INPUT_CLASS}
          />
        </PropertyRow>
        <PropertyRow label="Datasheet" title={datasheetUrl || undefined}>
          {datasheetUrl ? (
            <a
              href={datasheetUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                openExternalUrl(datasheetUrl);
              }}
              className="block truncate text-text-secondary underline underline-offset-2 hover:text-text-strong"
            >
              {datasheetUrl}
            </a>
          ) : (
            "—"
          )}
        </PropertyRow>
      </PropertyGrid>

      <PanelSectionHeader variant="uppercase" title="Placement" />
      <PropertyGrid>
        <PropertyRow label="X" hint="mm" className="h-[26px]">
          <input
            value={xDraft}
            onChange={(event) => setXDraft(event.target.value)}
            onBlur={() => void commitPosition()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="X (mm)"
            className={NUMBER_INPUT_CLASS}
          />
        </PropertyRow>
        <PropertyRow label="Y" hint="mm" className="h-[26px]">
          <input
            value={yDraft}
            onChange={(event) => setYDraft(event.target.value)}
            onBlur={() => void commitPosition()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Y (mm)"
            className={NUMBER_INPUT_CLASS}
          />
        </PropertyRow>
        <PropertyRow label="Rotation" hint="°" className="h-[26px]">
          <input
            value={rotDraft}
            onChange={(event) => setRotDraft(event.target.value)}
            onBlur={() => void commitRotation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            aria-label="Rotation (°)"
            className={NUMBER_INPUT_CLASS}
          />
        </PropertyRow>
        <PropertyRow label="Mirrored">
          {part.mirrored ? "Yes" : "No"}
        </PropertyRow>
      </PropertyGrid>

      {pinNets.length > 0 ? (
        <>
          <PanelSectionHeader
            variant="uppercase"
            title="Pins"
            count={pinNets.length}
          />
          <TableHeaderRow cols={PIN_COLS}>
            <span>#</span>
            <span>Name · net</span>
            <span className="text-right">Type</span>
          </TableHeaderRow>
          {pinNets.map(({ pin, net }) => (
            <div key={pin.id}>
              <TableRow cols={PIN_COLS}>
                <span className="truncate font-mono text-2xs text-text-tertiary">
                  {pin.number ?? "·"}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-2xs">
                  <span className="truncate text-text-strong">{pin.name}</span>
                  <span
                    className={`min-w-0 truncate ${
                      net
                        ? netClassTextClass(classifyNet(net))
                        : "text-text-disabled"
                    }`}
                  >
                    {net ?? "—"}
                  </span>
                </span>
                <span className="truncate text-right text-2xs text-text-tertiary">
                  {pin.electricalType || "—"}
                </span>
              </TableRow>
              <PinElectricalIntentEditor
                pin={pin}
                dispatchCommand={dispatchCommand}
                setError={setError}
              />
            </div>
          ))}
        </>
      ) : null}

      <PanelSectionHeader variant="uppercase" title="Quick actions" />
      <div className="flex flex-col items-stretch gap-1 border-b border-border p-2">
        {onCrossProbePcb ? (
          <Button
            variant="secondary"
            size="sm"
            className="justify-start"
            onClick={onCrossProbePcb}
            icon={<CircuitBoard className="h-3 w-3 text-text-tertiary" />}
          >
            View on PCB
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="justify-start"
          disabled
          title="Replace component — coming in a future designer phase"
          icon={<Replace className="h-3 w-3" />}
        >
          Replace component
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="justify-start"
          onClick={() => onOpenInLibrary?.(part.componentId)}
          disabled={!onOpenInLibrary}
          icon={<BookOpen className="h-3 w-3 text-text-tertiary" />}
        >
          Open in Library
        </Button>
      </div>

      <PanelSectionHeader
        variant="uppercase"
        title="Advanced"
        collapsed={!advancedOpen}
        onToggle={() => setAdvancedOpen((prev) => !prev)}
      />
      {advancedOpen ? (
        <>
          <PropertyGrid>
            <PropertyRow label="Component" mono title={part.componentId}>
              {part.componentId}
            </PropertyRow>
            <PropertyRow label="Pins" mono>
              {part.pins.length}
            </PropertyRow>
          </PropertyGrid>
          {part.propertiesJson?.pcb?.staleReason ? (
            <p className="border-b border-border px-2 py-1 text-2xs leading-snug text-status-warning">
              PCB: {part.propertiesJson.pcb.staleReason}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
