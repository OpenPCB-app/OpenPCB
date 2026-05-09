import type { Material, Object3D } from "three";
import { getCategoryMaterial } from "./category-materials";

type MeshLike = Object3D & {
  isMesh?: boolean;
  material?: Material | Material[];
};

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (!material) {
    return;
  }

  if (Array.isArray(material)) {
    for (const item of material) {
      item.dispose();
    }
    return;
  }

  material.dispose();
}

export function applyCategoryMaterial(
  scene: Object3D,
  mountType: string | null,
  tags: string[],
): void {
  scene.traverse((object) => {
    const mesh = object as MeshLike;
    if (!mesh.isMesh) {
      return;
    }

    const meshTags = [...tags, mesh.name.toLowerCase()];
    disposeMaterial(mesh.material);
    mesh.material = getCategoryMaterial(mountType, meshTags);
  });
}
