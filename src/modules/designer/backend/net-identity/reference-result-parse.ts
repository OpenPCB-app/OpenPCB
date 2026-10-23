import type { DesignerNetReferenceAmbiguousResult, DesignerNetReferenceDanglingResult } from "../../../../sdks/designer/types";

type Failure = DesignerNetReferenceDanglingResult | DesignerNetReferenceAmbiguousResult;
const REASONS: ReadonlySet<string> = new Set<DesignerNetReferenceDanglingResult["reason"]>([
  "unknown", "retired", "pending", "foreign", "foreign-design", "unknown-name",
]);

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

export function parseNetReferenceFailure(value: Record<string, unknown>): Failure | null {
  if (value.ok !== false || typeof value.field !== "string" || !value.field ||
    typeof value.detail !== "string" || !value.detail) return null;
  const common = { ok: false as const, field: value.field, detail: value.detail };
  if (value.code === "NET_REFERENCE_AMBIGUOUS") {
    return typeof value.netName === "string" && strings(value.candidates) ? {
      ...common, code: value.code, netName: value.netName, candidates: [...value.candidates],
    } : null;
  }
  if (value.code !== "NET_REFERENCE_DANGLING" ||
    (value.netId !== null && typeof value.netId !== "string") ||
    (value.netName !== undefined && typeof value.netName !== "string") ||
    typeof value.reason !== "string" || !REASONS.has(value.reason) || !strings(value.successorIds)) return null;
  return {
    ...common, code: value.code, netId: value.netId,
    ...(value.netName !== undefined ? { netName: value.netName } : {}),
    reason: value.reason as DesignerNetReferenceDanglingResult["reason"], successorIds: [...value.successorIds],
  };
}
