import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesignerPcbProjection } from "../../../../sdks/designer";

/** Share revision refreshes with an explicit retry; neither path hydrates DRC. */
export function useIdentityPcbProjection(
  api: { getPcbProjection(designId: string): Promise<DesignerPcbProjection> },
  designId: string | null,
  revision: number | null,
) {
  const identity = useMemo(() => ({ api, designId }), [api, designId]);
  const current = useRef(identity); current.current = identity;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request = useRef(0);
  const cache = useRef<{ identity: typeof identity; projection: DesignerPcbProjection } | null>(null);
  const pending = useRef<{ identity: typeof identity; revision: number | null; promise: Promise<DesignerPcbProjection> } | null>(null);
  const [state, setState] = useState<{ identity: typeof identity; projection: DesignerPcbProjection | null; error: string | null }>({ identity, projection: null, error: null });
  const refresh = useCallback((expectedRevision?: number): Promise<DesignerPcbProjection> => {
    if (!designId) return Promise.reject(new Error("No design selected"));
    const targetRevision = expectedRevision ?? revision;
    const previous = cache.current?.identity === identity ? cache.current.projection : null;
    if (expectedRevision !== undefined && previous?.revision === expectedRevision) return Promise.resolve(previous);
    if (pending.current?.identity === identity && pending.current.revision === targetRevision) return pending.current.promise;
    const token = ++request.current;
    const promise = api.getPcbProjection(designId).then((projection) => {
      if (projection.designId !== designId) throw new Error("PCB projection does not match the requested design");
      if (mounted.current && current.current === identity && token === request.current) {
        cache.current = { identity, projection };
        setState({ identity, projection, error: null });
      }
      return projection;
    }).catch((error: unknown) => {
      if (mounted.current && current.current === identity && token === request.current) setState({ identity, projection: previous,
        error: error instanceof Error ? error.message : "PCB projection unavailable" });
      throw error;
    }).finally(() => { if (pending.current?.promise === promise) pending.current = null; });
    pending.current = { identity, revision: targetRevision, promise };
    return promise;
  }, [api, designId, revision, identity]);
  useEffect(() => { if (designId) void refresh(revision ?? undefined).catch(() => {}); }, [designId, revision, refresh]);
  return { projection: state.identity === identity ? state.projection : null,
    error: state.identity === identity ? state.error : null, refresh };
}
