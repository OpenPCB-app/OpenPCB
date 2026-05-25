import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { BomLine, BomOverridePatch, BomProjection } from "../../../../sdks";
import { createDesignerApi } from "../api";

type SortKey = "refs" | "value" | "footprint" | "qty" | "mpn" | "lcsc";

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
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "refs",
    dir: 1,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = bom?.rows.find((row) => row.id === selectedId) ?? bom?.rows[0] ?? null;

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
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
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
      if (showUnresolvedOnly && row.warnings.length === 0) return false;
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
  }, [bom?.rows, query, showUnresolvedOnly, sort]);

  function toggleSort(key: SortKey): void {
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
  }

  async function updateSelected(patch: BomOverridePatch): Promise<void> {
    if (!designId || !selected) return;
    const refdes = selected.refs[0]?.refdes;
    if (!refdes) return;
    const result = await api.updateBomOverride(designId, refdes, patch);
    if (result.bom) setBom(result.bom);
  }

  async function exportArtifact(kind: "csv" | "tsv" | "jlc" | "kicad" | "pnp"): Promise<void> {
    if (!designId) return;
    await api.downloadBomArtifact(designId, kind);
  }

  async function copyTsv(): Promise<void> {
    const text = buildClientTsv(rows);
    await navigator.clipboard.writeText(text);
  }

  if (!designId) {
    return <div className="flex h-full items-center justify-center bg-slate-950 text-slate-400">Open a design to view its BOM.</div>;
  }

  const inspector = (
    <BomInspector
      row={selected}
      onUpdate={updateSelected}
      onShowSchematic={() =>
        selected && onShowSchematic(selected.refs.map((ref) => ref.partId).filter(isString))
      }
      onShowPcb={() =>
        selected && onShowPcb(selected.refs.map((ref) => ref.placementId).filter(isString))
      }
    />
  );

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_380px] overflow-hidden bg-slate-950 text-slate-100">
      <section className="grid min-h-0 grid-rows-[auto_1fr_auto]">
        <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-950/95 p-3">
          <label className="flex h-8 min-w-72 flex-1 items-center gap-2 rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-300">
            <span className="text-slate-500">⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by refdes, value, MPN, footprint…"
              className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-600"
            />
          </label>
          <button
            onClick={() => setShowUnresolvedOnly((value) => !value)}
            className={`h-8 rounded-md border px-3 text-xs font-semibold ${
              showUnresolvedOnly
                ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
                : "border-slate-800 bg-slate-900 text-slate-300"
            }`}
          >
            Unresolved {bom?.summary.missingRequiredCount ?? 0}
          </button>
          <ExportMenu onExport={exportArtifact} onCopyTsv={copyTsv} />
        </div>

        <div className="min-h-0 overflow-auto">
          {error ? <div className="p-4 text-sm text-red-300">{error}</div> : null}
          {loading ? <div className="p-4 text-sm text-slate-400">Loading BOM…</div> : null}
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10 bg-slate-900 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-32 border-b border-slate-800 px-3 py-2 font-semibold">Status</th>
                <SortableTh label="Designators" sortKey="refs" current={sort} onSort={toggleSort} className="w-32" />
                <SortableTh label="Qty" sortKey="qty" current={sort} onSort={toggleSort} alignRight className="w-16" />
                <SortableTh label="Value" sortKey="value" current={sort} onSort={toggleSort} className="w-28" />
                <SortableTh label="Footprint" sortKey="footprint" current={sort} onSort={toggleSort} />
                <SortableTh label="MPN" sortKey="mpn" current={sort} onSort={toggleSort} />
                <SortableTh label="LCSC/JLC" sortKey="lcsc" current={sort} onSort={toggleSort} className="w-32" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className={`cursor-pointer ${row.id === selected?.id ? "bg-violet-950/45" : "hover:bg-slate-900"}`}
                >
                  <td className="border-b border-slate-900 px-3 py-2">
                    <StatusPill row={row} />
                  </td>
                  <td className="truncate border-b border-slate-900 px-3 py-2 font-mono text-xs text-slate-300" title={row.refdesList}>{row.refdesList}</td>
                  <td className="border-b border-slate-900 px-3 py-2 text-right font-mono text-xs">{row.quantity}</td>
                  <td className="truncate border-b border-slate-900 px-3 py-2 font-mono text-xs" title={row.value}>{row.value || "—"}</td>
                  <td className="truncate border-b border-slate-900 px-3 py-2 font-mono text-xs text-slate-300" title={row.footprint}>{row.footprint || "—"}</td>
                  <td className="truncate border-b border-slate-900 px-3 py-2 text-xs" title={row.manufacturerPartNumber ?? undefined}>{row.manufacturerPartNumber || "—"}</td>
                  <td className="truncate border-b border-slate-900 px-3 py-2 font-mono text-xs" title={row.lcscPartNumber ?? undefined}>{row.lcscPartNumber || "—"}</td>
                </tr>
              ))}
              {!loading && !error && rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                    No BOM lines match the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <footer className="grid grid-cols-4 border-t border-slate-800 bg-slate-900/80 text-xs">
          <FooterStat label="Lines" value={String(bom?.summary.lineCount ?? 0)} />
          <FooterStat label="Active parts" value={String(bom?.summary.activePartCount ?? 0)} />
          <FooterStat label="DNP parts" value={String(bom?.summary.dnpPartCount ?? 0)} />
          <FooterStat
            label="Estimated cost"
            value={formatCost(bom?.summary.estimatedCost ?? null, bom?.summary.currency ?? null)}
          />
        </footer>
      </section>

      <aside className="flex h-full min-h-0 flex-col border-l border-slate-800 bg-slate-900">
        <div className="min-h-0 flex-1 overflow-hidden">{inspector}</div>
      </aside>
    </div>
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  useEffect(() => {
    const next = {
      manufacturer: row?.manufacturer ?? null,
      manufacturerPartNumber: row?.manufacturerPartNumber ?? null,
      lcscPartNumber: row?.lcscPartNumber ?? null,
      supplier: row?.supplier ?? null,
      unitPrice: row?.unitPrice ?? null,
      currency: row?.currency ?? "USD",
      dnp: row?.dnp ?? false,
      assemblySide: row?.assemblySide === "mixed" ? null : row?.assemblySide ?? null,
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
    return <div className="h-full bg-slate-900 p-4 text-sm text-slate-500">No BOM row selected.</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900">
      <div className="border-b border-slate-800 p-4">
        <div className="text-xs uppercase tracking-wide text-slate-500">Selected line</div>
        <h3 className="mt-1 text-base font-semibold text-slate-100">{row.value || "Unnamed part"}</h3>
        <div className="mt-1 text-xs text-slate-500">
          Qty {row.quantity} · {row.footprint || "No footprint"}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {row.refs.map((ref) => (
            <span key={ref.refdes} className="rounded border border-slate-700 bg-slate-950 px-2 py-0.5 font-mono text-xs">
              {ref.refdes}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onShowSchematic} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500">
            Show in schematic
          </button>
          <button onClick={onShowPcb} className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-violet-500">
            Show on PCB
          </button>
        </div>
        <InspectorSection title="Part">
          <Field label="Manufacturer" value={draft.manufacturer ?? ""} onChange={(v) => setDraft({ ...draft, manufacturer: v })} />
          <Field label="MPN" value={draft.manufacturerPartNumber ?? ""} onChange={(v) => setDraft({ ...draft, manufacturerPartNumber: v })} />
        </InspectorSection>
        <InspectorSection title="Sourcing">
          <Field label="Supplier" value={draft.supplier ?? ""} onChange={(v) => setDraft({ ...draft, supplier: v })} />
          <Field label="LCSC/JLC" value={draft.lcscPartNumber ?? ""} onChange={(v) => setDraft({ ...draft, lcscPartNumber: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Unit price" value={draft.unitPrice?.toString() ?? ""} onChange={(v) => setDraft({ ...draft, unitPrice: v ? Number(v) : null })} />
            <Field label="Currency" value={draft.currency ?? ""} onChange={(v) => setDraft({ ...draft, currency: v })} />
          </div>
        </InspectorSection>
        <InspectorSection title="Assembly">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={draft.dnp === true} onChange={(event) => setDraft({ ...draft, dnp: event.target.checked })} />
            Do not populate
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Assembly side
            <select
              value={draft.assemblySide ?? ""}
              onChange={(event) => setDraft({ ...draft, assemblySide: event.target.value === "" ? null : event.target.value as "top" | "bottom" })}
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
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            className="min-h-20 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm normal-case text-slate-100"
          />
        </InspectorSection>
        {row.warnings.length > 0 ? <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{row.warnings.join(" · ")}</div> : null}
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
          <ExportItem label="CSV" onClick={() => void onExport("csv").finally(() => setOpen(false))} />
          <ExportItem label="Copy TSV" onClick={() => void onCopyTsv().finally(() => setOpen(false))} />
          <ExportItem label="JLC BOM" detail="experimental" onClick={() => void onExport("jlc").finally(() => setOpen(false))} />
          <ExportItem label="PnP" onClick={() => void onExport("pnp").finally(() => setOpen(false))} />
          <ExportItem label="KiCad CSV" onClick={() => void onExport("kicad").finally(() => setOpen(false))} />
        </div>
      ) : null}
    </div>
  );
}

function ExportItem({ label, detail, onClick }: { label: string; detail?: string; onClick(): void }): ReactElement {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between px-3 py-2 text-left text-slate-200 hover:bg-slate-800">
      <span>{label}</span>
      {detail ? <span className="text-[10px] text-amber-300">{detail}</span> : null}
    </button>
  );
}

function SortableTh({ label, sortKey, current, onSort, alignRight = false, className = "" }: { label: string; sortKey: SortKey; current: { key: SortKey; dir: 1 | -1 }; onSort(key: SortKey): void; alignRight?: boolean; className?: string }): ReactElement {
  const sorted = current.key === sortKey;
  return (
    <th aria-sort={sorted ? (current.dir === 1 ? "ascending" : "descending") : "none"} className={`border-b border-slate-800 px-3 py-2 ${alignRight ? "text-right" : ""} ${className}`}>
      <button onClick={() => onSort(sortKey)} className="font-semibold hover:text-slate-200">
        {label} {sorted ? (current.dir === 1 ? "↑" : "↓") : ""}
      </button>
    </th>
  );
}

function StatusPill({ row }: { row: BomLine }): ReactElement {
  if (row.dnp) return <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-300">DNP</span>;
  if (row.warnings.length > 0) return <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">{statusLabel(row)}</span>;
  return <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Ready</span>;
}

function statusLabel(row: BomLine): string {
  if (!row.manufacturerPartNumber) return "Missing MPN";
  if (!row.manufacturer) return "Missing manufacturer";
  if (!row.lcscPartNumber && !row.supplier) return "Missing supplier";
  return row.warnings[0] ?? "Needs review";
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/35 p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

function AutosaveState({ state }: { state: "idle" | "saving" | "saved" | "error" }): ReactElement {
  const label = state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Autosave failed" : "Autosaves changes";
  const color = state === "error" ? "text-red-300" : state === "saved" ? "text-emerald-300" : "text-slate-400";
  return <div className={color}>{label}</div>;
}

function FooterStat({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="border-r border-slate-800 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 font-mono text-base font-semibold text-slate-100">{value}</div></div>;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }): ReactElement {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-8 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm normal-case text-slate-100" />
    </label>
  );
}

function normalizePatch(patch: BomOverridePatch): BomOverridePatch {
  return {
    manufacturer: emptyToNull(patch.manufacturer),
    manufacturerPartNumber: emptyToNull(patch.manufacturerPartNumber),
    lcscPartNumber: emptyToNull(patch.lcscPartNumber),
    supplier: emptyToNull(patch.supplier),
    unitPrice: Number.isFinite(patch.unitPrice) ? patch.unitPrice ?? null : null,
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
      return a.footprint.localeCompare(b.footprint, undefined, { numeric: true });
    case "mpn":
      return (a.manufacturerPartNumber ?? "").localeCompare(b.manufacturerPartNumber ?? "", undefined, { numeric: true });
    case "lcsc":
      return (a.lcscPartNumber ?? "").localeCompare(b.lcscPartNumber ?? "", undefined, { numeric: true });
    case "refs":
      return a.refdesList.localeCompare(b.refdesList, undefined, { numeric: true });
  }
}

function formatCost(value: number | null, currency: string | null): string {
  if (value === null) return "—";
  return `${currency ?? ""} ${value.toFixed(value < 1 ? 3 : 2)}`.trim();
}

function buildClientTsv(rows: readonly BomLine[]): string {
  return [
    ["Designators", "Qty", "Value", "Footprint", "Manufacturer", "MPN", "LCSC/JLC"].join("\t"),
    ...rows.map((row) => [row.refdesList, row.quantity, row.value, row.footprint, row.manufacturer ?? "", row.manufacturerPartNumber ?? "", row.lcscPartNumber ?? ""].join("\t")),
  ].join("\n");
}

function isString(value: string | null): value is string {
  return typeof value === "string";
}
