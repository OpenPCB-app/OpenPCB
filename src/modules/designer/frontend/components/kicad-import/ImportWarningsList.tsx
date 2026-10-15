import type { ReactElement } from "react";
import { Badge } from "@shared/frontend/ui/badge";
import type { KicadProjectImportWarning } from "../../../../../sdks/designer";
import { groupImportWarnings, type ImportWarningEntry } from "./warning-copy";

const MAX_ITEMS = 20;

/** Import warnings grouped by area, in plain language; codes stay in `<details>`. */
export function ImportWarningsList({
  warnings,
}: {
  warnings: readonly KicadProjectImportWarning[];
}): ReactElement | null {
  const sections = groupImportWarnings(warnings);
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="kicad-import-warnings">
      {sections.map((section) => (
        <section key={section.group} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-text-strong">
            {section.label}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
            {section.entries.map((entry) => (
              <WarningEntry key={entry.key} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function WarningEntry({ entry }: { entry: ImportWarningEntry }): ReactElement {
  const { copy, items } = entry;
  const visibleItems = copy.showItems ? items.slice(0, MAX_ITEMS) : [];
  return (
    <li className="flex flex-col gap-1 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <EntryBadge entry={entry} />
        <span className="min-w-0 flex-1 text-xs text-text">
          {copy.summary}
          {items.length > 1 ? (
            <span className="text-text-tertiary"> ({items.length})</span>
          ) : null}
        </span>
      </div>
      {visibleItems.length > 0 ? (
        <ul className="ml-1 flex flex-col gap-0.5 text-2xs text-text-secondary">
          {visibleItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
          {items.length > visibleItems.length ? (
            <li>and {items.length - visibleItems.length} more</li>
          ) : null}
        </ul>
      ) : null}
      <details className="text-2xs text-text-tertiary">
        <summary className="cursor-pointer select-none">Technical details</summary>
        <div className="mt-1 flex flex-col gap-0.5">
          <span className="font-mono">{entry.codes.join(", ")}</span>
          {!copy.showItems
            ? items.map((item, index) => <span key={index}>{item}</span>)
            : null}
        </div>
      </details>
    </li>
  );
}

function EntryBadge({ entry }: { entry: ImportWarningEntry }): ReactElement {
  if (entry.copy.blocker === "capability") {
    return <Badge tone="danger">Blocks manufacturing</Badge>;
  }
  if (entry.copy.blocker === "cosmetic") {
    return <Badge tone="warning">Silkscreen only</Badge>;
  }
  return entry.severity === "warning" ? (
    <Badge tone="warning">Warning</Badge>
  ) : (
    <Badge tone="neutral">Note</Badge>
  );
}
