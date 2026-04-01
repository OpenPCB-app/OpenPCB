import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Loader2, AlertCircle, Box } from "lucide-react";

import { useStepLoader } from "./useStepLoader.ts";
import {
  createGeometry,
  createMaterial,
  computeBounds,
  computeCameraFit,
  disposeGroup,
} from "./geometry.ts";
import type { NormalizedMesh } from "./step-types.ts";

export interface StepViewerProps {
  assetPath: string | null;
  fileName?: string;
  className?: string;
  showPlaceholder?: boolean;
}

function Model({ meshes }: { meshes: NormalizedMesh[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, invalidate } = useThree();

  const meshObjects = useMemo(() => {
    return meshes.map((mesh) => {
      const geometry = createGeometry(mesh);
      const material = createMaterial(mesh.color);
      return { geometry, material };
    });
  }, [meshes]);

  useEffect(() => {
    return () => {
      if (groupRef.current) {
        disposeGroup(groupRef.current);
      }
    };
  }, [meshObjects]);

  useEffect(() => {
    if (!groupRef.current || meshes.length === 0) return;

    const bounds = computeBounds(meshes);
    const { position, target } = computeCameraFit(
      bounds,
      45,
      (camera as THREE.PerspectiveCamera).aspect,
    );

    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateProjectionMatrix();

    invalidate();
  }, [meshes, camera, invalidate]);

  return (
    <group ref={groupRef}>
      {meshObjects.map((obj, i) => (
        <mesh key={i} geometry={obj.geometry} material={obj.material} />
      ))}
    </group>
  );
}

export function StepViewer({
  assetPath,
  fileName,
  className = "",
  showPlaceholder = true,
}: StepViewerProps) {
  const { status, phaseLabel, meshes, error } = useStepLoader(
    assetPath,
    fileName,
  );
  const [hasWebGL, setHasWebGL] = useState(true);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) {
        setHasWebGL(false);
      }
    } catch (e) {
      setHasWebGL(false);
    }
  }, []);

  const containerClasses = `relative flex items-center justify-center rounded-lg border bg-muted/30 overflow-hidden min-h-[300px] w-full ${className}`;

  if (!hasWebGL) {
    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">
            3D preview requires WebGL. Your browser may not support it.
          </p>
        </div>
      </div>
    );
  }

  if (status === "idle") {
    if (!showPlaceholder) return null;
    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center text-muted-foreground">
          <Box className="h-8 w-8 opacity-50" />
          <p className="text-sm font-medium">
            {fileName ? `No 3D model for ${fileName}` : "No 3D model"}
          </p>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin opacity-70" />
          <p className="text-sm font-medium">{phaseLabel || "Loading..."}</p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    const errorMessage = error?.message || "Failed to load 3D model";

    return (
      <div className={containerClasses}>
        <div className="flex flex-col items-center justify-center space-y-3 p-6 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 text-destructive opacity-80" />
          <p className="text-sm font-medium text-destructive">{errorMessage}</p>
        </div>
      </div>
    );
  }

  const controlsTarget = useMemo(() => {
    if (meshes.length === 0) return new THREE.Vector3();
    return computeBounds(meshes).center;
  }, [meshes]);

  return (
    <div className={containerClasses}>
      <Canvas
        frameloop="demand"
        camera={{ fov: 45, position: [0, 0, 10] }}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-5, 3, -5]} intensity={0.6} />
        <directionalLight position={[0, -5, -5]} intensity={0.3} />

        <Model meshes={meshes} />

        <OrbitControls
          makeDefault
          enableDamping={true}
          dampingFactor={0.05}
          minDistance={0.5}
          maxDistance={50}
          rotateSpeed={0.5}
          target={controlsTarget}
        />
      </Canvas>
    </div>
  );
}
