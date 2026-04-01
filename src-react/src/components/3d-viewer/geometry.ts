/**
 * Geometry Helpers for STEP Viewer
 * 
 * Pure functions for mesh conversion and scene setup.
 */

import * as THREE from "three";
import type { NormalizedMesh } from "./step-types.ts";

// ---------------------------------------------------------------------------
// Mesh Conversion
// ---------------------------------------------------------------------------

/**
 * Convert normalized mesh data to Three.js BufferGeometry
 */
export function createGeometry(mesh: NormalizedMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(mesh.positions, 3)
  );
  
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  
  if (mesh.normals) {
    geometry.setAttribute(
      "normal",
      new THREE.BufferAttribute(mesh.normals, 3)
    );
  } else {
    geometry.computeVertexNormals();
  }
  
  return geometry;
}

/**
 * Create material with PCB-appropriate settings
 */
export function createMaterial(
  color: [number, number, number] | null
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color ? new THREE.Color(color[0], color[1], color[2]) : 0x888888,
    metalness: 0.3,
    roughness: 0.65,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Bounds Computation
// ---------------------------------------------------------------------------

export interface ModelBounds {
  box: THREE.Box3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

/**
 * Compute bounding box from array of meshes
 */
export function computeBounds(meshes: NormalizedMesh[]): ModelBounds {
  const box = new THREE.Box3();
  const tempVec = new THREE.Vector3();
  
  for (const mesh of meshes) {
    const positions = mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      tempVec.set(positions[i]!, positions[i + 1]!, positions[i + 2]!);
      box.expandByPoint(tempVec);
    }
  }
  
  // Handle empty mesh case
  if (box.isEmpty()) {
    box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  }
  
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  
  const radius = size.length() / 2;
  
  return { box, center, size, radius };
}

// ---------------------------------------------------------------------------
// Camera Fitting
// ---------------------------------------------------------------------------

export interface CameraFitResult {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/**
 * Calculate camera position to fit model in view
 * Uses 1.2x padding for comfortable viewing
 */
export function computeCameraFit(
  bounds: ModelBounds,
  fov: number = 45,
  aspect: number = 1
): CameraFitResult {
  const { center, radius } = bounds;
  
  // Convert FOV to radians
  const fovRad = (fov * Math.PI) / 180;
  
  // Calculate distance to fit object
  // Use smaller of horizontal/vertical FOV for portrait screens
  const effectiveFov = Math.min(fovRad, fovRad * aspect);
  const distance = (radius * 1.2) / Math.sin(effectiveFov / 2);
  
  // Position camera at 45° angle from front-top-right
  const offset = new THREE.Vector3(1, 0.6, 1).normalize().multiplyScalar(distance);
  const position = center.clone().add(offset);
  
  return {
    position,
    target: center.clone(),
  };
}

// ---------------------------------------------------------------------------
// Disposal
// ---------------------------------------------------------------------------

/**
 * Dispose of geometry and material resources
 */
export function disposeMesh(mesh: THREE.Mesh): void {
  if (mesh.geometry) {
    mesh.geometry.dispose();
  }
  
  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material: THREE.Material) => material.dispose());
    } else {
      mesh.material.dispose();
    }
  }
}

/**
 * Dispose all meshes in a group
 */
export function disposeGroup(group: THREE.Group): void {
  group.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      disposeMesh(child);
    }
  });
  group.clear();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Default neutral gray color for meshes without color data
 */
export const DEFAULT_COLOR: [number, number, number] = [0.533, 0.533, 0.533]; // #888888
