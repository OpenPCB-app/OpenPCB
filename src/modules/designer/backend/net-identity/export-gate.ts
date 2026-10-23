import { AppError } from "../../../../core/contracts/errors";
import type { DesignerPcbProjection } from "../../../../sdks/designer";

export function assertNetIdentityExportable(pcb: DesignerPcbProjection): void {
  const summary = pcb.netIdentity;
  if (summary?.exportBlocked === false) return;
  const status = summary?.status ?? "unmigrated", mode = summary?.mode ?? "legacy";
  throw new AppError(
    `Net identity is not qualified (${status}, ${mode}). Repair net bindings before manufacturing export.`,
    422,
    "Net identity unqualified",
    "https://openpcb.dev/problems/net-identity-unqualified",
    {
      code: "NET_IDENTITY_UNQUALIFIED", identityStatus: status, mode,
      orphanedCopperCount: summary?.orphanedCopperCount ?? 0,
      inertRuleReferenceCount: summary?.inertRuleReferenceCount ?? 0,
      groups: summary?.groups.slice(0, 50) ?? [],
    },
  );
}
