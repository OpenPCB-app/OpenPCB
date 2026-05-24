import type { ReactElement } from "react";
import { Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AssistantMessage,
  AssistantToolEventDto,
} from "../../../../sdks/assistant";
import { ToolCard } from "./ToolCard";
import {
  ComponentResultsBlock,
  type ComponentResultsPayload,
} from "./ComponentResultCard";

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
  "prose-code:bg-slate-800",
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

export function MessageCard({
  message,
  toolEvents = [],
  loading = false,
}: {
  message: AssistantMessage;
  toolEvents?: AssistantToolEventDto[];
  loading?: boolean;
}): ReactElement {
  const isUser = message.role === "user";
  const cleanedContent = isUser
    ? message.content
    : stripResponseWrapper(message.content);
  const hasContent = cleanedContent.length > 0;
  const componentBlocks = isUser ? [] : extractComponentResults(toolEvents);
  const showWaitingDots = loading && !hasContent && toolEvents.length === 0;
  const showStreamingPulse = loading && (hasContent || toolEvents.length > 0);
  return (
    <div
      className={`flex gap-4 border-b border-slate-800/50 px-4 py-6 ${isUser ? "" : "bg-slate-900/40"}`}
    >
      <div
        className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-slate-800 text-slate-300"
            : "bg-violet-600 text-white shadow-sm shadow-violet-900/50"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">
            {isUser ? "You" : "Assistant"}
          </span>
          {showStreamingPulse ? (
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.7)]"
              title="Streaming…"
            />
          ) : null}
        </div>
        {hasContent ? (
          isUser ? (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">
              {cleanedContent}
            </div>
          ) : (
            <div className={PROSE_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {cleanedContent}
              </ReactMarkdown>
            </div>
          )
        ) : null}
        {componentBlocks.length > 0 ? (
          <div className="space-y-3">
            {componentBlocks.map((data, idx) => (
              <div key={idx} className="space-y-1.5">
                <div className="text-[10px] uppercase tracking-wider text-violet-400">
                  Components from library
                </div>
                <ComponentResultsBlock data={data} />
              </div>
            ))}
          </div>
        ) : null}
        {toolEvents.length > 0 ? (
          <div className="space-y-1.5">
            {toolEvents.map((event) => (
              <ToolCard key={event.id} event={event} />
            ))}
          </div>
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
