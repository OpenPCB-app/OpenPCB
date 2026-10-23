import type { NetReference } from "../../../../shared/electrical-identity/references";
import { copperReferenceKey, type LegacyContactEvidence } from "./evidence-types";
import type { QuarantineReason } from "./types";

export interface LegacyReferenceContext {
  legacyRootIds: ReadonlyMap<string, string>;
  namedIdsByUpperName: ReadonlyMap<string, readonly string[]>;
  legacyAutoRootsByUpperName: ReadonlyMap<string, readonly string[]>;
  evidence: LegacyContactEvidence;
}

export type LegacyReferenceBindingMethod =
  | "rootAndContact" | "rootAndPour" | "contact" | "nameHint" | "autoNameHint";

export type LegacyReferenceClassification =
  | { kind: "none" }
  | { kind: "bound"; netId: string; method: LegacyReferenceBindingMethod; clearName: boolean }
  | { kind: "quarantine"; reason: QuarantineReason; candidates: string[]; suggestedNetId: string | null };

const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareText);
}

function quarantine(
  reason: QuarantineReason, candidates: Iterable<string>, suggestedNetId: string | null = null,
): LegacyReferenceClassification {
  return { kind: "quarantine", reason, candidates: unique(candidates), suggestedNetId };
}

function physicalKey(ref: NetReference): string | null {
  switch (ref.site.kind) {
    case "trace": return copperReferenceKey("trace", ref.site.traceId);
    case "via": return copperReferenceKey("via", ref.site.viaId);
    case "freePad": return copperReferenceKey("freePad", ref.site.freePadId);
    default: return null;
  }
}

/** Classify evidence only; assignment collisions and collapsed pairs are a later pass. */
export function classifyLegacyReference(
  ref: NetReference, context: LegacyReferenceContext,
): LegacyReferenceClassification {
  if (ref.netId !== null) return classifyRoot(ref, ref.netId, context);
  const hint = ref.netName?.trim().toUpperCase();
  if (!hint) return { kind: "none" };
  const named = unique(context.namedIdsByUpperName.get(hint) ?? []);
  const autoRoots = unique(context.legacyAutoRootsByUpperName.get(hint) ?? []);
  if (named.length === 1 && autoRoots.length === 0) {
    return { kind: "bound", netId: named[0]!, method: "nameHint", clearName: false };
  }
  if (named.length === 0 && autoRoots.length === 1) {
    const result = classifyRoot(ref, autoRoots[0]!, context);
    return result.kind === "bound"
      ? { ...result, method: "autoNameHint", clearName: true }
      : result;
  }
  if (named.length + autoRoots.length >= 2) {
    const mapped = autoRoots.flatMap((root) => {
      const netId = context.legacyRootIds.get(root);
      return netId === undefined ? [] : [netId];
    });
    return quarantine("ambiguous_name", [...named, ...mapped]);
  }
  return quarantine("unknown_name", []);
}

function classifyRoot(
  ref: NetReference, root: string, context: LegacyReferenceContext,
): LegacyReferenceClassification {
  const mapped = context.legacyRootIds.get(root);
  const key = physicalKey(ref);
  const proof = key === null ? undefined : context.evidence.evidenceByRef.get(key);
  const evidence = unique(key === null
    ? context.evidence.pooledByLegacyRoot.get(root) ?? []
    : proof?.padNets ?? []);
  const candidates = [...evidence, ...(mapped === undefined ? [] : [mapped])];
  if (evidence.length >= 2) return quarantine(key === null ? "conflict" : "short", candidates);
  const target = evidence[0];
  if (target === undefined) {
    return mapped === undefined ? quarantine("no_evidence", []) : quarantine("root_only", [mapped], mapped);
  }
  if (mapped === undefined) {
    return key === null
      ? quarantine("stale_root", [target], target)
      : { kind: "bound", netId: target, method: "contact", clearName: false };
  }
  if (mapped !== target) return quarantine("conflict", candidates, key === null ? null : target);
  const pourOnly = proof !== undefined && !proof.directPadNets.has(target) && proof.pourNetIds.has(target);
  return { kind: "bound", netId: target, method: pourOnly ? "rootAndPour" : "rootAndContact", clearName: false };
}
