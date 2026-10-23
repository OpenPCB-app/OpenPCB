import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DesignerNetIdentityStatus } from "../../../../sdks/designer";
import type { NetIdentityApi } from "./use-net-identity-panel";

export type IdentityOperationLock = RefObject<{ key: string } | null>;
interface Input { api: NetIdentityApi; scope: string; designId: string; revision: number | null }
interface Observation { key: string; status: DesignerNetIdentityStatus | null; loading: boolean; error: string | null }
export const identityErrorMessage = (error: unknown) => error instanceof Error ? error.message : "Identity request failed";

export function useNetIdentityObservation(input: Input, lock: IdentityOperationLock) {
  const { api, scope, designId, revision } = input;
  const key = JSON.stringify([scope, designId]);
  const currentKey = useRef(key); currentKey.current = key;
  const mounted = useRef(true), request = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current += 1; }; }, []);
  const current = () => mounted.current && currentKey.current === key;
  const [state, setState] = useState<Observation>({ key, status: null, loading: true, error: null });
  const load = useCallback(async () => {
    const token = ++request.current;
    setState({ key, status: null, loading: true, error: null });
    try {
      const status = await api.getNetIdentity(designId);
      if (mounted.current && currentKey.current === key && token === request.current) {
        setState({ key, status, loading: false, error: null });
      }
      return status;
    } catch (error) {
      if (mounted.current && currentKey.current === key && token === request.current) {
        setState({ key, status: null, loading: false, error: identityErrorMessage(error) });
      }
      throw error;
    }
  }, [api, designId, key]);
  useEffect(() => {
    if (lock.current?.key === key || state.key === key && state.status?.revision === revision) return;
    void load().catch(() => {});
  }, [key, revision, load]);
  const visible = state.key === key ? state : { key, status: null, loading: true, error: null };
  return { ...visible, current, load };
}
