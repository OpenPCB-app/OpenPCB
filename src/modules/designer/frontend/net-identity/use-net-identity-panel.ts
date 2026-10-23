import { useRef } from "react";
import type { DesignerDispatchResult, DesignerPcbProjection, DesignerPcbRebindNetReferencesCommand } from "../../../../sdks/designer";
import { confirmDialog } from "../../../../shared/frontend/ui/dialog-host-store";
import { DesignerApiProblemError, type createDesignerApi } from "../api";
import { repairLimitError, repairReadiness, type NetRepairBinding } from "./net-identity-model";
import { useNetIdentityObservation } from "./use-net-identity-observation";
import { useNetIdentityOperation } from "./use-net-identity-operation";

export interface NetIdentityPanelActions {
  dispatchCommand(command: DesignerPcbRebindNetReferencesCommand): Promise<DesignerDispatchResult>;
  onObserved(designId: string, revision: number): Promise<void>;
}
export type NetIdentityApi = Pick<ReturnType<typeof createDesignerApi>, "getNetIdentity" | "migrateNetIdentity" | "restoreNetIdentity">;
interface Input extends NetIdentityPanelActions {
  api: NetIdentityApi;
  scope: string;
  designId: string;
  revision: number | null;
  projection: DesignerPcbProjection | null;
  projectionError?: string | null;
  refreshProjection(revision?: number): Promise<DesignerPcbProjection>;
}

async function restoreBackup(api: NetIdentityApi, designId: string, current: () => boolean) {
  try { return await api.restoreNetIdentity(designId, false); }
  catch (error) {
    if (!current()) return null;
    if (!(error instanceof DesignerApiProblemError) || error.status !== 409 ||
      error.problem.type !== "https://openpcb.dev/problems/net-identity-restore-discards-edits") throw error;
    const confirmed = await confirmDialog({ title: "Discard edits after migration?", tone: "danger",
      description: "Restore the original legacy backup and discard edits made after migration. This cannot preserve those later edits.",
      confirmLabel: "Discard later edits and restore" });
    return confirmed && current() ? api.restoreNetIdentity(designId, true) : null;
  }
}

export function useNetIdentityPanel(input: Input) {
  const lock = useRef<{ key: string } | null>(null);
  const observation = useNetIdentityObservation(input, lock);
  const operation = useNetIdentityOperation(input, observation, lock);
  const repair = async (bindings: NetRepairBinding[]) => {
    const reason = repairReadiness(observation.status, input.projection, input.designId, input.revision) ?? repairLimitError(bindings);
    if (reason || input.projectionError || bindings.length === 0 || operation.action.refreshFailed) return;
    await operation.run(async () => {
      const result = await input.dispatchCommand({ type: "pcb_rebind_net_references", bindings });
      if (!result.ok) throw new Error("Repair was not applied: " + result.code);
      return { revision: result.revision, receipt: result.netRebind, message: "Repair applied at revision " + result.revision + "." };
    });
  };
  const migrate = () => operation.run(async () => {
    const status = await input.api.migrateNetIdentity(input.designId);
    return { revision: status.revision, message: "Migration request completed." };
  });
  const restore = () => operation.run(async () => {
    const status = await restoreBackup(input.api, input.designId, observation.current);
    return status ? { revision: status.revision, message: "Original legacy backup restored." } : null;
  });
  return { ...observation, ...operation, repair, migrate, restore };
}
