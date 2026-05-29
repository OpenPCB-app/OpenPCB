import type { ReactElement } from "react";
import { AlertTriangle, ChevronRight, Sparkles } from "lucide-react";
import { MarkdownContent } from "../../../../shared/frontend/markdown";
import type {
  AssistantMessage,
  AssistantToolEventDto,
  AssistantWriteProposalDto,
} from "../../../../sdks/assistant";
import { ToolCard } from "./ToolCard";
import {
  PlacementProposalCard,
  parsePlacementProposal,
} from "./PlacementProposalCard";
import {
  AssistantRunStatusCard,
  type ActiveRunState,
} from "./AssistantRunStatusCard";
import {
  ComponentResultsBlock,
  type ComponentResultsPayload,
} from "./ComponentResultCard";
import { BomResultCard, type BomResultPayload } from "./BomResultCard";
import { GenericProposalCard } from "./GenericProposalCard";

const PROSE_CLASSES = [
  "prose",
  "prose-sm",
  "prose-invert",
  "max-w-none",
  "prose-p:my-2",
  "prose-headings:mt-4",
  "prose-headings:mb-2",
  "prose-headings:text-slate-100",
  "prose-li:my-0.5",
  "prose-ul:my-2",
  "prose-ol:my-2",
  "prose-pre:bg-slate-950/80",
  "prose-pre:border",
  "prose-pre:border-slate-800",
  "prose-code:bg-violet-500/15",
  "prose-code:text-violet-200",
  "prose-code:font-mono",
  "prose-code:px-1",
  "prose-code:py-0.5",
  "prose-code:rounded",
  "prose-code:before:content-none",
  "prose-code:after:content-none",
  "prose-table:text-xs",
  "prose-table:w-full",
  "prose-th:bg-slate-800/60",
  "prose-th:px-2",
  "prose-th:py-1",
  "prose-th:text-left",
  "prose-td:px-2",
  "prose-td:py-1",
  "prose-td:border",
  "prose-td:border-slate-800",
  "prose-th:border",
  "prose-th:border-slate-800",
  "prose-a:text-violet-400",
  "hover:prose-a:text-violet-300",
  "prose-blockquote:border-l-violet-700",
  "prose-blockquote:text-slate-300",
].join(" ");

const COMPACT_PROSE_CLASSES = [
  "prose",
  "prose-sm",
  "dark:prose-invert",
  "max-w-none",
  "break-words",
  "prose-p:my-2",
  "prose-headings:mt-3",
  "prose-headings:mb-1.5",
  "prose-pre:max-w-full",
  "prose-pre:overflow-x-auto",
  "prose-pre:bg-slate-100",
  "dark:prose-pre:bg-slate-950/80",
  "prose-code:break-words",
  "prose-code:bg-violet-500/10",
  "prose-code:text-violet-700",
  "dark:prose-code:text-violet-300",
  "prose-code:font-mono",
  "prose-code:before:content-none",
  "prose-code:after:content-none",
  "prose-table:text-xs",
  "prose-a:text-violet-600",
  "dark:prose-a:text-violet-400",
].join(" ");

/**
 * Defensive: strip <response>…</response> envelopes and stray `--->` artifacts
 * some local models emit when chat templates leak. Keeps real markdown intact.
 */
function stripResponseWrapper(raw: string): string {
  let text = raw.trim();
  text = text
    .replace(/^<response>\s*/i, "")
    .replace(/\s*<\/response>\s*$/i, "");
  text = text.replace(/^-{2,}>\s*$/gm, "");
  return text.trim();
}

function extractComponentResults(
  events: AssistantToolEventDto[],
): ComponentResultsPayload[] {
  const out: ComponentResultsPayload[] = [];
  for (const event of events) {
    if (event.toolName !== "library_search_components") continue;
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as ComponentResultsPayload;
      if (Array.isArray(parsed.results)) out.push(parsed);
    } catch {
      // ignore
    }
  }
  return out;
}

function extractBomResults(
  events: AssistantToolEventDto[],
): BomResultPayload[] {
  const out: BomResultPayload[] = [];
  for (const event of events) {
    if (event.toolName !== "library_resolve_bom") continue;
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as BomResultPayload;
      if (Array.isArray(parsed.items)) out.push(parsed);
    } catch {
      // ignore malformed tool payloads
    }
  }
  return out;
}

function extractPlacementProposals(events: AssistantToolEventDto[]): Array<{
  event: AssistantToolEventDto;
  proposal: NonNullable<ReturnType<typeof parsePlacementProposal>>;
}> {
  return events.flatMap((event) => {
    const proposal = parsePlacementProposal(event);
    return proposal ? [{ event, proposal }] : [];
  });
}

