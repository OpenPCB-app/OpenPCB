import type { ReactElement } from "react";
import { LoadingState } from "@shared/frontend/ui/spinner";

/** Busy stage while the archive is inspected or the design is imported. */
export function ProgressStage({
  phase,
}: {
  phase: "inspecting" | "committing";
}): ReactElement {
  return (
    <LoadingState
      className="py-10"
      label={phase === "inspecting" ? "Inspecting project…" : "Importing project…"}
    />
  );
}
