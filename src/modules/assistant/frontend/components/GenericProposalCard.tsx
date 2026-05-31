import { useEffect, useState, type ReactElement } from "react";
import { ExternalLink } from "lucide-react";
import type { AssistantWriteProposalDto } from "../../../../sdks/assistant";
import { useNavigationStore } from "../../../../core/frontend/src/stores/navigation-store";

type GenericRiskLevel = "low" | "medium" | "high" | "destructive" | string;

interface GenericOperation {
  id: string;
  kind: string;
  title: string;
  summary: string;
  riskLevel?: GenericRiskLevel | null;
  warnings?: string[];
}

interface GenericSource {
  id: string;
  kind: string;
  label: string;
  refId?: string;
}

type GenericProposalRecord = AssistantWriteProposalDto & {
  toolName?: string | null;
  title?: string | null;
  summary?: string | null;
  riskLevel?: GenericRiskLevel | null;
  operations?: GenericOperation[];
  sources?: GenericSource[];
  warnings?: string[];
  envelope?: {
    toolName?: string;
    title?: string;
    summary?: string;
    riskLevel?: GenericRiskLevel;
    operations?: GenericOperation[];
    sources?: GenericSource[];
    warnings?: string[];
  } | null;
};

export function GenericProposalCard({
  proposal,
  assistantBaseUrl,
  onProposalChanged,
  compact = false,
}: {
  proposal: GenericProposalRecord;
  assistantBaseUrl?: string | null;
  onProposalChanged?: (change: {
    kind: "applied" | "rejected";
    designId: string;
    revision?: number;
  }) => void;
  compact?: boolean;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmPartial, setConfirmPartial] = useState(false);
  const [localStatus, setLocalStatus] = useState(proposal.status);
  const navigateToModule = useNavigationStore((s) => s.navigateToModule);
  const designId = proposal.designId || null;
  useEffect(() => {
    setLocalStatus(proposal.status);
  }, [proposal.status]);
  const operations = proposal.operations?.length
    ? proposal.operations
    : (proposal.envelope?.operations ?? []);
  const warnings = proposal.warnings?.length
    ? proposal.warnings
    : (proposal.envelope?.warnings ?? []);
  const sources = proposal.sources?.length
    ? proposal.sources
    : (proposal.envelope?.sources ?? []);
  const title = proposal.title ?? proposal.envelope?.title ?? proposal.kind;
  const summary =
    proposal.summary ??
    proposal.envelope?.summary ??
    "Pending AI write proposal.";
  const risk = proposal.riskLevel ?? proposal.envelope?.riskLevel ?? "medium";
  const toolName =
    proposal.toolName ?? proposal.envelope?.toolName ?? proposal.kind;
  const isActionable = localStatus === "pending" && Boolean(assistantBaseUrl);
  const operationGroups = groupOperations(operations);
  const operationLimit = compact ? 5 : 8;
  const hiddenOperationCount = operationGroups.reduce(
    (count, group) => count + Math.max(0, group.items.length - operationLimit),
    0,
  );

  async function applyProposal(): Promise<void> {
    if (!assistantBaseUrl) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(
        `${assistantBaseUrl}/chats/${proposal.chatId}/write-proposals/${proposal.id}/apply`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowPartial: confirmPartial }),
        },
      );
      if (!response.ok) {
        const problem = (await response.json().catch(() => ({}))) as {
          detail?: string;
          title?: string;
        };
        const message = problem.detail ?? problem.title ?? "Apply failed";
        if (/confirm partial/i.test(message)) setConfirmPartial(true);
        throw new Error(message);
      }
      const result = (await response.json()) as {
        designId?: string;
        applied?: Array<{ revision?: number }>;
        status?: "applied" | "partial" | "failed";
        operations?: Array<{ revisionAfter?: number }>;
        message?: string;
      };
      const nextStatus =
        result.status === "partial" || result.status === "failed"
          ? result.status
          : "applied";
      setLocalStatus(nextStatus);
      setConfirmPartial(false);
      setActionMessage(
        result.message ??
          (nextStatus === "applied"
            ? "Proposal applied."
            : "Proposal partially applied or failed."),
      );
      const revisionFromPlacement = result.applied?.reduce<number | undefined>(
        (max, item) =>
          item.revision === undefined
            ? max
            : max === undefined
              ? item.revision
              : Math.max(max, item.revision),
        undefined,
      );
      const revisionFromOperations = result.operations?.reduce<
        number | undefined
      >(
        (max, item) =>
          item.revisionAfter === undefined
            ? max
            : max === undefined
              ? item.revisionAfter
              : Math.max(max, item.revisionAfter),
        undefined,
      );
      if (nextStatus === "applied" || revisionFromOperations !== undefined) {
        onProposalChanged?.({
          kind: "applied",
          designId: result.designId ?? proposal.designId,
          revision: revisionFromPlacement ?? revisionFromOperations,
        });
      }
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function rejectProposal(): Promise<void> {
    if (!assistantBaseUrl) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(
        `${assistantBaseUrl}/chats/${proposal.chatId}/write-proposals/${proposal.id}/reject`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Reject failed");
      setLocalStatus("rejected");
      setActionMessage("Proposal rejected.");
      onProposalChanged?.({ kind: "rejected", designId: proposal.designId });
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function allowToolForSession(): Promise<void> {
    if (!assistantBaseUrl) return;
    setBusy(true);
    setActionMessage(null);
    try {
      const response = await fetch(
        `${assistantBaseUrl}/chats/${proposal.chatId}/write-policy/session-allow`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolName,
            proposalKind: proposal.kind,
            riskLevel: risk,
          }),
        },
      );
      if (!response.ok) throw new Error("Session allow failed");
      setActionMessage(
        "Future proposals from this tool will auto-apply this session.",
      );
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-full space-y-2 overflow-hidden rounded-lg border border-sky-300 bg-sky-50/80 p-3 text-xs text-slate-800 dark:border-sky-800/70 dark:bg-sky-950/25 dark:text-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <div className="break-words font-semibold text-sky-950 dark:text-sky-100">
          {title}
        </div>
        <span className="rounded-full bg-slate-900/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600 dark:bg-white/10 dark:text-slate-300">
          {localStatus}
        </span>
        <span className={riskClass(risk)}>{risk}</span>
        {designId ? (
          <button
            type="button"
            onClick={() => navigateToModule("designer", designId)}
            title="Open this design in the editor"
            className="ml-auto inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ExternalLink className="h-3 w-3" /> Open design
          </button>
        ) : null}
      </div>
      <div className="break-words text-[11px] text-slate-600 dark:text-slate-300">
        {summary}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400">
        {toolName} · {operations.length} operation(s) · {sources.length}{" "}
        source(s)
      </div>
      {operations.length > 0 ? (
        <div className="space-y-2 text-[11px] text-slate-700 dark:text-slate-300">
          {operationGroups.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {group.label}
              </div>
              <ul className="space-y-1">
                {group.items.slice(0, operationLimit).map((operation) => (
                  <li
                    key={operation.id}
                    className="rounded bg-white/60 p-2 dark:bg-slate-950/40"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{operation.title}</span>
                      {operation.riskLevel ? (
                        <span className={riskClass(operation.riskLevel)}>
                          {operation.riskLevel}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {operation.summary}
                    </div>
                    {operation.warnings?.length ? (
                      <div className="mt-1 text-amber-600 dark:text-amber-300">
                        {operation.warnings.join(" · ")}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              {group.items.length > operationLimit ? (
                <div className="text-[11px] text-slate-500">
                  +{group.items.length - operationLimit} more in{" "}
                  {group.label.toLowerCase()}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {hiddenOperationCount > 0 ? (
        <div className="text-[11px] text-slate-500">
          +{hiddenOperationCount} hidden operation(s)
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded bg-amber-100 p-2 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}
      <div
        className={`flex flex-wrap gap-2 ${compact ? "[&>button]:flex-1 [&>button]:whitespace-nowrap" : ""}`}
      >
        <button
          type="button"
          disabled={busy || !isActionable}
          onClick={() => void applyProposal()}
          className="rounded bg-sky-600 px-2 py-1 text-[11px] text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {confirmPartial ? "Apply anyway" : "Apply"}
        </button>
        <button
          type="button"
          disabled={busy || !isActionable}
          onClick={() => void rejectProposal()}
          className="rounded bg-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Reject
        </button>
        <button
          type="button"
          disabled={busy || !isActionable}
          onClick={() => void allowToolForSession()}
          className="rounded border border-sky-500/50 px-2 py-1 text-[11px] text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:text-sky-200 dark:hover:bg-sky-950/50"
        >
          Allow this tool this session
        </button>
      </div>
      {actionMessage ? (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          {actionMessage}
        </div>
      ) : null}
    </div>
  );
}

function riskClass(risk: GenericRiskLevel): string {
  const base = "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide";
  if (risk === "destructive")
    return `${base} bg-red-500/15 text-red-700 dark:text-red-300`;
  if (risk === "high")
    return `${base} bg-orange-500/15 text-orange-700 dark:text-orange-300`;
  if (risk === "medium")
    return `${base} bg-amber-500/15 text-amber-700 dark:text-amber-300`;
  return `${base} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`;
}

function groupOperations(operations: GenericOperation[]): Array<{
  label: string;
  items: GenericOperation[];
}> {
  const order = ["Parts", "Wires", "Labels & ports", "Deletes", "Other"];
  const groups = new Map<string, GenericOperation[]>();
  for (const operation of operations) {
    const kind = operation.kind.toLowerCase();
    const label = kind.includes("delete")
      ? "Deletes"
      : kind.includes("wire") || kind.includes("junction")
        ? "Wires"
        : kind.includes("label") ||
            kind.includes("primitive") ||
            kind.includes("port")
          ? "Labels & ports"
          : kind.includes("part") || kind.includes("place")
            ? "Parts"
            : "Other";
    const items = groups.get(label) ?? [];
    items.push(operation);
    groups.set(label, items);
  }
  return order
    .map((label) => ({ label, items: groups.get(label) ?? [] }))
    .filter((group) => group.items.length > 0);
}
