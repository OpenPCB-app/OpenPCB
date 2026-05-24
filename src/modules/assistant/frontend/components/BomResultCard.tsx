import type { ReactElement, ReactNode } from "react";
import { CheckCircle2, PackageCheck, PackageOpen } from "lucide-react";

interface ComponentHit {
  componentId: string;
  name: string;
  description: string;
  tags: string[];
  score: number;
}

interface BomItem {
  role: string;
  requestedQuery: string;
  rewrittenQuery: string;
  quantity: number;
  value: string | null;
  attributes: Record<string, string | string[] | number | boolean>;
  selected: ComponentHit | null;
  alternatives: ComponentHit[];
  assumptions: string[];
  importSuggestions: Array<{ label: string; reason: string; availability: "not-installed" }>;
  status: "resolved" | "generic-resolved" | "missing";
}

export interface BomResultPayload {
  goal: string | null;
  defaults: {
    supplyVoltage: string;
    blinkRate: string;
    packagePreference: string;
  };
  items: BomItem[];
  readyForPlacement: boolean;
  assumptions: string[];
  nextAction: string;
}

export function BomResultCard({ data }: { data: BomResultPayload }): ReactElement {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-200">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-violet-400">
            BOM proposal
          </div>
          <h3 className="mt-1 font-semibold text-slate-100">
            {data.goal ?? "Resolved local components"}
          </h3>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] ${data.readyForPlacement ? "bg-emerald-950/60 text-emerald-300" : "bg-amber-950/60 text-amber-300"}`}>
          {data.readyForPlacement ? <CheckCircle2 className="h-3 w-3" /> : <PackageOpen className="h-3 w-3" />}
          {data.readyForPlacement ? "ready" : "needs review"}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-slate-400 md:grid-cols-3">
        <Fact label="Supply" value={data.defaults.supplyVoltage} />
        <Fact label="Blink rate" value={data.defaults.blinkRate} />
        <Fact label="Package" value={data.defaults.packagePreference} />
      </div>

      <div className="mt-4 space-y-2">
        {data.items.map((item, idx) => (
          <article key={`${item.role}-${idx}`} className="rounded-lg border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-100">{item.quantity}× {item.role}</span>
                  {item.value ? <Tag>{item.value}</Tag> : null}
                  {Object.entries(item.attributes).map(([key, value]) => (
                    <Tag key={key}>{key}: {Array.isArray(value) ? value.join("/") : String(value)}</Tag>
                  ))}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  query: {item.requestedQuery} → {item.rewrittenQuery}
                </div>
              </div>
              <StatusPill status={item.status} />
            </div>

            {item.selected ? (
              <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-2">
                <div className="flex items-center gap-2 font-medium text-slate-100">
                  <PackageCheck className="h-4 w-4 text-violet-300" />
                  {item.selected.name}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                  {item.selected.description}
                </p>
                {item.selected.tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {item.selected.tags.slice(0, 6).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                  </div>
                ) : null}
              </div>
            ) : null}

            {item.importSuggestions.length > 0 ? (
              <div className="mt-2 text-xs text-amber-300">
                Optional import: {item.importSuggestions.map((s) => s.label).join(", ")}
              </div>
            ) : null}
            {item.assumptions.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-500">
                {item.assumptions.slice(0, 3).map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
            ) : null}
          </article>
        ))}
      </div>

      {data.assumptions.length > 0 ? (
        <p className="mt-3 text-xs text-slate-400">{data.assumptions.join(" ")}</p>
      ) : null}
      <p className="mt-2 text-xs font-medium text-violet-300">Next: {data.nextAction}</p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 px-2 py-1.5">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className="text-slate-300">{value}</div>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }): ReactElement {
  return <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">{children}</span>;
}

function StatusPill({ status }: { status: BomItem["status"] }): ReactElement {
  const cls = status === "missing"
    ? "bg-amber-950/60 text-amber-300"
    : status === "generic-resolved"
      ? "bg-blue-950/60 text-blue-300"
      : "bg-emerald-950/60 text-emerald-300";
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] ${cls}`}>{status}</span>;
}
