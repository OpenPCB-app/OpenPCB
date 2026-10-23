import { Play, X } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import { Button } from "@shared/frontend/ui/button";
import { IconButton } from "@shared/frontend/ui/icon-button";
import { SeverityDiamond } from "@shared/frontend/ui/severity-diamond";
import { TableHeaderRow, TableRow } from "@shared/frontend/ui/data-table";
import type {
  DesignerSchematicProjection,
  ErcAnchor,
  ErcSeverity,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { useErcStore } from "../stores/erc-store";
import { detachedErcAnchorTarget } from "./erc-anchor-target";
import {
  validationReportNotice,
  validationReportState,
} from "./validation-report-state";
import {
  netBoundsMm,
  partBoundsMm,
  pointBoundsMm,
  type BoundsMm,
} from "./OutlinePanel/bounds";

export interface DesignerErcViewProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  /** Current schematic projection — anchor labels, framing, stale detection. */
  projection: DesignerSchematicProjection | null;
  /** Same contract the outline panel uses to drive the canvas selection. */
  onSelectOnCanvas(sel: {
    partIds?: string[];
    wireIds?: string[];
    labelIds?: string[];
  }): void;
  onFrameBoundsMm(bounds: BoundsMm): void;
  /** When provided, the header shows a close (×) button. */
  onClose?: () => void;
}

const SEVERITIES: readonly ErcSeverity[] = ["error", "warning", "info"];
const ROW_COLS = "12px 150px 1fr";

/**
 * Resolve an ERC anchor to a canvas selection + a frame box.
 *
 * Pins are not directly selectable on the schematic canvas (its selection
 * holds parts / wires / labels / primitives), so a pin anchor selects the
 * owning part and frames the pin itself — precise without inventing a
 * selection kind. Net anchors select every wire on the derived net, exactly
 * like the outline panel's net rows.
 */
function resolveAnchor(
  anchor: ErcAnchor,
  projection: DesignerSchematicProjection,
): {
  selection: { partIds?: string[]; wireIds?: string[]; labelIds?: string[] };
  bounds: BoundsMm | null;
} | null {
  if (anchor.kind === "part") {
    const part = projection.parts.find((p) => p.id === anchor.partId);
    if (!part) return null;
    return { selection: { partIds: [part.id] }, bounds: partBoundsMm(part) };
  }
  if (anchor.kind === "net") {
    const net = projection.nets.find((n) => n.id === anchor.netId);
    if (!net) return null;
    return {
      selection: { wireIds: [...net.wireIds] },
      bounds: netBoundsMm(net, projection),
    };
  }
  if (anchor.kind === "label" || anchor.kind === "primitive") {
    return detachedErcAnchorTarget(anchor, projection);
  }
  for (const part of projection.parts) {
    const pin = part.pins.find((p) => p.id === anchor.pinId);
    if (!pin) continue;
    return {
      selection: { partIds: [part.id] },
      bounds: pointBoundsMm(pin.worldPositionNm),
    };
  }
  return null;
}

/** Human label for the first anchor, used as the row tooltip. */
function anchorLabel(
  anchor: ErcAnchor,
  projection: DesignerSchematicProjection | null,
): string {
  if (!projection) return "";
  if (anchor.kind === "part") {
    return (
      projection.parts.find((p) => p.id === anchor.partId)?.reference ??
      anchor.partId
    );
  }
  if (anchor.kind === "net") {
    return (
      projection.nets.find((n) => n.id === anchor.netId)?.name ?? anchor.netId
    );
  }
  if (anchor.kind === "label" || anchor.kind === "primitive") {
    return (
      detachedErcAnchorTarget(anchor, projection)?.label ??
      (anchor.kind === "label" ? anchor.labelId : anchor.primitiveId)
    );
  }
  for (const part of projection.parts) {
    const pin = part.pins.find((p) => p.id === anchor.pinId);
    if (pin) return `${part.reference}.${pin.number ?? pin.name}`;
  }
  return anchor.pinId;
}

/**
 * Electrical-rules-check results for the schematic editor's right dock.
 *
 * Unlike DRC there is nothing persisted server-side: the backend recomputes
 * the report from the projection on every GET, so this view runs it once when
 * it opens for a design and on demand afterwards.
 */
