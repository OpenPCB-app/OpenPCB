import { useState } from "react";
import { confirmDialog } from "@shared/frontend/ui/dialog-host-store";
import { Button } from "@shared/frontend/ui/button";
import type { CommandQueueSnapshot } from "../../../../shared/frontend/commands/revision-command-queue";
import type { DesignerAction } from "../lib/command-coordinator";

export function CommandQueueNotice({
  snapshot,
  refresh,
  discard,
  reapply,
}: {
  snapshot: CommandQueueSnapshot<DesignerAction> | null;
  refresh: () => Promise<void>;
  discard: () => Promise<void>;
  reapply: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  if (!snapshot || (!snapshot.pending && !snapshot.retained.length))
    return null;
  const run = (action: () => Promise<void>) => {
    setError(null);
    void action().catch((error: unknown) =>
      setError(
        error instanceof Error ? error.message : "Could not refresh design",
      ),
    );
  };
  return (
    <div className="shrink-0 border-b border-border px-3 py-2 text-xs">
      {snapshot.pending > 0 && (
        <span role="status">Saving design… {snapshot.pending} pending</span>
      )}
      {snapshot.retained.length > 0 && (
        <div role="alert">
          <p>
            {snapshot.retained.length} edit(s) retained in this session.
            Submission paused; no automatic retry.
          </p>
          <details>
            <summary>Review retained edits</summary>
            {snapshot.retained.map((item) => (
              <div key={item.id}>
                <p>
                  {item.state}: {item.message}
                </p>
                <pre className="max-h-48 overflow-auto">
                  {JSON.stringify(item.input, null, 2)}
                </pre>
                {item.state !== "failed" && item.input.kind === "command" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={snapshot.pending > 0}
                    onClick={() =>
                      run(async () => {
                        if (
                          await confirmDialog({
                            title: "Apply retained edit?",
                            description:
                              "Apply this retained command to the latest design? Review the command and current geometry first.",
                            confirmLabel: "Apply edit",
                          })
                        )
                          await reapply(item.id);
                      })
                    }
                  >
                    Apply this edit to refreshed design
                  </Button>
                )}
              </div>
            ))}
          </details>
          <Button
            size="sm"
            variant="secondary"
            disabled={snapshot.pending > 0}
            onClick={() => run(refresh)}
          >
            Refresh design; keep edits
          </Button>
          {" · "}
          <Button
            size="sm"
            variant="secondary"
            disabled={snapshot.pending > 0}
            onClick={() =>
              run(async () => {
                if (
                  await confirmDialog({
                    title: "Discard retained edits?",
                    description:
                      "Discard these retained edits and reload the current design?",
                    confirmLabel: "Discard edits",
                    tone: "danger",
                  })
                )
                  await discard();
              })
            }
          >
            Discard retained edits and reload
          </Button>
          <p>
            Review the current design before recreating a rejected edit. A
            failed response may already have applied.
          </p>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
