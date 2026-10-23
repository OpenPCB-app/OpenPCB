import { asRecord } from "../value-guards";
import { validateSiRulesForSave } from "../../../../shared/drc/si/rule-input-validation";
import { readPcbBoardSettingsForMigration } from "../pcb/pcb-store";
import type { NetIdentityDb } from "./state-store";
import type { NetReferenceFailure, NetReferenceJudge } from "./command-reference-id";

interface RuleReference { owner: string; netId: string; field: string }

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function append(
  refs: RuleReference[], owner: unknown[], netId: unknown, field: string,
): void {
  if (typeof netId === "string") refs.push({ owner: JSON.stringify([...owner, netId]), netId, field });
}

function ruleReferences(value: unknown): RuleReference[] {
  const rules = asRecord(value), refs: RuleReference[] = [];
  if (!rules) return refs;
  for (const netId of Object.keys(asRecord(rules.perNetClassAssignments) ?? {})) {
    append(refs, ["assignment"], netId, `perNetClassAssignments[${JSON.stringify(netId)}]`);
  }
  array(rules.lengthMatchGroups).forEach((value, index) => {
    const group = asRecord(value);
    if (typeof group?.id !== "string") return;
    array(group.netIds).forEach((netId, member) => append(refs,
      ["lengthGroup", group.id], netId, `lengthMatchGroups[${index}].netIds[${member}]`));
  });
  array(rules.diffPairs).forEach((value, index) => {
    const pair = asRecord(value);
    if (typeof pair?.id !== "string") return;
    for (const member of ["p", "n"] as const) append(refs, ["diffPair", pair.id, member],
      pair[`${member}NetId`], `diffPairs[${index}].${member}NetId`);
  });
  array(rules.drcRules).forEach((value, index) => {
    const rule = asRecord(value);
    if (typeof rule?.id !== "string") return;
    array(rule.scopes).forEach((value, scopeIndex) => {
      const scope = asRecord(value);
      if (scope?.kind !== "net") return;
      array(scope.netIds).forEach((netId, member) => append(refs, ["drcRule", rule.id], netId,
        `drcRules[${index}].scopes[${scopeIndex}].netIds[${member}]`));
    });
  });
  return refs;
}

/** Malformed declarations remain intact for the strict command validator. */
export function validateNewRuleReferences(
  command: unknown, tx: NetIdentityDb, designId: string, judge: NetReferenceJudge,
): NetReferenceFailure | null {
  const declarations = asRecord(command);
  // Let the authoring validator report malformed SI before interpreting its
  // fields as electrical references. No command fields are normalized away.
  if (validateSiRulesForSave({
    lengthMatchGroups: declarations?.lengthMatchGroups,
    diffPairs: declarations?.diffPairs,
  })) return null;
  const refs = ruleReferences(command);
  if (!refs.length) return null;
  const stored = readPcbBoardSettingsForMigration(tx, designId, "1970-01-01T00:00:00.000Z").settings;
  const existing = new Set(ruleReferences(stored).map((ref) => ref.owner));
  for (const ref of refs) {
    if (existing.has(ref.owner)) continue;
    const failure = judge(ref.netId, ref.field);
    if (failure) return failure;
  }
  return null;
}
