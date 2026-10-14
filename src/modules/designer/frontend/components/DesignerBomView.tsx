import { useFeatureFlag } from "@/feature-flags";
import { MANUFACTURING_UNAVAILABLE } from "../../shared/capability-policy";
import { useGlobalShortcut } from "@shared/frontend/keyboard/use-global-shortcut";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Package } from "lucide-react";
import type {
  BomLine,
  BomOverridePatch,
  BomProjection,
} from "../../../../sdks";
import { cn } from "@/lib/utils";
import { Button } from "@shared/frontend/ui/button";
import { Checkbox } from "@shared/frontend/ui/checkbox";
import { TableHeaderRow, TableRow } from "@shared/frontend/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/frontend/ui/dropdown-menu";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { PropertyGrid, PropertyRow } from "@shared/frontend/ui/property-grid";
import { SearchField } from "@shared/frontend/ui/search-field";
import { SegmentedControl } from "@shared/frontend/ui/segmented-control";
import { SeverityDiamond } from "@shared/frontend/ui/severity-diamond";
import { StatusBar, StatusSegment } from "@shared/frontend/ui/status-bar";
import { StatusDot, type StatusTone } from "@shared/frontend/ui/status-dot";
import { Textarea } from "@shared/frontend/ui/textarea";
import { createDesignerApi } from "../api";

type SortKey = "refs" | "value" | "footprint" | "qty" | "mpn" | "lcsc";
type FilterKey = "all" | "missing-mpn" | "dnp";

const ORDER_QTYS = [1, 5, 10, 50, 100];

const isMac =
  typeof navigator !== "undefined" &&
  navigator.platform.toUpperCase().includes("MAC");
const EXPORT_HOTKEY_LABEL = isMac ? "⌘E" : "Ctrl+E";

/*
 * BOM table column grid (design D3 §3, handoff "3c BOM"):
 * checkbox · tier dot · Designators · Value · Footprint · Description · Qty · MPN · Unit · Ext.
 */
const COLS = "24px 28px 1fr 110px 140px 1.2fr 40px 150px 56px 70px";

type Severity = "sourced" | "suggested" | "critical" | "review" | "dnp";

/** Match-tier presentation per line severity (design D3 §3). */
const TIERS: Record<Severity, { tone: StatusTone; label: string }> = {
  sourced: { tone: "success", label: "Exact" },
  suggested: { tone: "warning", label: "Suggested" },
  critical: { tone: "danger", label: "Missing" },
  review: { tone: "danger", label: "Missing" },
  dnp: { tone: "neutral", label: "Do not populate" },
};

const TIER_LEGEND: { tone: StatusTone; label: string; description: string }[] =
  [
    {
      tone: "success",
      label: "Exact",
      description: "MPN set and verified against supplier",
    },
    {
      tone: "warning",
      label: "Suggested",
      description: "inferred from value + footprint, confirm before order",
    },
    {
      tone: "danger",
      label: "Missing",
      description: "no MPN, excluded from estimate",
    },
  ];

// Component classes whose missing MPN is high-risk (cannot assemble / manual sourcing).
const CRITICAL_PREFIXES = ["U", "Q", "J", "P", "Y", "X", "SW", "K", "T"];

function refClass(row: BomLine): string {
  const first = row.refs[0]?.refdes ?? row.refdesList;
  return (first.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
}

/** Severity is derived from component class (no JLCPCB data yet — Phase 2). */
function severityOf(row: BomLine): Severity {
  if (row.dnp) return "dnp";
  if (row.warnings.length === 0) return "sourced";
  const cls = refClass(row);
  if (CRITICAL_PREFIXES.includes(cls)) return "critical";
  if (["R", "C", "L", "D"].includes(cls)) return "suggested";
  return "review";
}

function hasPartNumber(row: BomLine): boolean {
  return Boolean(row.manufacturerPartNumber || row.lcscPartNumber);
}

interface DesignerBomViewProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  revision: number | null;
  onShowSchematic(partIds: string[]): void;
  onShowPcb(placementIds: string[]): void;
}

