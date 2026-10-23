import { useState } from "react";
import { Button } from "../../../../shared/frontend/ui/button";
import { Select } from "../../../../shared/frontend/ui/select";
import type { DesignerNetReferenceGroup } from "../../../../sdks/designer";
import { bindingForGroup, type NetRepairBinding } from "./net-identity-model";

interface Props {
  group: DesignerNetReferenceGroup;
  choices: readonly { id: string; name: string }[];
  disabled: boolean;
  onRepair(bindings: NetRepairBinding[]): Promise<void>;
}

export function NetIdentityGroupRow({ group, choices, disabled, onRepair }: Props) {
  const [selected, setSelected] = useState("");
  const active = new Map(choices.map((choice) => [choice.id, choice.name]));
  const source = group.netId ?? `Hint ${JSON.stringify(group.netName)}`;
  const clear = bindingForGroup(group, null);
  const bind = (id: string | null) => {
    const binding = bindingForGroup(group, id);
    if (binding) void onRepair([binding]);
  };
  const suggestion = group.suggestedNetId && active.has(group.suggestedNetId) ? group.suggestedNetId : null;
  return (
    <fieldset className="min-w-0 space-y-1 rounded-control border border-border p-2">
      <legend className="max-w-full break-all px-1 font-mono">{source}</legend>
      {group.netName !== null ? <div className="whitespace-pre-wrap">Source name: {JSON.stringify(group.netName)}</div> : null}
      <div>Reason: {group.reason}</div>
      <div>{group.copper.traceIds.length} traces · {group.copper.viaIds.length} vias · {group.copper.freePadIds.length} free pads · {group.copper.zoneIds.length} enabled zones · {group.disabledZoneIds.length} disabled zones · {group.rules.length} rule references</div>
      {group.candidateNetIds.length > 0 ? <div className="break-all">Candidates: {group.candidateNetIds.map((id) => active.has(id) ? `${active.get(id)} (${id})` : id).join(", ")}</div> : null}
      {group.successorNetIds.length > 0 ? <div className="break-all">Successors: {group.successorNetIds.join(", ")}</div> : null}
      <Select aria-label={`Active net for ${source}`} value={selected} disabled={disabled}
        options={choices.map((net) => ({ id: net.id, label: `${net.name} (${net.id})` }))}
        placeholder="Choose active net ID…" onChange={setSelected} containerClassName="w-full" />
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={disabled || !clear || !active.has(selected)} onClick={() => bind(selected)}>Rebind references</Button>
        <Button size="sm" disabled={disabled || !clear} onClick={() => bind(null)}>Clear references</Button>
        {suggestion ? <Button size="sm" disabled={disabled || !clear} onClick={() => bind(suggestion)}>
          Accept suggestion: {active.get(suggestion)}
        </Button> : null}
      </div>
      {!clear ? <div>No exact source hint is available for repair.</div> : null}
      <p className="text-text-tertiary">Clearing removes matching references, may remove empty rules, and disables affected zones. Rebinding does not enable disabled zones.</p>
    </fieldset>
  );
}
