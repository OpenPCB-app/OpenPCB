import { ChevronDown, ChevronRight, Play, X } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@shared/frontend/ui/button";
import { Checkbox } from "@shared/frontend/ui/checkbox";
import { IconButton } from "@shared/frontend/ui/icon-button";
import { SeverityDiamond } from "@shared/frontend/ui/severity-diamond";
import type {
  DrcRuleCode,
  DrcRunSnapshot,
  DrcSeverity,
} from "../../../../sdks";
import { createDesignerApi } from "../api";
import { isDrcRunActive, useDrcStore } from "../pcb/drc/drc-store";
import { useDrcRun } from "../pcb/drc/use-drc-run";
import { CODE_LABEL, resolveAnchorLabel } from "../pcb/drc/drc-labels";
import { usePcbViewStore } from "../pcb/pcb-view-store";
import { usePcbDesignRulesDialog } from "../pcb/use-pcb-design-rules-dialog";
import { DrcEvidenceSummary } from "./DrcEvidenceSummary";
import { NetIdentityPanel } from "../net-identity/NetIdentityPanel";
import type { NetIdentityPanelActions } from "../net-identity/use-net-identity-panel";
import { useIdentityPcbProjection } from "../net-identity/use-identity-pcb-projection";
import { NON_OVERRIDABLE } from "../../../../shared/drc/severity";
import {
  validationReportNotice,
  validationReportState,
} from "./validation-report-state";

const DRC_SESSION_ID = "designer-drc-session";

interface DesignerDrcViewProps {
  backendURL?: string | null;
  moduleId: string;
  designId: string | null;
  /** Current PCB projection revision, for stale detection. */
  revision: number | null;
  commandScope?: string;
  netIdentityActions?: NetIdentityPanelActions;
  /** Jump to the PCB view centered on a violation location (mm). */
  onShowViolation: (locationMm: { x: number; y: number }) => void;
  /**
   * When provided, the header shows a close (×) button. Used by the in-PCB-tab
   * dock; omitted by the standalone full-screen DRC tab.
   */
  onClose?: () => void;
}

const SEVERITY_RANK: Record<DrcSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Work-based progress only. The engine reports the stage it is on out of the
 * stages it will run (09 §4) and explicitly reports no time, so nothing here
 * turns progress into an ETA — a wall-clock promise the engine never made is
 * worse than no promise.
 */
function progressLabel(run: DrcRunSnapshot): string {
  const { stage, index, total } = run.progress;
  if (run.status === "queued" || stage === "queued") return "Queued…";
  if (total <= 0) return stage;
  return `${stage} · ${index + 1}/${total}`;
}

