import {
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Check,
  ChevronDown,
  CircleSlash,
  Info,
  Search,
  Sparkles,
} from "lucide-react";
import type {
  BomLine,
  BomOverridePatch,
  BomProjection,
} from "../../../../sdks";
import { Chip } from "@shared/frontend/ui/chip";
import { createDesignerApi } from "../api";

type SortKey = "refs" | "value" | "footprint" | "qty" | "mpn" | "lcsc";
type FilterKey = "all" | "unsourced" | "sourced" | "dnp";

const ORDER_QTYS = [1, 5, 10, 50, 100];

// BOM table column grid (checkbox · status · ref · qty · value · mpn+source · cost).
const COLS =
  "grid grid-cols-[24px_36px_minmax(56px,84px)_40px_minmax(56px,88px)_minmax(0,1fr)_76px] items-center gap-2 px-3.5";

type Severity = "sourced" | "suggested" | "critical" | "review" | "dnp";

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

function isSourced(row: BomLine): boolean {
  return !row.dnp && row.warnings.length === 0;
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
      unsourced: allRows.filter((r) => !r.dnp && r.warnings.length > 0).length,
      sourced: allRows.filter((r) => isSourced(r)).length,
      dnp: allRows.filter((r) => r.dnp).length,
    }),
    [allRows],
  );
  const sourceable = allRows.filter((r) => !r.dnp).length;
  const sourcedPct =
    sourceable > 0 ? Math.round((counts.sourced / sourceable) * 100) : 0;

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
      if (filter === "unsourced" && !(row.warnings.length > 0 && !row.dnp))
        return false;
      if (filter === "sourced" && !isSourced(row)) return false;
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

  if (!designId) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-slate-400">
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

  const filterChips: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "unsourced", label: "Unsourced", count: counts.unsourced },
    { key: "sourced", label: "Sourced", count: counts.sourced },
    { key: "dnp", label: "DNP", count: counts.dnp },
  ];
  const allChecked = checkedIds.size > 0 && checkedIds.size === rows.length;
  const estCost = bom?.summary.estimatedCost ?? null;
  const currency = bom?.summary.currency ?? null;

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_360px] overflow-hidden bg-slate-950 text-slate-100">
      <section className="grid min-h-0 grid-rows-[auto_auto_1fr_auto]">
        {/* Toolbar: filter chips · search · auto-source · export */}
        <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/95 p-2.5">
          <div className="flex shrink-0 items-center gap-1">
            {filterChips.map((c) => (
              <Chip
                key={c.key}
                active={filter === c.key}
                count={c.count}
                onClick={() => setFilter(c.key)}
              >
                {c.label}
              </Chip>
            ))}
          </div>
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border border-slate-800 bg-slate-900 px-3 text-sm text-slate-300">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by ref, value, MPN, footprint…"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-600"
            />
          </label>
          <button
            type="button"
            disabled
            title="Auto-source from JLCPCB — coming soon"
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-control border border-violet-500/40 bg-accent-soft px-2.5 text-xs font-medium text-accent-text opacity-70"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto-source all
            <span className="rounded bg-white/10 px-1.5 text-[9px]">
              {counts.unsourced} unsourced
            </span>
          </button>
          <ExportMenu onExport={exportArtifact} onCopyTsv={copyTsv} />
        </div>

        {/* Column header / bulk action bar */}
        {checkedIds.size > 0 ? (
          <div className="flex items-center gap-3 border-b border-slate-800 bg-violet-950/30 px-3.5 py-1.5 text-xs">
            <span className="text-slate-300">{checkedIds.size} selected</span>
            <button
              type="button"
              onClick={() => void markCheckedDnp(true)}
              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
            >
              Mark DNP
            </button>
            <button
              type="button"
              onClick={() => void markCheckedDnp(false)}
              className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
            >
              Clear DNP
            </button>
            <button
              type="button"
              onClick={() => setCheckedIds(new Set())}
              className="ml-auto text-slate-400 hover:text-slate-200"
            >
              Clear selection
            </button>
          </div>
        ) : (
          <div
            className={`${COLS} border-b border-slate-800 bg-slate-900/60 py-1.5 text-[9px] uppercase tracking-wide text-slate-500`}
          >
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleCheckAll}
              aria-label="Select all"
              className="h-3.5 w-3.5"
            />
            <span>Stat</span>
            <button
              type="button"
              onClick={() => toggleSort("refs")}
              className="text-left uppercase hover:text-slate-300"
            >
              Ref {sort.key === "refs" ? (sort.dir === 1 ? "▲" : "▼") : ""}
            </button>
            <span className="text-right">Qty</span>
            <span>Value</span>
            <span>MPN · Source</span>
            <span className="text-right">Cost</span>
          </div>
        )}

        {/* Rows */}
        <div className="min-h-0 overflow-auto">
          {error ? (
            <div className="p-4 text-sm text-red-300">{error}</div>
          ) : null}
          {loading ? (
            <div className="p-4 text-sm text-slate-400">Loading BOM…</div>
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
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              No BOM lines match the current filter.
            </div>
          ) : null}
        </div>

        {/* Footer: stats · sourcing progress · order qty · cost */}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900/80 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-4 text-slate-400">
            <FooterStat
              label="Lines"
              value={String(bom?.summary.lineCount ?? 0)}
            />
            <FooterStat
              label="Active"
              value={String(bom?.summary.activePartCount ?? 0)}
            />
            <FooterStat
              label="DNP"
              value={String(bom?.summary.dnpPartCount ?? 0)}
            />
            <div className="flex items-center gap-2">
              <span className="text-[9px] uppercase tracking-wide text-slate-500">
                Sourced
              </span>
              <span className="font-medium text-status-success">
                {counts.sourced}
              </span>
              <span className="text-slate-600">/ {sourceable}</span>
              <span className="relative inline-block h-1 w-16 rounded-pill bg-slate-700">
                <span
                  className="absolute left-0 top-0 h-full rounded-pill bg-status-success"
                  style={{ width: `${sourcedPct}%` }}
                />
              </span>
              <span className="font-mono text-status-success">
                {sourcedPct}%
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-slate-400">
              <span className="text-[9px] uppercase tracking-wide text-slate-500">
                Order qty
              </span>
              <select
                value={orderQty}
                onChange={(e) => setOrderQty(Number(e.target.value))}
                className="rounded-control border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-xs text-slate-100 outline-none"
              >
                {ORDER_QTYS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2 rounded-control border border-violet-500/20 bg-slate-950 px-2.5 py-1.5">
              <span className="text-[9px] uppercase tracking-wide text-slate-500">
                Est.
              </span>
              <span className="font-mono text-sm font-medium text-slate-100">
                {estCost === null
                  ? "—"
                  : formatCost(estCost * orderQty, currency)}
              </span>
              {estCost !== null ? (
                <span className="text-[10px] text-accent-text">
                  {formatCost(estCost, currency)}/board
                </span>
              ) : null}
              <Info className="h-3 w-3 text-slate-500" />
            </div>
          </div>
        </footer>
      </section>

      <aside className="flex h-full min-h-0 flex-col border-l border-slate-800 bg-slate-900">
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
  const severity = severityOf(row);
  const stripe =
    severity === "critical"
      ? "border-l-status-danger bg-status-danger-soft"
      : severity === "suggested"
        ? "border-l-violet-400 bg-accent-soft"
        : severity === "review"
          ? "border-l-status-warning bg-status-warning-soft"
          : "border-l-transparent";
  const cost = row.unitPrice != null ? row.unitPrice * row.quantity : null;
  return (
    <div
      onClick={onSelect}
      className={`${COLS} cursor-pointer border-b border-l-[3px] border-slate-900 py-2 text-xs ${
        selected ? "bg-violet-950/45" : `hover:bg-slate-900/60 ${stripe}`
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onCheck}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${row.refdesList}`}
        className="h-3.5 w-3.5"
      />
      <SeverityPill severity={severity} />
      <span
        className="truncate font-mono text-slate-200"
        title={row.refdesList}
      >
        {row.refdesList}
      </span>
      <span className="text-right font-mono text-slate-400">
        {row.quantity}
      </span>
      <span className="truncate text-slate-100" title={row.value}>
        {row.value || "—"}
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        {row.manufacturerPartNumber || row.lcscPartNumber ? (
          <span className="truncate font-mono text-[10px] text-accent-text">
            {row.lcscPartNumber || row.manufacturerPartNumber}
          </span>
        ) : severity === "critical" ? (
          <span className="truncate text-[10px] italic text-status-danger">
            No MPN — manual sourcing
          </span>
        ) : (
          <span className="truncate text-[10px] italic text-slate-500">
            No MPN yet
          </span>
        )}
      </span>
      <span className="text-right font-mono text-[10px] text-slate-200">
        {cost === null ? "—" : formatCost(cost, currency)}
      </span>
    </div>
  );
}

