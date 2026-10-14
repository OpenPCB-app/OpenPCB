import type { ReactElement } from "react";
import { Banner } from "@shared/frontend/ui/banner";
import { Button } from "@shared/frontend/ui/button";
import type { DesignerUnresolvedFootprint } from "../../../../sdks/designer";
import { UNRESOLVED_SUMMARY_MAX_REFS } from "../../../../shared/pcb-geometry/unresolved-footprints";

interface UnresolvedFootprintBannerProps {
  items: readonly DesignerUnresolvedFootprint[];
  /** Select + frame a placement (refdes click). */
  onSelect: (item: DesignerUnresolvedFootprint) => void;
  /** Optional "Fix…" action; hidden when not provided. */
  onFixFootprint?: (partId: string) => void;
}

function RefGroup({
  items,
  label,
  onSelect,
  onFixFootprint,
}: {
  items: readonly DesignerUnresolvedFootprint[];
  label: string;
  onSelect: UnresolvedFootprintBannerProps["onSelect"];
  onFixFootprint: UnresolvedFootprintBannerProps["onFixFootprint"];
}): ReactElement | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, UNRESOLVED_SUMMARY_MAX_REFS);
  const extra = items.length - shown.length;
  return (
    <span className="mr-2 inline-flex flex-wrap items-center gap-x-1">
      {shown.map((item, i) => (
        <span key={item.placementId} className="inline-flex items-center gap-0.5">
          <button
            type="button"
            className="cursor-pointer font-mono font-medium underline decoration-dotted underline-offset-2 hover:text-text-strong"
            onClick={() => onSelect(item)}
            title={`Select ${item.reference}`}
          >
            {item.reference}
          </button>
          {onFixFootprint ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onFixFootprint(item.partId)}
              title={`Assign a footprint to ${item.reference}`}
            >
              Fix…
            </Button>
          ) : null}
          {i < shown.length - 1 || extra > 0 ? "," : ""}
        </span>
      ))}
      {extra > 0 ? <span>+{extra} more</span> : null}
      <span className="text-text-secondary">({label})</span>
    </span>
  );
}

/** Warning banner over the PCB canvas for parts with no usable footprint. */
export function UnresolvedFootprintBanner({
  items,
  onSelect,
  onFixFootprint,
}: UnresolvedFootprintBannerProps): ReactElement | null {
  if (items.length === 0) return null;
  const noFp = items.filter((i) => i.reason === "no-footprint");
  const noPads = items.filter((i) => i.reason === "no-pads");
  const n = items.length;
  return (
    <Banner
      tone="warning"
      floating
      data-testid="pcb-unresolved-footprints-banner"
      title={`${n} ${n === 1 ? "part has" : "parts have"} no usable footprint`}
    >
      <RefGroup
        items={noFp}
        label="no footprint"
        onSelect={onSelect}
        onFixFootprint={onFixFootprint}
      />
      <RefGroup
        items={noPads}
        label="footprint has no pads"
        onSelect={onSelect}
        onFixFootprint={onFixFootprint}
      />
      <div className="text-text-secondary">
        Their nets cannot be routed and manufacturing export will omit their
        copper.
      </div>
    </Banner>
  );
}
