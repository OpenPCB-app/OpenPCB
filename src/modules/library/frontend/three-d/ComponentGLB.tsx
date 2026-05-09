import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, type ReactElement } from "react";
import {
  DoubleSide,
  type BufferGeometry,
  type Material,
  type Object3D,
} from "three";

type MeshLike = Object3D & {
  isMesh?: boolean;
  geometry?: BufferGeometry;
  material?: Material | Material[];
};

function cloneMaterial(material: Material | Material[]): Material | Material[] {
  if (Array.isArray(material)) return material.map((item) => item.clone());
  return material.clone();
}

function cloneModelScene(source: Object3D): Object3D {
  const clone = source.clone(true);
  clone.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh) return;
    if (mesh.geometry) mesh.geometry = mesh.geometry.clone();
    if (mesh.material) mesh.material = cloneMaterial(mesh.material);
  });
  return clone;
}

function forceDoubleSidedMaterials(scene: Object3D): void {
  scene.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) material.side = DoubleSide;
    } else {
      mesh.material.side = DoubleSide;
    }
  });
}

function disposeModelScene(scene: Object3D): void {
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

export function ComponentGLB({
  modelUrl,
}: {
  modelUrl: string;
  /** Reserved for future per-category material override. Currently unused —
   *  GLB materials baked by the conversion worker carry per-face OCCT colors
   *  (dark body / gold leads) which we render directly. */
  category?: string;
  mountType?: string | null;
}): ReactElement {
  const gltf = useGLTF(modelUrl);
  const invalidate = useThree((state) => state.invalidate);
  const scene = useMemo(() => {
    const cloned = cloneModelScene(gltf.scene);
    forceDoubleSidedMaterials(cloned);
    return cloned;
  }, [gltf.scene]);

  useEffect(() => {
    invalidate();
  }, [invalidate, scene]);

  useEffect(() => () => disposeModelScene(scene), [scene]);

  return <primitive object={scene} />;
}
