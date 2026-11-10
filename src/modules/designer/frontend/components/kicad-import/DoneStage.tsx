import type { ReactElement } from "react";
import { Banner } from "@shared/frontend/ui/banner";
import type {
  KicadProjectCommitResult,
  KicadProjectDeferredEntityKind,
} from "../../../../../sdks/designer";
import { ImportWarningsList } from "./ImportWarningsList";
import { ImportStat } from "./ReviewStage";
import { countImportBlockers } from "./warning-copy";

export const MANUFACTURING_BLOCKED_COPY =
  "This design can't be sent to manufacturing until these are fixed.";

const DEFERRED_LABEL: Record<KicadProjectDeferredEntityKind, string> = {
  schematic_symbols: "schematic symbols",
  schematic_wires: "schematic wires",
  schematic_labels: "net labels",
  schematic_primitives: "power and ground symbols",
  pcb_placements: "PCB placements",
  pcb_segments: "tracks",
  pcb_vias: "vias",
  library_ingestion: "library parts",
};

/** Result of a finished import; stays open until the user opens or closes. */
export function DoneStage({
  result,
}: {
  result: KicadProjectCommitResult;
}): ReactElement {
  const blockers = countImportBlockers(result.warnings);
  const blockerTotal = blockers.capability + blockers.cosmetic;
  const deferred = result.applied.deferred;
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="success" title="Import finished">
        Created the design <strong>{result.designName}</strong>.
      </Banner>

      {blockerTotal > 0 ? (
        <Banner
          tone="danger"
          role="status"
          title={`${blockerTotal} import ${blockerTotal === 1 ? "problem" : "problems"} to fix`}
          data-testid="kicad-import-blockers"
        >
          <p>{MANUFACTURING_BLOCKED_COPY}</p>
          <p className="mt-1 text-text-secondary">
            {blockers.capability} change copper, holes, nets or rules
            {blockers.cosmetic > 0
              ? `; ${blockers.cosmetic} affect silkscreen only`
              : ""}
            .
          </p>
        </Banner>
      ) : null}

      <section className="grid grid-cols-2 gap-2">
        <ImportStat label="Copper layers" value={result.applied.copperLayerCount} />
        <ImportStat label="Net classes" value={result.applied.netClassesIngested} />
        <ImportStat
          label="Board outline"
          value={result.applied.boardOutline ? "Imported" : "Default size"}
        />
        <ImportStat label="Warnings" value={result.warnings.length} />
      </section>

      {deferred.length > 0 ? (
        <Banner tone="warning" title="Not imported">
          These weren't imported: {deferred.map((kind) => DEFERRED_LABEL[kind]).join(", ")}.
        </Banner>
      ) : null}

      <ImportWarningsList warnings={result.warnings} />
    </div>
  );
}
