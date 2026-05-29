import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";

interface DetailsCardProps {
  componentName: string;
  defaultFootprintName: string;
  optionCount: number;
  source: string;
  datasheetUrl?: string | null;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactElement | string;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-sm text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="truncate text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
        {children}
      </span>
    </div>
  );
}

/** Read-only "Details" card: component identity + footprint/source summary. */
export function DetailsCard({
  componentName,
  defaultFootprintName,
  optionCount,
  source,
  datasheetUrl,
}: DetailsCardProps): ReactElement {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <header className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Details
        </span>
      </header>
      <div className="flex flex-1 flex-col">
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          <Row label="Component name">{componentName}</Row>
          <Row label="Default footprint">{defaultFootprintName}</Row>
          <Row label="Footprint options">{String(optionCount)}</Row>
          <Row label="Source">{source}</Row>
          {datasheetUrl ? (
            <Row label="Datasheet">
              <a
                href={datasheetUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-semibold text-violet-600 hover:underline dark:text-violet-300"
              >
                Open
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Row>
          ) : null}
        </div>
        {/* Absorb extra row height as empty space, keeping the rows compact. */}
        <div className="flex-1" aria-hidden="true" />
      </div>
    </section>
  );
}
