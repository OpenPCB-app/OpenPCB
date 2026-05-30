import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import type {
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  DrcAnchor,
  DrcRuleCode,
  DrcSeverity,
  PcbDesignRules,
  PcbNetClass,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { useDrcStore } from "../pcb/drc/drc-store";
import { usePcbViewStore } from "../pcb/pcb-view-store";
import { PcbDesignRulesDialog } from "./PcbDesignRulesDialog";

const DRC_SESSION_ID = "designer-drc-session";

interface DesignerDrcViewProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  /** Current PCB projection revision, for stale detection. */
  revision: number | null;
  /** Jump to the PCB view centered on a violation location (mm). */
  onShowViolation: (locationMm: { x: number; y: number }) => void;
}

const CODE_LABEL: Record<DrcRuleCode, string> = {
  TRACE_WIDTH_MIN: "Trace width below minimum",
  VIA_DIAMETER_MIN: "Via diameter below minimum",
  VIA_DRILL_MIN: "Via drill below minimum",
  DRILL_SIZE_MIN: "Drill size below minimum",
  ANNULAR_RING_MIN: "Annular ring below minimum",
  TRACE_TO_TRACE_CLEARANCE: "Trace-to-trace clearance",
  TRACE_TO_PAD_CLEARANCE: "Trace-to-pad clearance",
  TRACE_TO_VIA_CLEARANCE: "Trace-to-via clearance",
  UNCONNECTED_NET: "Unconnected net",
  NET_SHORT_CIRCUIT: "Short circuit",
  TRACE_LAYER_MISMATCH: "Trace on invalid layer",
  PLACED_PART_MISSING_FOOTPRINT: "Missing footprint",
  FAB_TRACE_WIDTH: "Trace below fab minimum",
  FAB_CLEARANCE: "Clearance below fab minimum",
  FAB_ANNULAR_RING: "Annular below fab minimum",
  FAB_DRILL: "Drill below fab minimum",
  FAB_PAD: "Via pad below fab minimum",
  VIA_TO_VIA_CLEARANCE: "Via-to-via clearance",
  PAD_TO_PAD_CLEARANCE: "Pad-to-pad clearance",
  PAD_TO_VIA_CLEARANCE: "Pad-to-via clearance",
  COPPER_TO_BOARD_EDGE: "Copper too close to board edge",
  HOLE_TO_HOLE: "Hole-to-hole spacing",
  VIA_LAYER_SPAN: "Invalid via layer span",
  VIA_ASPECT_RATIO: "Via aspect ratio too high",
  BOARD_OUTLINE_INVALID: "Invalid board outline",
  COPPER_OFF_BOARD: "Copper outside board",
};

const SEVERITY_DOT: Record<DrcSeverity, string> = {
  error: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-400",
};
const SEVERITY_RANK: Record<DrcSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function resolveAnchorLabel(
  anchor: DrcAnchor,
  projection: DesignerPcbProjection | null,
): string {
  switch (anchor.kind) {
    case "trace":
      return `trace ${anchor.traceId.slice(0, 6)}`;
    case "segment":
      return `trace ${anchor.traceId.slice(0, 6)}·${anchor.index}`;
    case "via":
      return `via ${anchor.viaId.slice(0, 6)}`;
    case "pad": {
      const ref = projection?.placements.find(
        (p) => p.id === anchor.placementId,
      )?.reference;
      return `${ref ?? "?"}.${anchor.padNumber}`;
    }
    case "freePad":
      return `pad ${anchor.freePadId.slice(0, 6)}`;
    case "freeHole":
      return `hole ${anchor.freeHoleId.slice(0, 6)}`;
    case "placement":
      return (
        projection?.placements.find((p) => p.id === anchor.placementId)
          ?.reference ?? "part"
      );
    case "net":
      return (
        projection?.netNames[anchor.netId] ?? `net ${anchor.netId.slice(0, 6)}`
      );
    case "boardEdge":
      return "board edge";
  }
}