function extractGenericToolProposals(
  events: AssistantToolEventDto[],
  writeProposals: AssistantWriteProposalDto[],
): AssistantWriteProposalDto[] {
  const recordsById = new Map(
    writeProposals.map((record) => [record.id, record]),
  );
  const out: AssistantWriteProposalDto[] = [];
  for (const event of events) {
    if (event.status !== "succeeded" || !event.resultJson) continue;
    try {
      const parsed = JSON.parse(event.resultJson) as {
        id?: string;
        kind?: string;
        designId?: string;
        baseRevision?: number | null;
      };
      if (
        !parsed.id ||
        !parsed.kind ||
        parsed.kind === "designer_place_components"
      ) {
        continue;
      }
      const record = recordsById.get(parsed.id);
      out.push(
        record
          ? { ...record, toolEventId: record.toolEventId ?? event.id }
          : ({
              id: parsed.id,
              chatId: event.chatId,
              toolEventId: event.id,
              kind: parsed.kind,
              status: "pending",
              designId: parsed.designId ?? "",
              baseRevision: parsed.baseRevision ?? null,
              toolName: event.toolName,
              title: null,
              summary: null,
              riskLevel: null,
              operations: [],
              sources: event.sources,
              warnings: [],
              proposal: parsed,
              envelope: null,
              applyResult: null,
              createdAt: event.createdAt,
              updatedAt: event.updatedAt,
            } as AssistantWriteProposalDto),
      );
    } catch {
      // ignore malformed tool result
    }
  }
  return out;
}