export function DesignerBomView({
  backendURL,
  moduleId,
  designId,
  revision,
  onShowSchematic,
  onShowPcb,
}: DesignerBomViewProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const [bom, setBom] = useState<BomProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [orderQty, setOrderQty] = useState(5);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "refs",
    dir: 1,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    bom?.rows.find((row) => row.id === selectedId) ?? bom?.rows[0] ?? null;

  const allRows = bom?.rows ?? [];
  const counts = useMemo(
    () => ({
      all: allRows.length,
      missingMpn: allRows.filter((r) => !hasPartNumber(r)).length,
      dnp: allRows.filter((r) => r.dnp).length,
    }),
    [allRows],
  );
  const missingMpnCount = allRows.filter(
    (r) => !r.dnp && !hasPartNumber(r),
  ).length;

  useEffect(() => {
    if (!designId) {
      setBom(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api
      .getBom(designId)
      .then((next) => {
        if (cancelled) return;
        setBom(next);
        setSelectedId((current) => current ?? next.rows[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, designId, revision]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out = (bom?.rows ?? []).filter((row) => {
      if (filter === "missing-mpn" && hasPartNumber(row)) return false;
      if (filter === "dnp" && !row.dnp) return false;
      if (!needle) return true;
      return [
        row.refdesList,
        row.value,
        row.footprint,
        row.manufacturer ?? "",
        row.manufacturerPartNumber ?? "",
        row.lcscPartNumber ?? "",
        row.notes ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
    out.sort((a, b) => compareRows(a, b, sort.key) * sort.dir);
    return out;
  }, [bom?.rows, query, filter, sort]);

  /** In-table totals describe the rows currently on screen. */
  const totals = useMemo(() => {
    let parts = 0;
    let extended = 0;
    let withoutMpn = 0;
    let excluded = 0;
    for (const row of rows) {
      parts += row.quantity;
      if (row.dnp) continue;
      if (!hasPartNumber(row)) withoutMpn += 1;
      if (row.unitPrice != null) extended += row.unitPrice * row.quantity;
      else excluded += 1;
    }
    return { parts, extended, withoutMpn, excluded };
  }, [rows]);

  function toggleCheckAll(): void {
    setCheckedIds((current) =>
      current.size === rows.length && rows.length > 0
        ? new Set()
        : new Set(rows.map((r) => r.id)),
    );
  }

  function toggleCheck(id: string): void {
    setCheckedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function markCheckedDnp(dnp: boolean): Promise<void> {
    if (!designId) return;
    const targets = allRows.filter((r) => checkedIds.has(r.id));
    for (const row of targets) {
      const refdes = row.refs[0]?.refdes;
      if (!refdes) continue;
      const result = await api.updateBomOverride(designId, refdes, { dnp });
      if (result.bom) setBom(result.bom);
    }
    setCheckedIds(new Set());
  }

  function toggleSort(key: SortKey): void {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 1 ? -1 : 1 }
        : { key, dir: 1 },
    );
  }

  async function updateSelected(patch: BomOverridePatch): Promise<void> {
    if (!designId || !selected) return;
    const refdes = selected.refs[0]?.refdes;
    if (!refdes) return;
    const result = await api.updateBomOverride(designId, refdes, patch);
    if (result.bom) setBom(result.bom);
  }

  async function exportArtifact(
    kind: "csv" | "tsv" | "jlc" | "kicad" | "pnp",
  ): Promise<void> {
    if (!designId) return;
    await api.downloadBomArtifact(designId, kind);
  }

  async function copyTsv(): Promise<void> {
    const text = buildClientTsv(rows);
    await navigator.clipboard.writeText(text);
  }

  useGlobalShortcut("Mod+E", () => {
    if (!designId) return false;
    void exportArtifact("csv");
  });

  if (!designId) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-app text-xs text-text-tertiary">
        Open a design to view its BOM.
      </div>
    );
  }

  const inspector = (
    <BomInspector
      row={selected}
      onUpdate={updateSelected}
      onShowSchematic={() =>
        selected &&
        onShowSchematic(selected.refs.map((ref) => ref.partId).filter(isString))
      }
      onShowPcb={() =>
        selected &&
        onShowPcb(selected.refs.map((ref) => ref.placementId).filter(isString))
      }
    />
  );

  const filterOptions = [
    { id: "all" as FilterKey, label: `All ${counts.all}` },
    {
      id: "missing-mpn" as FilterKey,
      label: `Missing MPN ${counts.missingMpn}`,
    },
    { id: "dnp" as FilterKey, label: `DNP ${counts.dnp}` },
  ];
  const allChecked = checkedIds.size > 0 && checkedIds.size === rows.length;
  const estCost = bom?.summary.estimatedCost ?? null;
  const currency = bom?.summary.currency ?? null;
  const sortGlyph = sort.key === "refs" ? (sort.dir === 1 ? "▴" : "▾") : "";

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-surface-app text-text">
      <section className="grid min-h-0 grid-rows-[auto_auto_1fr_auto_auto]">
        {/* Toolbar: filter tabs · search · export */}
        <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-border bg-surface-panel px-[10px]">
          <SegmentedControl
            aria-label="BOM filter"
            options={filterOptions}
            value={filter}
            onChange={setFilter}
          />
          <SearchField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter ref, value, MPN…"
            autoComplete="off"
            aria-label="Filter BOM lines"
            containerClassName="w-[220px]"
          />
          <div className="flex-1" />
          <ExportMenu onExport={exportArtifact} onCopyTsv={copyTsv} />
        </div>

        {/* Column header / bulk action bar */}
        {checkedIds.size > 0 ? (
          <div className="flex h-[24px] shrink-0 items-center gap-2 border-b border-border bg-surface-selected px-[10px] text-2xs">
            <span className="text-text-strong">{checkedIds.size} selected</span>
            <Button size="sm" onClick={() => void markCheckedDnp(true)}>
              Mark DNP
            </Button>
            <Button size="sm" onClick={() => void markCheckedDnp(false)}>
              Clear DNP
            </Button>
            <button
              type="button"
              onClick={() => setCheckedIds(new Set())}
              className="ml-auto text-text-tertiary outline-none hover:text-text-strong"
            >
              Clear selection
            </button>
          </div>
        ) : (
          <TableHeaderRow cols={COLS}>
            <Checkbox
              checked={allChecked}
              onChange={toggleCheckAll}
              aria-label="Select all"
            />
            <span />
            <button
              type="button"
              onClick={() => toggleSort("refs")}
              className="flex items-center gap-1 text-left uppercase outline-none hover:text-text-strong"
            >
              Designators <span aria-hidden="true">{sortGlyph}</span>
            </button>
            <span>Value</span>
            <span>Footprint</span>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span>MPN</span>
            <span className="text-right">Unit</span>
            <span className="text-right">Ext.</span>
          </TableHeaderRow>
        )}

        {/* Rows */}
        <div className="min-h-0 overflow-auto">
          {error ? (
            <div className="p-3 text-xs text-status-danger">{error}</div>
          ) : null}
          {loading ? (
            <div className="p-3 text-xs text-text-tertiary">Loading BOM…</div>
          ) : null}
          {rows.map((row) => (
            <BomRow
              key={row.id}
              row={row}
              selected={row.id === selected?.id}
              checked={checkedIds.has(row.id)}
              onSelect={() => setSelectedId(row.id)}
              onCheck={() => toggleCheck(row.id)}
              currency={currency}
            />
          ))}
          {!loading && !error && rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-text-tertiary">
              No BOM lines match the current filter.
            </div>
          ) : null}
        </div>

        {/* In-table totals row */}
        <div
          style={{ gridTemplateColumns: COLS }}
          className="grid h-[24px] shrink-0 items-center gap-2 border-t border-border bg-surface-panel px-[10px] font-mono text-2xs text-text-secondary"
        >
          <span
            style={{ gridColumn: "3 / span 4" }}
            className="truncate font-sans"
          >
            {rows.length} {rows.length === 1 ? "line" : "lines"} ·{" "}
            {totals.parts} parts · {totals.withoutMpn} without MPN
          </span>
          <span className="text-right text-text-strong">{totals.parts}</span>
          <span className="truncate font-sans text-text-tertiary">
            {totals.excluded > 0
              ? `estimate excludes ${totals.excluded} ${
                  totals.excluded === 1 ? "line" : "lines"
                }`
              : ""}
          </span>
          <span />
          <span className="text-right text-text-strong">
            {money(totals.extended, currency)}
          </span>
        </div>

        {/* Page footer bar */}
        <StatusBar>
          <StatusSegment>lines {bom?.summary.lineCount ?? 0}</StatusSegment>
          <StatusSegment>parts {bom?.summary.partCount ?? 0}</StatusSegment>
          <StatusSegment>
            <span>
              est.{" "}
              {money(estCost === null ? null : estCost * orderQty, currency)} @{" "}
              {orderQty} {orderQty === 1 ? "board" : "boards"}
            </span>
            <select
              value={orderQty}
              onChange={(e) => setOrderQty(Number(e.target.value))}
              aria-label="Order quantity"
              className="h-4 rounded-control border border-border-control bg-surface-input px-1 font-mono text-2xs text-text-strong outline-none"
            >
              {ORDER_QTYS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </StatusSegment>
          <StatusSegment flex sans className="text-text-tertiary">
            Click a line to edit sourcing · {EXPORT_HOTKEY_LABEL} export
          </StatusSegment>
          <StatusSegment>
            <SeverityDiamond severity="error" />
            {missingMpnCount} missing MPN
          </StatusSegment>
          {revision !== null ? (
            <StatusSegment sans className="text-text">
              Synced with schematic r{revision}
            </StatusSegment>
          ) : null}
        </StatusBar>
      </section>

      <aside className="flex h-full min-h-0 flex-col border-l border-border bg-surface-panel">
        <div className="min-h-0 flex-1 overflow-hidden">{inspector}</div>
      </aside>
    </div>
  );
}

function BomRow({
  row,
  selected,
  checked,
  onSelect,
  onCheck,
  currency,
}: {
  row: BomLine;
  selected: boolean;
  checked: boolean;
  onSelect(): void;
  onCheck(): void;
  currency: string | null;
}): ReactElement {
  const tier = TIERS[severityOf(row)];
  const partNumber = row.manufacturerPartNumber ?? row.lcscPartNumber ?? null;
  const ext = row.unitPrice != null ? row.unitPrice * row.quantity : null;
  return (
    <TableRow
      cols={COLS}
      height={24}
      selected={selected}
      onClick={onSelect}
      className="cursor-pointer"
    >
      <span className="flex" onClick={(event) => event.stopPropagation()}>
        <Checkbox
          checked={checked}
          onChange={onCheck}
          aria-label={`Select ${row.refdesList}`}
        />
      </span>
      <span className="flex justify-center">
        <StatusDot tone={tier.tone} title={tier.label} />
      </span>
      <span
        className={cn(
          "truncate font-mono text-[10.5px] text-text-strong",
          row.dnp && "text-text-tertiary line-through",
        )}
        title={row.refdesList}
      >
        {row.refdesList}
      </span>
      <span className="truncate" title={row.value}>
        {row.value || "—"}
      </span>
      <span
        className="truncate font-mono text-2xs text-text-secondary"
        title={row.footprint}
      >
        {row.footprint || "—"}
      </span>
      <span
        className="truncate text-text-secondary"
        title={row.description ?? ""}
      >
        {row.description ?? ""}
      </span>
      <span className="text-right font-mono text-text-strong">
        {row.quantity}
      </span>
      {partNumber ? (
        <span
          className="truncate font-mono text-2xs text-text-secondary"
          title={
            row.manufacturerPartNumber && row.lcscPartNumber
              ? `${row.manufacturerPartNumber} · ${row.lcscPartNumber}`
              : partNumber
          }
        >
          {partNumber}
        </span>
      ) : (
        <span className="truncate font-mono text-2xs italic text-status-danger">
          Add part number
        </span>
      )}
      <span className="text-right font-mono text-2xs text-text-secondary">
        {row.unitPrice == null ? "—" : money(row.unitPrice, currency, 3)}
      </span>
      <span className="text-right font-mono text-2xs text-text">
        {ext === null ? "—" : money(ext, currency)}
      </span>
    </TableRow>
  );
}

function BomInspector({
  row,
  onUpdate,
  onShowSchematic,
  onShowPcb,
}: {
  row: BomLine | null;
  onUpdate(patch: BomOverridePatch): Promise<void>;
  onShowSchematic(): void;
  onShowPcb(): void;
}): ReactElement {
  const [draft, setDraft] = useState<BomOverridePatch>({});
  const [lastSaved, setLastSaved] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  useEffect(() => {
    const next = {
      manufacturer: row?.manufacturer ?? null,
      manufacturerPartNumber: row?.manufacturerPartNumber ?? null,
      lcscPartNumber: row?.lcscPartNumber ?? null,
      supplier: row?.supplier ?? null,
      unitPrice: row?.unitPrice ?? null,
      currency: row?.currency ?? "USD",
      dnp: row?.dnp ?? false,
      assemblySide:
        row?.assemblySide === "mixed" ? null : (row?.assemblySide ?? null),
      notes: row?.notes ?? null,
    } satisfies BomOverridePatch;
    setDraft(next);
    setLastSaved(stablePatchKey(next));
    setSaveState("idle");
  }, [row]);

  useEffect(() => {
    if (!row) return;
    const normalized = normalizePatch(draft);
    const nextKey = stablePatchKey(normalized);
    if (nextKey === lastSaved) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void onUpdate(normalized)
        .then(() => {
          setLastSaved(nextKey);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [draft, lastSaved, onUpdate, row]);

  if (!row) {
    return (
      <div className="flex h-full flex-col bg-surface-panel">
        <div className="p-3 text-xs text-text-tertiary">
          No BOM row selected.
        </div>
        <div className="flex-1" />
        <TierLegend />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      {/* Header */}
      <div className="flex h-[28px] shrink-0 items-center gap-2 border-b border-border px-2">
        <Package
          aria-hidden="true"
          className="h-[13px] w-[13px] shrink-0 text-text-tertiary"
        />
        <span
          className="min-w-0 truncate font-mono text-sm font-medium text-text-strong"
          title={row.refdesList}
        >
          {row.refdesList}
        </span>
        <span className="shrink-0 text-2xs text-text-tertiary">
          {row.quantity} {row.quantity === 1 ? "part" : "parts"}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onShowSchematic}
          className="shrink-0 text-2xs text-text-secondary underline outline-none hover:text-text-strong"
        >
          Show in schematic
        </button>
        <button
          type="button"
          onClick={onShowPcb}
          className="shrink-0 text-2xs text-text-secondary underline outline-none hover:text-text-strong"
        >
          PCB
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <PanelSectionHeader variant="uppercase" title="Line" />
        <PropertyGrid>
          <PropertyRow label="Value">{row.value || "—"}</PropertyRow>
          <PropertyRow label="Footprint" mono title={row.footprint}>
            {row.footprint || "—"}
          </PropertyRow>
          <PropertyRow label="Description" title={row.description ?? ""}>
            {row.description ?? (
              <span className="italic text-text-tertiary">No description</span>
            )}
          </PropertyRow>
          <PropertyRow label="Quantity" mono>
            {row.quantity}
          </PropertyRow>
          <PropertyRow label="DNP">
            <Checkbox
              checked={draft.dnp === true}
              onChange={(event) =>
                setDraft({ ...draft, dnp: event.target.checked })
              }
              label="Do not populate"
              wrapperClassName="text-2xs text-text-secondary"
            />
          </PropertyRow>
        </PropertyGrid>

        <PanelSectionHeader variant="uppercase" title="Sourcing" />
        <PropertyGrid>
          <RailField
            label="MPN"
            mono
            value={draft.manufacturerPartNumber ?? ""}
            onChange={(v) => setDraft({ ...draft, manufacturerPartNumber: v })}
            placeholder="Add part number"
          />
          <RailField
            label="Manufacturer"
            value={draft.manufacturer ?? ""}
            onChange={(v) => setDraft({ ...draft, manufacturer: v })}
          />
          <RailField
            label="Supplier"
            value={draft.supplier ?? ""}
            onChange={(v) => setDraft({ ...draft, supplier: v })}
          />
          <RailField
            label="Supplier PN"
            mono
            value={draft.lcscPartNumber ?? ""}
            onChange={(v) => setDraft({ ...draft, lcscPartNumber: v })}
          />
          <RailField
            label="Unit price"
            mono
            inputMode="decimal"
            value={draft.unitPrice?.toString() ?? ""}
            onChange={(v) =>
              setDraft({ ...draft, unitPrice: v ? Number(v) : null })
            }
            hint="@ 1"
          />
          <RailField
            label="Currency"
            mono
            value={draft.currency ?? ""}
            onChange={(v) => setDraft({ ...draft, currency: v })}
          />
        </PropertyGrid>

        <PanelSectionHeader variant="uppercase" title="Assembly" />
        <PropertyGrid>
          <PropertyRow label="Side" valueClassName="px-0">
            <select
              value={draft.assemblySide ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  assemblySide:
                    event.target.value === ""
                      ? null
                      : (event.target.value as "top" | "bottom"),
                })
              }
              aria-label="Assembly side"
              className="h-[22px] w-full min-w-0 border border-border-control bg-surface-input px-2 text-xs text-text-strong outline-none focus:border-selection"
            >
              <option value="">Auto</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </PropertyRow>
        </PropertyGrid>

        <PanelSectionHeader variant="uppercase" title="Notes" />
        <div className="p-2">
          <Textarea
            value={draft.notes ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, notes: event.target.value })
            }
            aria-label="Notes"
            placeholder="Not set"
            className="min-h-[56px]"
          />
        </div>

        {row.warnings.length > 0 ? (
          <div className="mx-2 mb-2 bg-status-warning-soft p-2 text-2xs text-status-warning">
            {row.warnings.join(" · ")}
          </div>
        ) : null}

        <TierLegend />
      </div>

      <div className="shrink-0 border-t border-border px-2 py-1.5 text-2xs">
        <AutosaveState state={saveState} />
      </div>
    </div>
  );
}

/** Match-tier legend (design D3 §3). */
function TierLegend(): ReactElement {
  return (
    <>
      <PanelSectionHeader variant="uppercase" title="Match tier" />
      <div className="grid gap-1.5 px-[10px] py-2 text-2xs text-text-secondary">
        {TIER_LEGEND.map((tier) => (
          <div key={tier.label} className="flex items-start gap-2">
            <StatusDot tone={tier.tone} className="mt-1" />
            <span className="shrink-0 text-text-strong">{tier.label}</span>
            <span className="min-w-0 text-text-tertiary">
              {tier.description}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function RailField({
  label,
  value,
  onChange,
  mono = false,
  placeholder = "Not set",
  inputMode,
  hint,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  mono?: boolean;
  placeholder?: string;
  inputMode?: "decimal" | "text";
  hint?: ReactElement | string;
}): ReactElement {
  return (
    <PropertyRow label={label} valueClassName="px-0" hint={hint}>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        className={cn(
          "h-[22px] w-full min-w-0 border border-border-control bg-surface-input px-2 text-xs text-text-strong",
          "outline-none placeholder:text-text-disabled focus:border-selection",
          mono && "font-mono",
        )}
      />
    </PropertyRow>
  );
}

function ExportMenu({
  onExport,
  onCopyTsv,
}: {
  onExport(kind: "csv" | "tsv" | "jlc" | "kicad" | "pnp"): Promise<void>;
  onCopyTsv(): Promise<void>;
}): ReactElement {
  const quarantined = useFeatureFlag("designer.outputQuarantine");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary">Export ▾</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => void onExport("csv")}>
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void onCopyTsv()}>
          Copy TSV
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void onExport("jlc")}
          className="justify-between"
        >
          JLC BOM
          <span className="text-2xs text-status-warning">experimental</span>
        </DropdownMenuItem>
        {quarantined ? (
          <DropdownMenuItem disabled title={MANUFACTURING_UNAVAILABLE}>
            PnP unavailable: placement coordinates unqualified
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => void onExport("pnp")}>
            PnP
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => void onExport("kicad")}>
          KiCad CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AutosaveState({
  state,
}: {
  state: "idle" | "saving" | "saved" | "error";
}): ReactElement {
  const label =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? "Autosave failed"
          : "Autosaves changes";
  const color =
    state === "error"
      ? "text-status-danger"
      : state === "saved"
        ? "text-status-success"
        : "text-text-tertiary";
  return <div className={color}>{label}</div>;
}

function normalizePatch(patch: BomOverridePatch): BomOverridePatch {
  return {
    manufacturer: emptyToNull(patch.manufacturer),
    manufacturerPartNumber: emptyToNull(patch.manufacturerPartNumber),
    lcscPartNumber: emptyToNull(patch.lcscPartNumber),
    supplier: emptyToNull(patch.supplier),
    unitPrice: Number.isFinite(patch.unitPrice)
      ? (patch.unitPrice ?? null)
      : null,
    currency: emptyToNull(patch.currency),
    dnp: patch.dnp ?? false,
    assemblySide: patch.assemblySide ?? null,
    notes: emptyToNull(patch.notes),
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function stablePatchKey(patch: BomOverridePatch): string {
  return JSON.stringify(normalizePatch(patch));
}

function compareRows(a: BomLine, b: BomLine, key: SortKey): number {
  switch (key) {
    case "qty":
      return a.quantity - b.quantity;
    case "value":
      return a.value.localeCompare(b.value, undefined, { numeric: true });
    case "footprint":
      return a.footprint.localeCompare(b.footprint, undefined, {
        numeric: true,
      });
    case "mpn":
      return (a.manufacturerPartNumber ?? "").localeCompare(
        b.manufacturerPartNumber ?? "",
        undefined,
        { numeric: true },
      );
    case "lcsc":
      return (a.lcscPartNumber ?? "").localeCompare(
        b.lcscPartNumber ?? "",
        undefined,
        { numeric: true },
      );
    case "refs":
      return a.refdesList.localeCompare(b.refdesList, undefined, {
        numeric: true,
      });
  }
}

/** `$1.234` for USD (or no currency), `EUR 1.23` otherwise. */
function money(
  value: number | null,
  currency: string | null,
  digits = 2,
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const code = currency?.toUpperCase() ?? "";
  const prefix = code === "" || code === "USD" ? "$" : `${currency} `;
  return `${prefix}${value.toFixed(digits)}`;
}

function buildClientTsv(rows: readonly BomLine[]): string {
  return [
    [
      "Designators",
      "Qty",
      "Value",
      "Footprint",
      "Manufacturer",
      "MPN",
      "LCSC/JLC",
    ].join("\t"),
    ...rows.map((row) =>
      [
        row.refdesList,
        row.quantity,
        row.value,
        row.footprint,
        row.manufacturer ?? "",
        row.manufacturerPartNumber ?? "",
        row.lcscPartNumber ?? "",
      ].join("\t"),
    ),
  ].join("\n");
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
