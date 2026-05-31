import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../sdks";
import { disposeModelScene, useModelCache } from "./ModelCacheProvider";
import { applyPlacementTransform } from "./transform-helpers";

type ModelDescriptor = NonNullable<PcbPlacedPart["footprint"]["model3d"]>;

interface FootprintModelMetadata {
  status: string;
  hasModel: boolean;
  glbSha256: string | null;
  sourceStepSha256: string | null;
  sourceFilename: string | null;
  modelRef: unknown | null;
  converterVersion: string | null;
}

function hasReadyGlb(
  model: ModelDescriptor | null | undefined,
): model is ModelDescriptor {
  return Boolean(model?.status === "ready" && model.glbUrl && model.glbSha256);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function resolveGlbUrl(
  backendURL: string | null | undefined,
  glbUrl: string | null,
): string | null {
  if (!glbUrl) return null;
  if (/^https?:\/\//i.test(glbUrl)) return glbUrl;
  if (backendURL && glbUrl.startsWith("/")) return `${backendURL}${glbUrl}`;
  return glbUrl;
}

function metadataToDescriptor(
  footprintId: string,
  metadata: FootprintModelMetadata,
): ModelDescriptor | null {
  if (
    metadata.status !== "ready" ||
    !metadata.hasModel ||
    !metadata.glbSha256
  ) {
    return null;
  }
  return {
    status: metadata.status,
    glbUrl: `/api/modules/library/footprints/${encodePathSegment(footprintId)}/model`,
    glbSha256: metadata.glbSha256,
    sourceStepSha256: metadata.sourceStepSha256,
    sourceFilename: metadata.sourceFilename,
    modelRef: metadata.modelRef,
    converterVersion: metadata.converterVersion,
  };
}

function ComponentModel({
  backendURL,
  placement,
  boardThicknessMm,
}: {
  backendURL?: string | null;
  placement: PcbPlacedPart;
  boardThicknessMm: number;
}): ReactElement | null {
  const modelCache = useModelCache();
  const invalidate = useThree((state) => state.invalidate);
  const placementModel = placement.footprint.model3d;
  const [fetchedModel, setFetchedModel] = useState<ModelDescriptor | null>(
    null,
  );
  // The 3D model — including its `modelRef` orientation correction — is a
  // *library* asset, not frozen board data. Prefer the live library descriptor
  // so corrected orientations (and re-converted GLBs) reach already-placed
  // parts whose snapshot froze a stale modelRef. Fall back to the frozen
  // snapshot only until the live fetch resolves.
  const model =
    fetchedModel ?? (hasReadyGlb(placementModel) ? placementModel : null);
  const glbUrl = resolveGlbUrl(backendURL, model?.glbUrl ?? null);
  const glbSha256 = model?.glbSha256 ?? null;

  const prepareScene = (loadedScene: THREE.Group): THREE.Group => {
    applyPlacementTransform(loadedScene, placement, boardThicknessMm);
    return loadedScene;
  };

  const initialScene = useMemo(() => {
    if (!glbSha256) return null;
    const cached = modelCache.peekModel(glbSha256);
    return cached ? prepareScene(cached) : null;
  }, [boardThicknessMm, glbSha256, modelCache, placement]);
  const [scene, setScene] = useState(initialScene);

  useEffect(() => {
    if (!backendURL) {
      setFetchedModel(null);
      return undefined;
    }

    const controller = new AbortController();
    const footprintId = placement.footprint.footprintId;
    void fetch(
      `${backendURL}/api/modules/library/footprints/${encodePathSegment(footprintId)}/model/meta`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: FootprintModelMetadata;
        };
        return payload.ok && payload.data
          ? metadataToDescriptor(footprintId, payload.data)
          : null;
      })
      .then((descriptor) => {
        if (!controller.signal.aborted) {
          setFetchedModel(descriptor);
          invalidate();
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetchedModel(null);
      });

    return () => controller.abort();
  }, [backendURL, invalidate, placement.footprint.footprintId]);

  useEffect(() => {
    setScene(null);

    if (!glbUrl || !glbSha256) {
      invalidate();
      return undefined;
    }

    let cancelled = false;
    void modelCache
      .getModel(glbUrl, glbSha256)
      .then((loadedScene) => {
        if (cancelled) {
          if (loadedScene) disposeModelScene(loadedScene);
          return;
        }
        if (!loadedScene) {
          invalidate();
          return;
        }
        setScene(prepareScene(loadedScene));
        invalidate();
      })
      .catch(() => {
        if (!cancelled) {
          invalidate();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [boardThicknessMm, glbSha256, glbUrl, invalidate, modelCache, placement]);

  useEffect(() => {
    if (!scene) return undefined;
    return () => disposeModelScene(scene);
  }, [scene]);

  if (scene) {
    return (
      <primitive data-testid="designer-3d-component-model" object={scene} />
    );
  }

  return null;
}

export function ComponentModelLayer({
  backendURL,
  placements,
  boardThicknessMm,
}: {
  backendURL?: string | null;
  placements: readonly PcbPlacedPart[];
  boardThicknessMm: number;
}): ReactElement | null {
  if (placements.length === 0) return null;

  return (
    <group data-testid="designer-3d-component-layer">
      {placements.map((placement) => (
        <ComponentModel
          key={placement.id}
          backendURL={backendURL}
          placement={placement}
          boardThicknessMm={boardThicknessMm}
        />
      ))}
    </group>
  );
}
