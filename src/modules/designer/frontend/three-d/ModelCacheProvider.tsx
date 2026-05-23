import {
  createContext,
  useEffect,
  useContext,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ModelLoadStatus = "idle" | "loading" | "ready" | "failed";

export interface ModelCache {
  getModel(glbUrl: string, glbSha256: string): Promise<THREE.Group | null>;
  getStatus(glbSha256: string): ModelLoadStatus;
  peekModel(glbSha256: string): THREE.Group | null;
  dispose(): void;
}

type MeshLike = THREE.Object3D & {
  isMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

type LoadBaseModel = (glbUrl: string) => Promise<THREE.Group | null>;

const ModelCacheContext = createContext<ModelCache | null>(null);

function cloneMaterial(
  material: THREE.Material | THREE.Material[],
): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) return material.map((item) => item.clone());
  return material.clone();
}

export function cloneModelScene(source: THREE.Group): THREE.Group {
  const clone = source.clone(true) as THREE.Group;
  clone.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
    if (mesh.material) mesh.material = cloneMaterial(mesh.material);
  });
  return clone;
}

export function disposeModelScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.dispose();
    } else {
      mesh.material?.dispose();
    }
  });
}

function forceDoubleSidedMaterials(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.side = THREE.DoubleSide;
    } else {
      mesh.material.side = THREE.DoubleSide;
    }
  });
}

async function parseGlb(arrayBuffer: ArrayBuffer): Promise<THREE.Group | null> {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => {
        const group = new THREE.Group();
        group.name = gltf.scene.name || "component-glb";
        group.add(gltf.scene);
        // Defense-in-depth: B.Cu placements apply scale [-1,1,1] which flips
        // winding-order parity. Existing GLBs may have been baked with single-sided
        // materials; force DoubleSide on load so old assets don't need re-conversion.
        forceDoubleSidedMaterials(group);
        resolve(group);
      },
      (error) => reject(error),
    );
  });
}

async function loadGlbScene(glbUrl: string): Promise<THREE.Group | null> {
  const response = await fetch(glbUrl);
  if (!response.ok) return null;
  return parseGlb(await response.arrayBuffer());
}

export function createModelCache(
  loadBaseModel: LoadBaseModel = loadGlbScene,
): ModelCache {
  const pendingLoads = new Map<string, Promise<THREE.Group | null>>();
  const loadedModels = new Map<string, THREE.Group>();
  const statuses = new Map<string, ModelLoadStatus>();
  let disposalGeneration = 0;

  const loadSharedModel = (
    glbUrl: string,
    glbSha256: string,
  ): Promise<THREE.Group | null> => {
    const existing = pendingLoads.get(glbSha256);
    if (existing) return existing;

    const loadGeneration = disposalGeneration;
    statuses.set(glbSha256, "loading");
    const promise = loadBaseModel(glbUrl)
      .then((group) => {
        if (!group) {
          statuses.set(glbSha256, "failed");
          return null;
        }
        if (loadGeneration !== disposalGeneration) {
          disposeModelScene(group);
          return null;
        }
        loadedModels.set(glbSha256, group);
        statuses.set(glbSha256, "ready");
        return group;
      })
      .catch(() => {
        statuses.set(glbSha256, "failed");
        return null;
      });
    pendingLoads.set(glbSha256, promise);
    void promise.finally(() => {
      if (pendingLoads.get(glbSha256) === promise) {
        pendingLoads.delete(glbSha256);
      }
    });
    return promise;
  };

  return {
    async getModel(glbUrl, glbSha256) {
      const group = await loadSharedModel(glbUrl, glbSha256);
      return group ? cloneModelScene(group) : null;
    },
    getStatus(glbSha256) {
      return statuses.get(glbSha256) ?? "idle";
    },
    peekModel(glbSha256) {
      const group = loadedModels.get(glbSha256);
      return group ? cloneModelScene(group) : null;
    },
    dispose() {
      disposalGeneration += 1;
      for (const group of loadedModels.values()) {
        disposeModelScene(group);
      }
      loadedModels.clear();
      pendingLoads.clear();
      statuses.clear();
    },
  };
}

export function ModelCacheProvider({
  children,
  cache,
}: {
  children: ReactNode;
  cache?: ModelCache;
}): ReactElement {
  const cacheRef = useRef<ModelCache | null>(cache ?? null);
  if (cache && cacheRef.current !== cache) {
    cacheRef.current = cache;
  }
  if (!cacheRef.current) {
    cacheRef.current = createModelCache();
  }
  useEffect(() => () => cacheRef.current?.dispose(), []);
  return (
    <ModelCacheContext.Provider value={cacheRef.current}>
      {children}
    </ModelCacheContext.Provider>
  );
}

export function useModelCache(): ModelCache {
  const context = useContext(ModelCacheContext);
  if (!context) {
    throw new Error("useModelCache must be used within ModelCacheProvider");
  }
  return context;
}
