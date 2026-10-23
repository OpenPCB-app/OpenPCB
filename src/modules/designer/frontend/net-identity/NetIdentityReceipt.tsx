import type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";

export function NetIdentityReceipt({ receipt }: { receipt: NetRebindReceipt }) {
  return <div aria-label="Repair receipt" className="space-y-1">
    <div>Updated: {receipt.traces} traces · {receipt.vias} vias · {receipt.zones} zones · {receipt.freePads} free pads · {receipt.assignments} class assignments · {receipt.lengthGroups} length groups · {receipt.diffPairs} differential pairs · {receipt.drcRules} DRC rules</div>
    <div>Removed rules: {receipt.removedRules.join(", ") || "none"}</div>
    <div>Removed differential pairs: {receipt.removedDiffPairs.join(", ") || "none"}</div>
    <div>Removed length groups: {receipt.removedLengthGroups.join(", ") || "none"}</div>
    <div>Disabled zones: {receipt.disabledZones.join(", ") || "none"}</div>
  </div>;
}