export function DesignerDrcView({
  backendURL,
  moduleId,
  designId,
  revision,
  commandScope,
  netIdentityActions,
  onShowViolation,
  onClose,
}: DesignerDrcViewProps): ReactElement {
  const api = useMemo(
    () => createDesignerApi({ backendURL, moduleId }),
    [backendURL, moduleId],
  );
  const reportRaw = useDrcStore((s) => s.report);
  const report = reportRaw?.designId === designId ? reportRaw : null;
  const runRaw = useDrcStore((s) => s.run);
  const run = runRaw?.designId === designId ? runRaw : null;
  const starting = useDrcStore((s) => s.starting);
  const reportIsPrevious = useDrcStore((s) => s.reportIsPrevious);
  const error = useDrcStore((s) => s.error);
  const cancelNotice = useDrcStore((s) => s.cancelNotice);
  const dismissCancelNotice = useDrcStore((s) => s.dismissCancelNotice);
  const selectedId = useDrcStore((s) => s.selectedId);
  const select = useDrcStore((s) => s.select);
  const requestCenter = useDrcStore((s) => s.requestCenter);
  const running = isDrcRunActive(run);
  const busy = starting || running;
  const { start: startRun, cancel: cancelRun } = useDrcRun({ api, designId });
  const [cancelling, setCancelling] = useState(false);

  // The Cancel request is cooperative: the button stays in its "Cancelling…"
  // state until the backend actually ends the run (or it finishes anyway).
  useEffect(() => {
    if (!running) setCancelling(false);
  }, [running]);

  const waivedIds = usePcbViewStore((s) => s.viewState.drcWaivedViolationIds);
  const toggleWaived = usePcbViewStore((s) => s.toggleDrcWaived);

  const pcbRead = useIdentityPcbProjection(api, designId, revision);
  const projection = pcbRead.projection;
  const [filter, setFilter] = useState<Set<DrcSeverity>>(
    new Set(["error", "warning", "info"]),
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showWaived, setShowWaived] = useState(false);

  // Report hydration belongs to design opening, not identity/revision refreshes.
  useEffect(() => {
    if (!designId) return;
    let cancelled = false;
    if (useDrcStore.getState().report?.designId !== designId) {
      const initialReport = useDrcStore.getState().report;
      const initialRun = useDrcStore.getState().run;
      const canHydrate = (): boolean => {
        const state = useDrcStore.getState();
        return (
          !cancelled &&
          state.report === initialReport &&
          state.run === initialRun &&
          !state.starting
        );
      };
      void api
        .getDrcResult(designId)
        .then((r) => {
          if (!canHydrate() || !r) return;
          if (r.designId !== designId) {
            throw new Error("DRC report does not match the requested design");
          }
          useDrcStore.getState().setReport(r);
        })
        .catch((err: unknown) => {
          if (canHydrate()) {
            useDrcStore.getState().setError(
              err instanceof Error ? err.message : "DRC report unavailable",
            );
          }
        });
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
      const isWaived = !NON_OVERRIDABLE.has(v.code) && waivedSet.has(v.id);
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

  const reportState = validationReportState({
    report,
    designId,
    revision,
    previous:
      run?.status === "failed" ||
      run?.status === "cancelled" ||
      reportIsPrevious ||
      busy ||
      error !== null,
  });
  const notice = validationReportNotice("DRC", reportState);

  const onRun = (): void => {
    if (!designId) return;
    void startRun();
  };

  const onCancel = (): void => {
    setCancelling(true);
    void cancelRun().then(() => {
      if (useDrcStore.getState().error) setCancelling(false);
    });
  };

  const handleRulesSaved = useCallback(async () => {
    if (!designId) return;
    // Pull the new board (revision bumped) then re-run DRC against it.
    await pcbRead.refresh();
    void startRun();
  }, [pcbRead.refresh, designId, startRun]);

  // Shared with the PCB Board properties panel — one envelope, one save path.
  const rules = usePcbDesignRulesDialog({
    backendURL,
    moduleId,
    designId,
    sessionId: DRC_SESSION_ID,
    projection,
    fallbackRevision: revision,
    onSaved: handleRulesSaved,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel text-xs">
      <div className="flex h-[30px] shrink-0 items-center gap-2 border-b border-border px-2">
        <Button
          variant="primary"
          size="sm"
          onClick={onRun}
          disabled={busy || !designId}
          icon={<Play className="h-3 w-3" />}
        >
          {starting ? "Starting…" : running ? "Running…" : "Run DRC"}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={rules.open}
          disabled={!rules.available}
        >
          Edit rules
        </Button>
        {report ? (
          <div className="ml-auto flex items-center gap-1.5">
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
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-control px-1 py-0.5 font-mono text-2xs text-text-secondary transition-opacity hover:bg-surface-hover ${active ? "opacity-100" : "opacity-40"}`}
                  title={`Toggle ${sev}`}
                  aria-pressed={active}
                >
                  <SeverityDiamond severity={sev} />
                  {n}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="ml-auto text-2xs text-text-tertiary">
            Run DRC to validate the board.
          </span>
        )}
        {onClose || (report && [...waivedSet].length > 0) ? (
          <div className="flex shrink-0 items-center gap-2">
            {report && [...waivedSet].length > 0 ? (
              <Checkbox
                checked={showWaived}
                onChange={(e) => setShowWaived(e.target.checked)}
                label="Show waived"
                wrapperClassName="text-2xs text-text-tertiary"
              />
            ) : null}
            {onClose ? (
              <IconButton
                label="Close DRC panel"
                variant="ghost"
                size="sm"
                onClick={onClose}
              >
                <X />
              </IconButton>
            ) : null}
          </div>
        ) : null}
      </div>

      {running && run ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-2xs text-text-secondary">
                {cancelling ? "Cancelling…" : progressLabel(run)}
              </span>
              <span className="shrink-0 font-mono text-2xs tabular-nums text-text-tertiary">
                {Math.round(
                  Math.min(1, Math.max(0, run.progress.fraction)) * 100,
                )}
                %
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-control bg-surface-control">
              <div
                className="h-full rounded-control bg-selection transition-[width] duration-300"
                style={{
                  width: `${Math.round(Math.min(1, Math.max(0, run.progress.fraction)) * 100)}%`,
                }}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      ) : null}

      {cancelNotice ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-section px-2 py-1 text-2xs text-text-secondary">
          <span className="min-w-0 flex-1 truncate">
            Run cancelled
            {cancelNotice === "user" ? "" : ` (${cancelNotice})`}
          </span>
          <button
            type="button"
            onClick={dismissCancelNotice}
            className="shrink-0 cursor-pointer rounded-control px-1 text-text-tertiary hover:text-text-strong"
          >
            Dismiss
          </button>
        </div>
      ) : null}

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
        {designId && commandScope && netIdentityActions ? <NetIdentityPanel
          key={JSON.stringify([commandScope, designId])}
          api={api} scope={commandScope} designId={designId} revision={revision}
          projection={projection} projectionError={pcbRead.error}
          refreshProjection={pcbRead.refresh} {...netIdentityActions}
        /> : null}
        <div className={reportState !== "current" && report ? "opacity-60" : undefined}>
          {report && counts.errors + counts.warnings + counts.infos === 0 ? (
            <div className="m-2 rounded-control bg-surface-section px-2 py-1.5 text-xs text-text-secondary">
              {reportState !== "current"
                ? "Previous DRC report: no unwaived reported violations"
                : report.violations.length > 0
                  ? "No unwaived reported DRC violations"
                  : "No reported DRC violations"}
            </div>
          ) : null}
          {report ? (
            <>
              <DrcEvidenceSummary evidence={report.evidence} />
              {report.violations.length > 0 &&
              counts.errors + counts.warnings + counts.infos === 0
                ? ` ${report.violations.length} reported ${report.violations.length === 1 ? "violation is" : "violations are"} waived.`
                : null}
            </>
          ) : null}

          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.code);
            return (
              <div key={group.code}>
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
                  aria-expanded={!isCollapsed}
                  className="flex h-[22px] w-full cursor-pointer items-center gap-1.5 border-y border-border bg-surface-section px-2 text-2xs uppercase tracking-[.04em] text-text-tertiary"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {CODE_LABEL[group.code] ?? group.code}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-text-tertiary">
                    {group.violations.length}
                  </span>
                </button>
                {!isCollapsed
                  ? group.violations.map((v) => {
                      const waived = !NON_OVERRIDABLE.has(v.code) && waivedSet.has(v.id);
                      const selected = v.id === selectedId;
                      return (
                        <div
                          key={v.id}
                          className={`group flex items-start gap-2 border-b border-border-subtle px-[10px] py-1 ${selected ? "bg-surface-selected" : "hover:bg-surface-hover"}`}
                        >
                          <SeverityDiamond
                            severity={v.severity}
                            className="mt-1.5"
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
                            className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left"
                          >
                            <span
                              className={`w-full truncate text-xs font-medium text-text-strong ${waived ? "line-through opacity-60" : ""}`}
                            >
                              {v.anchors
                                .map((a) => resolveAnchorLabel(a, projection))
                                .join(" ↔ ")}
                            </span>
                            <span className="w-full text-2xs leading-[1.35] text-text-tertiary">
                              {v.message}
                              {v.measuredMm !== undefined &&
                              v.requiredMm !== undefined ? (
                                <span className="ml-1 font-mono">
                                  {v.measuredMm.toFixed(3)} /{" "}
                                  {v.requiredMm.toFixed(3)} mm
                                </span>
                              ) : null}
                            </span>
                          </button>
                          {v.layer ? (
                            <span className="mt-0.5 shrink-0 font-mono text-2xs text-text-disabled">
                              {v.layer}
                            </span>
                          ) : null}
                          {!NON_OVERRIDABLE.has(v.code) ? <button
                            type="button"
                            onClick={() => toggleWaived(v.id)}
                            title={waived ? "Un-waive" : "Waive (accept)"}
                            className="mt-0.5 shrink-0 cursor-pointer rounded-control px-1 text-2xs text-text-tertiary opacity-0 hover:text-text-strong group-hover:opacity-100"
                          >
                            {waived ? "↩" : "waive"}
                          </button> : null}
                        </div>
                      );
                    })
                  : null}
              </div>
            );
          })}
        </div>
      </div>

      {rules.dialog}
    </div>
  );
}