export function MessageCard({
  message,
  toolEvents = [],
  loading = false,
  runState,
  assistantBaseUrl,
  backendURL,
  writeProposals = [],
  onProposalChanged,
  onStopRun,
  onRetryRun,
  compact = false,
}: {
  message: AssistantMessage;
  toolEvents?: AssistantToolEventDto[];
  loading?: boolean;
  runState?: ActiveRunState | null;
  assistantBaseUrl?: string | null;
  backendURL?: string | null;
  writeProposals?: AssistantWriteProposalDto[];
  onProposalChanged?: (change: {
    kind: "applied" | "rejected";
    designId: string;
    revision?: number;
  }) => void;
  onStopRun?: (run: ActiveRunState) => void;
  onRetryRun?: (run: ActiveRunState) => void;
  compact?: boolean;
}): ReactElement {
  const isUser = message.role === "user";
  const cleanedContent = isUser
    ? message.content
    : stripResponseWrapper(message.content);
  const hasContent = cleanedContent.length > 0;
  const reasoning = isUser ? undefined : message.metadata?.ai?.reasoning;
  const truncated = !isUser && message.metadata?.ai?.truncated === true;
  const componentBlocks = isUser ? [] : extractComponentResults(toolEvents);
  const bomBlocks = isUser ? [] : extractBomResults(toolEvents);
  const placementBlocks = isUser ? [] : extractPlacementProposals(toolEvents);
  const placementIds = new Set(
    placementBlocks.map(({ proposal }) => proposal.proposalId),
  );
  const toolEventIds = new Set(toolEvents.map((event) => event.id));
  const genericProposals = isUser
    ? []
    : extractGenericToolProposals(toolEvents, writeProposals).filter(
        (record) => !placementIds.has(record.id),
      );
  const proposalToolEventIds = new Set([
    ...placementBlocks.map(({ event }) => event.id),
    ...genericProposals.flatMap((proposal) =>
      proposal.toolEventId ? [proposal.toolEventId] : [],
    ),
  ]);
  const visibleToolEvents = toolEvents.filter(
    (event) => !proposalToolEventIds.has(event.id),
  );
  const showWaitingDots = loading && !hasContent && toolEvents.length === 0;
  const showStreamingPulse =
    Boolean(runState) || (loading && (hasContent || toolEvents.length > 0));
  const isStreaming = !isUser && (loading || Boolean(runState));

  // System messages (e.g. provider-failure / retry notices) → warning banner,
  // visually distinct from assistant content. Persists in the thread as history.
  if (message.role === "system") {
    return (
      <div className={compact ? "px-3 py-2" : "px-4 py-3"}>
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-status-warning-soft px-3 py-2 text-xs text-status-warning dark:border-amber-800/50">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{cleanedContent}</span>
        </div>
      </div>
    );
  }

  // User messages: right-aligned bubble (iMessage-style) for instant scan.
  if (isUser) {
    return (
      <div
        className={`flex min-w-0 justify-end ${compact ? "px-3 py-3" : "px-4 py-4"}`}
      >
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[10px_10px_2px_10px] border border-violet-300/40 bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 dark:border-violet-700/40 dark:text-slate-100">
          {cleanedContent}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-0 ${compact ? "gap-3 px-3 py-4" : "gap-3 px-4 py-6"}`}
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
        <Sparkles className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">
            {isUser ? "You" : "Assistant"}
          </span>
          {showStreamingPulse ? (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              · thinking…
              <span className="ml-0.5 inline-flex gap-0.5">
                <span className="h-1 w-1 animate-pulse rounded-full bg-violet-400" />
                <span
                  className="h-1 w-1 animate-pulse rounded-full bg-violet-400"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="h-1 w-1 animate-pulse rounded-full bg-violet-400"
                  style={{ animationDelay: "300ms" }}
                />
              </span>
            </span>
          ) : toolEvents.length > 0 ? (
            <span className="text-[11px] text-slate-500">
              · {toolEvents.length} tool{" "}
              {toolEvents.length === 1 ? "call" : "calls"}
            </span>
          ) : null}
        </div>
        {reasoning ? (
          // Chain-of-thought from reasoning models — a subtle one-line toggle rendered
          // before the answer (thinking precedes the response). Auto-opened when there
          // is no visible answer so the bubble is never blank.
          <details open={!hasContent} className="group">
            <summary className="inline-flex cursor-pointer select-none items-center gap-1 text-[11px] text-slate-500 transition-colors hover:text-slate-300 [&::-webkit-details-marker]:hidden">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              Reasoning
            </summary>
            <div className="mt-1.5 whitespace-pre-wrap break-words pl-4 text-[11px] leading-relaxed text-slate-500">
              {reasoning}
            </div>
          </details>
        ) : null}
        {hasContent ? (
          isUser ? (
            <div
              className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${compact ? "text-slate-800 dark:text-slate-100" : "text-slate-100"}`}
            >
              {cleanedContent}
            </div>
          ) : (
            <MarkdownContent
              className={compact ? COMPACT_PROSE_CLASSES : PROSE_CLASSES}
              streaming={isStreaming}
              mermaidTheme="dark"
            >
              {cleanedContent}
            </MarkdownContent>
          )
        ) : null}
        {truncated ? (
          <div className="flex items-center gap-1.5 text-[11px] text-status-warning">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Response may be truncated (token limit reached).
          </div>
        ) : null}
        {componentBlocks.length > 0 ? (
          <div className="space-y-3">
            {componentBlocks.map((data, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-violet-400">
                  Components from library
                </div>
                <ComponentResultsBlock data={data} compact={compact} />
              </div>
            ))}
          </div>
        ) : null}
        {bomBlocks.length > 0 ? (
          <div className="space-y-3">
            {bomBlocks.map((data, idx) => (
              <BomResultCard key={idx} data={data} compact={compact} />
            ))}
          </div>
        ) : null}
        {placementBlocks.length > 0 ? (
          <div className="space-y-3">
            {placementBlocks.map(({ event, proposal }) => (
              <PlacementProposalCard
                key={proposal.proposalId}
                event={event}
                proposal={proposal}
                assistantBaseUrl={assistantBaseUrl}
                backendURL={backendURL}
                statusRecord={
                  writeProposals.find(
                    (record) => record.id === proposal.proposalId,
                  ) ?? null
                }
                onProposalChanged={onProposalChanged}
                compact={compact}
              />
            ))}
          </div>
        ) : null}
        {genericProposals.length > 0 ? (
          <div className="space-y-3">
            {genericProposals.map((proposal) => (
              <GenericProposalCard
                key={proposal.id}
                proposal={proposal}
                assistantBaseUrl={assistantBaseUrl}
                onProposalChanged={onProposalChanged}
                compact={compact}
              />
            ))}
          </div>
        ) : null}
        {visibleToolEvents.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[9px] font-medium uppercase tracking-wider text-slate-500">
              Tools used
            </div>
            {visibleToolEvents.map((event) => (
              <ToolCard key={event.id} event={event} compact={compact} />
            ))}
          </div>
        ) : null}
        {runState ? (
          <AssistantRunStatusCard
            run={runState}
            onStop={() => onStopRun?.(runState)}
            onRetry={() => onRetryRun?.(runState)}
          />
        ) : null}
        {showWaitingDots ? (
          <span className="flex items-center gap-0.5 text-xs text-violet-400">
            <span className="animate-pulse">●</span>
            <span className="animate-pulse" style={{ animationDelay: "150ms" }}>
              ●
            </span>
            <span className="animate-pulse" style={{ animationDelay: "300ms" }}>
              ●
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
