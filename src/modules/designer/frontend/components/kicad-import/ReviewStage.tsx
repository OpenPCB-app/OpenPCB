import { useId, type ReactElement } from "react";
import { Badge } from "@shared/frontend/ui/badge";
import { Field } from "@shared/frontend/ui/field";
import { Input } from "@shared/frontend/ui/input";
import type {
  KicadProjectImportComponentRow,
  KicadProjectInspectReport,
} from "../../../../../sdks/designer";
import { ImportWarningsList } from "./ImportWarningsList";

const MAX_COMPONENT_ROWS = 50;

interface ReviewStageProps {
  report: KicadProjectInspectReport;
  designName: string;
  onDesignNameChange(name: string): void;
}

/** Inspect report: design name, source counts, parts and warnings. */
export function ReviewStage({
  report,
  designName,
  onDesignNameChange,
}: ReviewStageProps): ReactElement {
  const nameId = useId();
  const inLibrary = report.components.filter((c) => c.status === "reuse").length;
  const added = report.components.length - inLibrary;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Design name" htmlFor={nameId}>
        <Input
          id={nameId}
          value={designName}
          placeholder={report.projectName}
          onChange={(event) => onDesignNameChange(event.target.value)}
        />
      </Field>

      <section className="grid grid-cols-2 gap-2">
        <ImportStat label="Copper layers" value={report.copperLayerCount} />
        <ImportStat label="Schematic sheets" value={report.schematicSheetCount} />
        <ImportStat label="Nets" value={report.netCount} />
        <ImportStat label="Board size" value={boardSize(report)} />
        <ImportStat label="PCB footprints" value={report.counts.pcbFootprints} />
        <ImportStat label="Tracks" value={report.counts.pcbSegments} />
        <ImportStat label="Vias" value={report.counts.pcbVias} />
        <ImportStat label="Schematic symbols" value={report.counts.schematicSymbols} />
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium text-text-strong">
          Parts ({inLibrary} in library, {added} new)
        </h3>
        {report.components.length === 0 ? (
          <p className="text-xs text-text-tertiary">No parts referenced.</p>
        ) : (
          <ul className="max-h-40 divide-y divide-border overflow-y-auto rounded-control border border-border">
            {report.components.slice(0, MAX_COMPONENT_ROWS).map((row, index) => (
              // Symbol and footprint rows can share a lib_id; the list is static.
              <ComponentRow key={index} row={row} />
            ))}
          </ul>
        )}
      </section>

      <ImportWarningsList warnings={report.warnings} />
    </div>
  );
}

function ComponentRow({
  row,
}: {
  row: KicadProjectImportComponentRow;
}): ReactElement {
  return (
    <li className="flex items-center justify-between gap-2 px-2.5 py-1 text-xs">
      <span className="min-w-0 truncate text-text">{row.libId}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {row.references.length > 1 ? (
          <span className="text-2xs text-text-tertiary">
            ×{row.references.length}
          </span>
        ) : null}
        {row.status === "reuse" ? (
          <Badge tone="success">In library</Badge>
        ) : (
          // The current pipeline ingests every part it can read at commit;
          // parts it can't are reported on the Done stage.
          <Badge tone="info">New — added to library</Badge>
        )}
      </span>
    </li>
  );
}

function boardSize(report: KicadProjectInspectReport): string {
  const outline = report.boardOutlineMm;
  if (!outline) return "No outline found";
  const width = Math.round(outline.maxXMm - outline.minXMm);
  const height = Math.round(outline.maxYMm - outline.minYMm);
  return `${width} × ${height} mm`;
}

export function ImportStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}): ReactElement {
  return (
    <div className="rounded-control border border-border bg-surface-section px-2.5 py-1.5">
      <div className="text-2xs text-text-tertiary">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-text-strong">{value}</div>
    </div>
  );
}
