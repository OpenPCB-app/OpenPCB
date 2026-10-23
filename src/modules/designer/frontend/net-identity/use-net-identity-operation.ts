import { useState } from "react";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import type { NetRebindReceipt } from "../../../../sdks/designer/net-rebind";
import { identityErrorMessage, type IdentityOperationLock, type useNetIdentityObservation } from "./use-net-identity-observation";

interface Result { revision: number | null; receipt?: NetRebindReceipt; message: string | null }
interface Operation extends Result { key: string; busy: boolean; error: string | null; refreshFailed: boolean }
interface Input {
  designId: string;
  onObserved(designId: string, revision: number): Promise<void>;
  refreshProjection(revision?: number): Promise<DesignerPcbProjection>;
}
type Observation = ReturnType<typeof useNetIdentityObservation>;
const empty = (key: string): Operation => ({ key, busy: false, revision: null, message: null, error: null, refreshFailed: false });

async function readFresh(input: Input, observation: Observation): Promise<Result> {
  const [status, pcb] = await Promise.all([observation.load(), input.refreshProjection()]);
  if (observation.current()) await input.onObserved(input.designId, Math.max(status.revision, pcb.revision));
  if (status.revision !== pcb.revision) throw new Error("Identity status and active nets changed during refresh. Refresh again.");
  return { revision: null, message: null };
}

export function useNetIdentityOperation(input: Input, observation: Observation, lock: IdentityOperationLock) {
  const { key, current, load } = observation;
  const [state, setState] = useState<Operation>(() => empty(key));
  const action = state.key === key ? state : empty(key);
  const refresh = async (revision: number) => {
    if (!current()) return;
    await input.onObserved(input.designId, revision);
    if (current()) await Promise.all([load(), input.refreshProjection(revision)]);
  };
  const run = async (task: () => Promise<Result | null>) => {
    if (!current() || lock.current?.key === key) return;
    const token = { key }; lock.current = token;
    let next = { ...empty(key), busy: true }; setState(next);
    try {
      const result = await task();
      if (!current()) return;
      if (!result) { setState(empty(key)); return; }
      next = { ...next, ...result }; setState(next);
      if (result.revision !== null) await refresh(result.revision);
      if (current()) setState({ ...next, busy: false });
    } catch (error) {
      if (current()) setState({ ...next, busy: false, error: identityErrorMessage(error), refreshFailed: next.revision !== null });
    } finally { if (lock.current === token) lock.current = null; }
  };
  const retryRefresh = () => run(async () => ({ revision: action.revision, receipt: action.receipt, message: action.message }));
  return { action, run, retryRefresh, refreshStatus: () => run(() => readFresh(input, observation)) };
}