function SeverityPill({ severity }: { severity: Severity }): ReactElement {
  const map: Record<
    Severity,
    { tone: string; Icon: typeof Check; label: string }
  > = {
    sourced: {
      tone: "bg-status-success-soft text-status-success",
      Icon: Check,
      label: "Sourced",
    },
    suggested: {
      tone: "bg-accent-soft text-accent-text",
      Icon: Sparkles,
      label: "Suggested",
    },
    critical: {
      tone: "bg-status-danger-soft text-status-danger",
      Icon: AlertOctagon,
      label: "Critical — missing MPN",
    },
    review: {
      tone: "bg-status-warning-soft text-status-warning",
      Icon: AlertTriangle,
      label: "Needs review",
    },
    dnp: {
      tone: "bg-status-neutral-soft text-status-neutral",
      Icon: CircleSlash,
      label: "Do not populate",
    },
  };
  const { tone, Icon, label } = map[severity];
  return (
    <span
      title={label}
      className={`flex w-fit items-center rounded-pill px-1.5 py-0.5 ${tone}`}
    >
      <Icon className="h-3 w-3" />
    </span>
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
      <div className="h-full bg-slate-900 p-4 text-sm text-slate-500">
        No BOM row selected.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900">
      <div className="border-b border-slate-800 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Selected line
        </div>
        <h3 className="mt-1 text-base font-semibold text-slate-100">
          {row.value || "Unnamed part"}
        </h3>
        <div className="mt-1 text-xs text-slate-500">
          Qty {row.quantity} · {row.footprint || "No footprint"}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {row.refs.map((ref) => (
            <span
              key={ref.refdes}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs"
            >
              {ref.refdes}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onShowSchematic}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500"
          >
            Show in schematic
          </button>
          <button
            onClick={onShowPcb}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500"
          >
            Show on PCB
          </button>
        </div>
        <InspectorSection title="Part">
          <Field
            label="Manufacturer"
            value={draft.manufacturer ?? ""}
            onChange={(v) => setDraft({ ...draft, manufacturer: v })}
          />
          <Field
            label="MPN"
            value={draft.manufacturerPartNumber ?? ""}
            onChange={(v) => setDraft({ ...draft, manufacturerPartNumber: v })}
          />
        </InspectorSection>
        <InspectorSection title="Sourcing">
          <Field
            label="Supplier"
            value={draft.supplier ?? ""}
            onChange={(v) => setDraft({ ...draft, supplier: v })}
          />
          <Field
            label="LCSC/JLC"
            value={draft.lcscPartNumber ?? ""}
            onChange={(v) => setDraft({ ...draft, lcscPartNumber: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field
              label="Unit price"
              value={draft.unitPrice?.toString() ?? ""}
              onChange={(v) =>
                setDraft({ ...draft, unitPrice: v ? Number(v) : null })
              }
            />
            <Field
              label="Currency"
              value={draft.currency ?? ""}
              onChange={(v) => setDraft({ ...draft, currency: v })}
            />
          </div>
        </InspectorSection>
        <InspectorSection title="Assembly">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={draft.dnp === true}
              onChange={(event) =>
                setDraft({ ...draft, dnp: event.target.checked })
              }
            />
            Do not populate
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assembly side
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
              className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm normal-case text-slate-100"
            >
              <option value="">Auto</option>
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
            </select>
          </label>
        </InspectorSection>
        <InspectorSection title="Notes">
          <textarea
            value={draft.notes ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, notes: event.target.value })
            }
            className="min-h-20 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm normal-case text-slate-100"
          />
        </InspectorSection>
        {row.warnings.length > 0 ? (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            {row.warnings.join(" · ")}
          </div>
        ) : null}
      </div>
      <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
        <AutosaveState state={saveState} />
      </div>
    </div>
  );
}

function ExportMenu({
  onExport,
  onCopyTsv,
}: {
  onExport(kind: "csv" | "tsv" | "jlc" | "kicad" | "pnp"): Promise<void>;
  onCopyTsv(): Promise<void>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="h-8 rounded-md border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-100 hover:border-violet-500"
      >
        Export ▾
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-20 w-48 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 text-xs shadow-xl shadow-black/40">
          <ExportItem
            label="CSV"
            onClick={() => void onExport("csv").finally(() => setOpen(false))}
          />
          <ExportItem
            label="Copy TSV"
            onClick={() => void onCopyTsv().finally(() => setOpen(false))}
          />
          <ExportItem
            label="JLC BOM"
            detail="experimental"
            onClick={() => void onExport("jlc").finally(() => setOpen(false))}
          />
          <ExportItem
            label="PnP"
            onClick={() => void onExport("pnp").finally(() => setOpen(false))}
          />
          <ExportItem
            label="KiCad CSV"
            onClick={() => void onExport("kicad").finally(() => setOpen(false))}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExportItem({
  label,
  detail,
  onClick,
}: {
  label: string;
  detail?: string;
  onClick(): void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-2 text-left text-slate-200 hover:bg-slate-800"
    >
      <span>{label}</span>
      {detail ? (
        <span className="text-[10px] text-amber-300">{detail}</span>
      ) : null}
    </button>
  );
}

function SortableTh({
  label,
  sortKey,
  current,
  onSort,
  alignRight = false,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  current: { key: SortKey; dir: 1 | -1 };
  onSort(key: SortKey): void;
  alignRight?: boolean;
  className?: string;
}): ReactElement {
  const sorted = current.key === sortKey;
  return (
    <th
      aria-sort={
        sorted ? (current.dir === 1 ? "ascending" : "descending") : "none"
      }
      className={`border-b border-slate-800 px-3 py-2 ${alignRight ? "text-right" : ""} ${className}`}
    >
      <button
        onClick={() => onSort(sortKey)}
        className="font-semibold hover:text-slate-200"
      >
        {label} {sorted ? (current.dir === 1 ? "↑" : "↓") : ""}
      </button>
    </th>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/35 p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      {children}
    </section>
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
      ? "text-red-300"
      : state === "saved"
        ? "text-emerald-300"
        : "text-slate-400";
  return <div className={color}>{label}</div>;
}

function FooterStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="font-medium text-slate-100">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}): ReactElement {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm normal-case text-slate-100"
      />
    </label>
  );
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

function formatCost(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${currency ?? ""} ${value.toFixed(value < 1 ? 3 : 2)}`.trim();
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