export function DesignerErcView({
  backendURL,
  moduleId,
  designId,
  projection,
  onSelectOnCanvas,
  onFrameBoundsMm,
  onClose,
}: DesignerErcViewProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const reportRaw = useErcStore((s) => s.report);
  // A report from a previous design must never paint here; the store is
  // cleared on design change, but the run below races that clear by a commit.
  const report =
    reportRaw && reportRaw.designId === designId ? reportRaw : null;
  const running = useErcStore((s) => s.running);
  const error = useErcStore((s) => s.error);
  const reportIsPrevious = useErcStore((s) => s.reportIsPrevious);
  const selectedIndex = useErcStore((s) => s.selectedIndex);
  const select = useErcStore((s) => s.select);
  const run = useErcStore((s) => s.run);

  const [filter, setFilter] = useState<Set<ErcSeverity>>(
    () => new Set(SEVERITIES),
  );

  // Run once when this tab opens for a design the store has no report for.
  // (`clear()` on design change is Space's job, same as the DRC store.)
  useEffect(() => {
    if (!designId) return;
    const state = useErcStore.getState();
    if (state.running || state.report?.designId === designId) return;
    void state.run(() => api.runErc(designId), designId);
  }, [api, designId]);

  const counts = report?.summary ?? { errors: 0, warnings: 0, infos: 0 };
  const rows = useMemo(() => {
    const all = report?.violations ?? [];
    return all
      .map((violation, index) => ({ violation, index }))
      .filter(({ violation }) => filter.has(violation.severity));
  }, [report, filter]);

  const reportState = validationReportState({
    report,
    designId,
    revision: projection?.designId === designId ? projection.revision : null,
    previous: reportIsPrevious || running || error !== null,
  });
  const notice = validationReportNotice("ERC", reportState);

  const onRun = (): void => {
    if (!designId) return;
    void run(() => api.runErc(designId), designId);
  };

  const showViolation = (index: number): void => {
    select(index);
    const violation = report?.violations[index];
    if (!violation || !projection) return;
    for (const anchor of violation.anchors) {
      const resolved = resolveAnchor(anchor, projection);
      if (!resolved) continue;
      onSelectOnCanvas(resolved.selection);
      if (resolved.bounds) onFrameBoundsMm(resolved.bounds);
      return;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel text-xs">
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onRun}
          disabled={running || !designId}
          icon={<Play className="h-3 w-3" />}
        >
          {running ? "Running…" : "Run ERC"}
        </Button>
        {report ? (
          <div className="ml-auto flex items-center gap-1.5">
            {SEVERITIES.map((severity) => {
              const n =
                severity === "error"
                  ? counts.errors
                  : severity === "warning"
                    ? counts.warnings
                    : counts.infos;
              const active = filter.has(severity);
              return (
                <button
                  key={severity}
                  type="button"
                  onClick={() =>
                    setFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(severity)) next.delete(severity);
                      else next.add(severity);
                      return next;
                    })
                  }
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-control px-1 py-0.5 font-mono text-2xs text-text-secondary transition-opacity hover:bg-surface-hover ${active ? "opacity-100" : "opacity-40"}`}
                  title={`Toggle ${severity}`}
                  aria-pressed={active}
                >
                  <SeverityDiamond severity={severity} />
                  {n}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="ml-auto text-2xs text-text-tertiary">
            Run ERC to check the schematic.
          </span>
        )}
        {onClose ? (
          <IconButton
            label="Close ERC panel"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            <X />
          </IconButton>
        ) : null}
      </div>

      {notice ? (
        <div className="shrink-0 border-b border-border bg-status-warning-soft px-2 py-1 text-2xs text-status-warning">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="flex shrink-0 items-center border-b border-border bg-status-danger-soft px-2 py-1 text-2xs text-status-danger">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {report && report.violations.length === 0 ? (
          <div className="m-2 rounded-control bg-surface-section px-2 py-1.5 text-xs text-text-secondary">
            {reportState === "current"
              ? "No reported ERC violations"
              : "Previous ERC report: no reported violations"}
          </div>
        ) : null}
        {report ? (
          <div className="px-2 py-1 text-2xs text-text-tertiary">
            Only supported checks are reported. This does not certify electrical
            correctness.
          </div>
        ) : null}

        {rows.length > 0 ? (
          <>
            <TableHeaderRow cols={ROW_COLS} className="h-[20px]">
              <span />
              <span>Violation</span>
              <span />
            </TableHeaderRow>
            {rows.map(({ violation, index }) => (
              <TableRow
                key={`${violation.code}:${index}`}
                cols={ROW_COLS}
                selected={index === selectedIndex}
                role="button"
                tabIndex={0}
                title={`${violation.code} · ${violation.anchors
                  .map((anchor) => anchorLabel(anchor, projection))
                  .filter(Boolean)
                  .join(" ↔ ")}`}
                onClick={() => showViolation(index)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    showViolation(index);
                  }
                }}
                className="cursor-pointer"
              >
                <SeverityDiamond severity={violation.severity} />
                <span className="truncate font-medium text-text-strong">
                  {violation.code}
                </span>
                <span className="truncate text-text-tertiary">
                  {violation.message}
                </span>
              </TableRow>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
