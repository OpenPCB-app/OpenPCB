/**
 * Zone (Z) / keepout (K) draw-tool state: the picker options shown while a
 * ring is being sketched, plus the commit path that turns a closed ring into
 * `pcb_add_zone` / `pcb_add_keepout` (zone/keepout contract §12.3).
 *
 * The ring rule is `checkAreaRing` — the same `zoneRingValidity` the executor
 * runs — so a rejected ring keeps the sketch open with a reason instead of
 * round-tripping to the backend for the same verdict.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignerPcbAddKeepoutCommand,
  DesignerPcbAddZoneCommand,
  PcbCopperLayerId,
  PcbLayerCount,
  PcbPointMm,
  PcbZone,
} from "../../../../../sdks";
import {
  buildKeepoutAdd,
  buildZoneAdd,
  checkAreaRing,
  checkZoneHole,
} from "./area-commit";
import {
  defaultKeepoutToolOptions,
  defaultZoneToolOptions,
  reconcileKeepoutToolOptions,
  reconcileZoneToolOptions,
  type KeepoutToolOptions,
  type ZoneToolOptions,
} from "./area-tool-options";
import type { SketchTarget } from "./sketch-tool-state";

interface AreaToolsWorkspace {
  addZone(input: Omit<DesignerPcbAddZoneCommand, "type">): Promise<string | null>;
  addKeepout(
    input: Omit<DesignerPcbAddKeepoutCommand, "type">,
  ): Promise<string | null>;
  updateZone(
    zoneId: string,
    patch: { region?: { kind: "polygon"; pointsMm: PcbPointMm[]; holesMm?: PcbPointMm[][] } },
  ): Promise<boolean>;
}

export interface AreaToolsApi {
  zoneOptions: ZoneToolOptions;
  setZoneOptions(patch: Partial<ZoneToolOptions>): void;
  keepoutOptions: KeepoutToolOptions;
  setKeepoutOptions(patch: Partial<KeepoutToolOptions>): void;
  /** Last ring-validity message; cleared on the next successful commit. */
  error: string | null;
  clearError(): void;
  /**
   * Close a sketch into a persisted area. Returns the created id, or null when
   * the ring is invalid (the caller keeps the sketch open) or the dispatch
   * failed.
   */
  commit(
    target: SketchTarget,
    verticesMm: readonly PcbPointMm[],
  ): Promise<string | null>;
  /**
   * Close a cutout sketch into `zone`'s region (copper-pour contract §11).
   * Returns the zone id, or null when the cutout is rejected (the caller keeps
   * the sketch open) or the dispatch failed.
   */
  commitHole(
    zone: PcbZone,
    ringMm: readonly PcbPointMm[],
  ): Promise<string | null>;
}

function sameKeepoutLayers(
  a: readonly PcbCopperLayerId[],
  b: readonly PcbCopperLayerId[],
): boolean {
  return a.length === b.length && a.every((l, i) => l === b[i]);
}

export function useAreaTools({
  workspace,
  activeCopperLayer,
  layerCount,
  netNames,
}: {
  workspace: AreaToolsWorkspace;
  activeCopperLayer: PcbCopperLayerId;
  layerCount: PcbLayerCount;
  netNames: Readonly<Record<string, string>>;
}): AreaToolsApi {
  const [zoneOptions, setZoneOptionsState] = useState<ZoneToolOptions>(() =>
    defaultZoneToolOptions({ activeLayer: activeCopperLayer, netNames }),
  );
  const [keepoutOptions, setKeepoutOptionsState] = useState<KeepoutToolOptions>(
    () => defaultKeepoutToolOptions({ activeLayer: activeCopperLayer }),
  );
  const [error, setError] = useState<string | null>(null);

  // The first mount usually has no projection yet, so the ground-net default
  // cannot be resolved. Re-seed once when the net table actually arrives; every
  // later change only reconciles, so a user pick is never overwritten.
  const seededRef = useRef(Object.keys(netNames).length > 0);
  useEffect(() => {
    if (!seededRef.current && Object.keys(netNames).length > 0) {
      seededRef.current = true;
      setZoneOptionsState(
        defaultZoneToolOptions({ activeLayer: activeCopperLayer, netNames }),
      );
      return;
    }
    setZoneOptionsState((prev) => {
      const next = reconcileZoneToolOptions(prev, {
        layerCount,
        netNames,
        activeLayer: activeCopperLayer,
      });
      return next.layer === prev.layer &&
        next.net.netId === prev.net.netId &&
        next.net.netName === prev.net.netName
        ? prev
        : next;
    });
  }, [activeCopperLayer, layerCount, netNames]);

  useEffect(() => {
    setKeepoutOptionsState((prev) => {
      const next = reconcileKeepoutToolOptions(prev, {
        layerCount,
        activeLayer: activeCopperLayer,
      });
      return sameKeepoutLayers(next.layers, prev.layers) ? prev : next;
    });
  }, [activeCopperLayer, layerCount]);

  const setZoneOptions = useCallback((patch: Partial<ZoneToolOptions>) => {
    setZoneOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setKeepoutOptions = useCallback((patch: Partial<KeepoutToolOptions>) => {
    setKeepoutOptionsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const commit = useCallback(
    async (
      target: SketchTarget,
      verticesMm: readonly PcbPointMm[],
    ): Promise<string | null> => {
      // A cutout needs its parent zone, so it goes through `commitHole`.
      if (target === "boardShape" || target === "zoneHole") return null;
      const check = checkAreaRing(verticesMm);
      if (!check.ok) {
        setError(check.message);
        return null;
      }
      setError(null);
      return target === "zone"
        ? workspace.addZone(buildZoneAdd(verticesMm, zoneOptions))
        : workspace.addKeepout(buildKeepoutAdd(verticesMm, keepoutOptions));
    },
    [workspace, zoneOptions, keepoutOptions],
  );

  const commitHole = useCallback(
    async (
      zone: PcbZone,
      ringMm: readonly PcbPointMm[],
    ): Promise<string | null> => {
      if (zone.region.kind !== "polygon") return null;
      const outerMm = zone.region.pointsMm;
      const existing = zone.region.holesMm ?? [];
      const check = checkZoneHole(outerMm, existing, ringMm);
      if (!check.ok) {
        setError(check.message);
        return null;
      }
      setError(null);
      const ok = await workspace.updateZone(zone.id, {
        region: {
          kind: "polygon",
          pointsMm: outerMm.map((p) => ({ x: p.x, y: p.y })),
          holesMm: [
            ...existing.map((h) => h.map((p) => ({ x: p.x, y: p.y }))),
            ringMm.map((p) => ({ x: p.x, y: p.y })),
          ],
        },
      });
      return ok ? zone.id : null;
    },
    [workspace],
  );

  return {
    zoneOptions,
    setZoneOptions,
    keepoutOptions,
    setKeepoutOptions,
    error,
    clearError,
    commit,
    commitHole,
  };
}
