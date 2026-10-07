import type { AiRunEvent } from "agentkit/contracts";
export function RunVerification({ event, truncated, finishReason }: { event?: AiRunEvent; truncated: boolean; finishReason: string | null }) {
  if (!event && !truncated && finishReason !== "incomplete" && finishReason !== "max_iterations") return null;
  return <div role="status" className="mx-4 my-3 rounded-lg border border-border bg-surface-panel p-3 text-xs dark:border-border dark:bg-surface-panel">
    {event?.type === "run.verification" ? <><strong>Final verification: {event.data.status}</strong>{event.data.deficiencies.length > 0 ? <ul className="mt-1 list-disc pl-4">{event.data.deficiencies.map((detail, index) => <li key={index}>{detail}</li>)}</ul> : null}</> : null}
    {truncated ? <div>Conversation exceeds the loaded message window. Some messages are omitted.</div> : null}
    {finishReason === "incomplete" || finishReason === "max_iterations" ? <div>Answer incomplete ({finishReason}).</div> : null}
  </div>;
}
