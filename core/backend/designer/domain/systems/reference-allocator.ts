import type { DesignHeadState } from "../design-world";

export function allocateReference(head: DesignHeadState, prefix: string): string {
  const normalizedPrefix = prefix.trim() || "U";
  const current = head.referenceCounters[normalizedPrefix] ?? 0;
  const next = current + 1;
  head.referenceCounters[normalizedPrefix] = next;
  return `${normalizedPrefix}${next}`;
}
