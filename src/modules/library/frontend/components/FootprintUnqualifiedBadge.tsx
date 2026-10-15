import type { ReactElement } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@shared/frontend/ui";
import type { LibraryFootprintQualification } from "../../../../sdks/library";

/** A generated footprint that failed qualification (H15 §3.4): the server refuses it as a new default. */
export function isUnqualifiedFootprint(
  qualification: LibraryFootprintQualification | null | undefined,
): boolean {
  return qualification?.status === "unqualified-generator";
}

/** Danger badge with the qualification reason as its title; renders nothing otherwise. */
export function FootprintUnqualifiedBadge({
  qualification,
}: {
  qualification: LibraryFootprintQualification | null | undefined;
}): ReactElement | null {
  if (!qualification || !isUnqualifiedFootprint(qualification)) return null;
  const reason =
    qualification.reason ?? "Generated footprint failed qualification.";
  return (
    <Badge
      tone="danger"
      icon={<AlertTriangle aria-hidden />}
      title={reason}
      aria-label={`Unqualified footprint: ${reason}`}
      data-testid="footprint-unqualified-badge"
    >
      Unqualified
    </Badge>
  );
}