export function DesignerDrcView({
  backendURL,
  moduleId,
  designId,
  revision,
  onShowViolation,
}: DesignerDrcViewProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const report = useDrcStore((s) => s.report);
  const running = useDrcStore((s) => s.running);
  const error = useDrcStore((s) => s.error);
  const selectedId = useDrcStore((s) => s.selectedId);
  const select = useDrcStore((s) => s.select);
  const run = useDrcStore((s) => s.run);
  const requestCenter = useDrcStore((s) => s.requestCenter);

  const waivedIds = usePcbViewStore((s) => s.viewState.drcWaivedViolationIds);
  const toggleWaived = usePcbViewStore((s) => s.toggleDrcWaived);

  const [projection, setProjection] = useState<DesignerPcbProjection | null>(
    null,
  );
  const [filter, setFilter] = useState<Set<DrcSeverity>>(
    new Set(["error", "warning", "info"]),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showWaived, setShowWaived] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Load labels (projection) + hydrate the persisted report when opening a
  // design whose result the store doesn't already hold.
  useEffect(() => {
    if (!designId) return;
    let cancelled = false;
    void api
      .getPcbProjection(designId)
      .then((p) => {
        if (!cancelled) setProjection(p);
      })
      .catch(() => {});
    if (useDrcStore.getState().report?.designId !== designId) {
      void api
        .getDrcResult(designId)
        .then((r) => {
          if (!cancelled && r) useDrcStore.getState().setReport(r);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [api, designId]);

  const waivedSet = useMemo(() => new Set(waivedIds ?? []), [waivedIds]);

  const { groups, counts } = useMemo(() => {
    const all = report?.violations ?? [];
    const c = { errors: 0, warnings: 0, infos: 0 };
    const byCode = new Map<DrcRuleCode, typeof all>();
    for (const v of all) {
      const isWaived = waivedSet.has(v.id);
      if (!isWaived) {
        if (v.severity === "error") c.errors += 1;
        else if (v.severity === "warning") c.warnings += 1;
        else c.infos += 1;
      }
      if (!filter.has(v.severity)) continue;
      if (isWaived && !showWaived) continue;
      const list = byCode.get(v.code);
      if (list) list.push(v);
      else byCode.set(v.code, [v]);
    }
    const grouped = [...byCode.entries()]
      .map(([code, list]) => ({
        code,
        violations: [...list].sort(
          (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
        ),
      }))
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.violations[0]!.severity] -
          SEVERITY_RANK[b.violations[0]!.severity],
      );
    return { groups: grouped, counts: c };
  }, [report, waivedSet, filter, showWaived]);

  const stale =
    report != null && revision != null && report.revision !== revision;

  const onRun = (): void => {
    if (!designId) return;
    void run(() => api.runDrc(designId));
  };

  const handleSaveRules = async (next: {
    designRules: PcbDesignRules;
    netClasses: PcbNetClass[];
    boardThicknessMm: number;
    perNetClassAssignments: Record<string, string>;
  }): Promise<void> => {
    if (!designId) return;
    const envelope: DesignerCommandEnvelope = {
      commandId: crypto.randomUUID(),
      sessionId: DRC_SESSION_ID,
      aggregateId: designId,
      baseRevision: projection?.revision ?? revision ?? null,
      issuedAt: Date.now(),
      command: {
        type: "pcb_set_design_rules",
        designRules: next.designRules,
        netClasses: next.netClasses,
        boardThicknessMm: next.boardThicknessMm,
        perNetClassAssignments: next.perNetClassAssignments,
      },
    };
    await api.dispatch(designId, envelope);
    // Pull the new board (revision bumped) then re-run DRC against it.
    const proj = await api.getPcbProjection(designId);
    setProjection(proj);
    void run(() => api.runDrc(designId));
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 text-sm dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Design Rule Check
        </h2>
        <button
          type="button"
          onClick={onRun}
          disabled={running || !designId}
          className="inline-flex h-7 cursor-pointer items-center rounded-md border border-violet-300 bg-violet-50 px-3 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:cursor-default disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
        >
          {running ? "Running…" : "Run DRC"}
        </button>
        <button
          type="button"
          onClick={() => setRulesOpen(true)}
          disabled={!projection}
          className="inline-flex h-7 cursor-pointer items-center rounded-md border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Edit rules
        </button>
        {report ? (
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
            {(["error", "warning", "info"] as DrcSeverity[]).map((sev) => {
              const n =
                sev === "error"
                  ? counts.errors
                  : sev === "warning"
                    ? counts.warnings
                    : counts.infos;
              const active = filter.has(sev);
              return (
                <button
                  key={sev}
                  type="button"
                  onClick={() =>
                    setFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(sev)) next.delete(sev);
                      else next.add(sev);
                      return next;
                    })
                  }
                  className={`inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 ${active ? "opacity-100" : "opacity-40"}`}
                  title={`Toggle ${sev}`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${SEVERITY_DOT[sev]}`}
                  />
                  {n} {sev === "info" ? "info" : `${sev}s`}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-slate-500">
            Run DRC to validate the board.
          </span>
        )}
        {report && [...waivedSet].length > 0 ? (
          <label className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showWaived}
              onChange={(e) => setShowWaived(e.target.checked)}
            />
            Show waived
          </label>
        ) : null}
      </div>

      {stale ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          The board changed since this DRC ran — results may be out of date.
          Re-run DRC.
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-red-300 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {report && counts.errors + counts.warnings + counts.infos === 0 ? (
          <div className="m-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            No DRC violations 🎉
          </div>
        ) : null}

        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.code);
          return (
            <div
              key={group.code}
              className="border-b border-slate-200 dark:border-slate-800"
            >
              <button
                type="button"
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.code)) next.delete(group.code);
                    else next.add(group.code);
                    return next;
                  })
                }
                className="flex w-full cursor-pointer items-center gap-2 bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {CODE_LABEL[group.code] ?? group.code}
                <span className="rounded bg-slate-200 px-1.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                  {group.violations.length}
                </span>
              </button>
              {!isCollapsed
                ? group.violations.map((v) => {
                    const waived = waivedSet.has(v.id);
                    const selected = v.id === selectedId;
                    return (
                      <div
                        key={v.id}
                        className={`group flex items-center gap-3 px-4 py-1.5 ${selected ? "bg-violet-100 dark:bg-violet-900/40" : "hover:bg-slate-100 dark:hover:bg-slate-900/60"}`}
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[v.severity]}`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            select(v.id);
                            if (v.locationMm) {
                              requestCenter(v.locationMm);
                              onShowViolation(v.locationMm);
                            }
                          }}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <span
                            className={`shrink-0 font-medium text-slate-700 dark:text-slate-200 ${waived ? "line-through opacity-60" : ""}`}
                          >
                            {v.anchors
                              .map((a) => resolveAnchorLabel(a, projection))
                              .join(" ↔ ")}
                          </span>
                          {v.layer ? (
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {v.layer}
                            </span>
                          ) : null}
                          {v.measuredMm !== undefined &&
                          v.requiredMm !== undefined ? (
                            <span className="shrink-0 text-[11px] text-slate-500">
                              {v.measuredMm.toFixed(3)} /{" "}
                              {v.requiredMm.toFixed(3)} mm
                            </span>
                          ) : null}
                          <span className="truncate text-[11px] text-slate-500">
                            {v.message}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleWaived(v.id)}
                          title={waived ? "Un-waive" : "Waive (accept)"}
                          className="shrink-0 cursor-pointer rounded px-1.5 text-[11px] text-slate-400 opacity-0 hover:text-slate-700 group-hover:opacity-100 dark:hover:text-slate-200"
                        >
                          {waived ? "↩" : "waive"}
                        </button>
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>

      {projection ? (
        <PcbDesignRulesDialog
          open={rulesOpen}
          board={projection.board}
          netNames={projection.netNames}
          onClose={() => setRulesOpen(false)}
          onSave={handleSaveRules}
        />
      ) : null}
    </div>
  );
}
