/**
 * Infinite Grid — Uses a large plane with a fragment shader.
 *
 * The plane is positioned at the camera and scaled large enough to fill
 * the viewport. The fragment shader draws grid lines using fract() + fwidth()
 * for constant-pixel-width lines at any zoom.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
varying vec2 vWorldPos;
void main() {
  // Pass world position to fragment shader
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xy;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const fragmentShader = /* glsl */ `
uniform float uGridSize;
uniform float uMajorEvery;
uniform vec3 uGridColor;
uniform float uGridAlpha;
uniform float uMajorAlpha;
uniform vec3 uOriginColor;
uniform float uOriginAlpha;
uniform float uPixelsPerUnit;
uniform float uMinSpacingPx;

varying vec2 vWorldPos;

void main() {
  // Check if grid is too dense to render
  float gridPx = uGridSize * uPixelsPerUnit;
  if (gridPx < uMinSpacingPx) {
    discard;
  }

  // Minor grid lines
  vec2 gridCoord = vWorldPos / uGridSize;
  vec2 grid = abs(fract(gridCoord - 0.5) - 0.5);
  vec2 lineWidth = fwidth(gridCoord);
  vec2 draw = smoothstep(lineWidth * 0.5, lineWidth * 1.5, grid);
  float minorLine = 1.0 - min(draw.x, draw.y);

  // Major grid lines (every N minor lines)
  float majorSize = uGridSize * uMajorEvery;
  vec2 majorCoord = vWorldPos / majorSize;
  vec2 majorGrid = abs(fract(majorCoord - 0.5) - 0.5);
  vec2 majorLineWidth = fwidth(majorCoord);
  vec2 majorDraw = smoothstep(majorLineWidth * 0.5, majorLineWidth * 1.5, majorGrid);
  float majorLine = 1.0 - min(majorDraw.x, majorDraw.y);

  // Origin cross (thicker)
  vec2 originDist = abs(vWorldPos);
  vec2 originWidth = fwidth(vWorldPos) * 2.0;
  vec2 originDraw = smoothstep(originWidth * 0.5, originWidth * 1.5, originDist);
  float originLine = 1.0 - min(originDraw.x, originDraw.y);

  // Combine layers
  float alpha = minorLine * uGridAlpha;
  alpha = max(alpha, majorLine * uMajorAlpha);

  vec3 color = uGridColor;
  if (originLine > 0.01) {
    alpha = max(alpha, originLine * uOriginAlpha);
    color = mix(color, uOriginColor, originLine * 0.5);
  }

  if (alpha < 0.005) discard;
  gl_FragColor = vec4(color, alpha);
}
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GridShaderProps {
  /** Grid spacing in nanometers */
  gridSize: number;
  /** Major grid line every N minor lines */
  majorEvery?: number;
  /** Grid line color [r, g, b] normalized */
  color?: [number, number, number];
  /** Minor grid alpha (0-1) */
  alpha?: number;
  /** Major grid alpha (0-1) */
  majorAlpha?: number;
  /** Origin cross color */
  originColor?: [number, number, number];
  /** Origin cross alpha */
  originAlpha?: number;
  /** Minimum screen pixels between grid lines before hiding */
  minSpacingPx?: number;
  /** Whether grid is visible */
  visible?: boolean;
}

export function GridShader({
  gridSize,
  majorEvery = 5,
  color = [0.58, 0.64, 0.72],
  alpha = 0.3,
  majorAlpha = 0.12,
  originColor = [0.58, 0.64, 0.72],
  originAlpha = 0.4,
  minSpacingPx = 4,
  visible = true,
}: GridShaderProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uGridSize: { value: gridSize },
      uMajorEvery: { value: majorEvery },
      uGridColor: { value: new THREE.Vector3(...color) },
      uGridAlpha: { value: alpha },
      uMajorAlpha: { value: majorAlpha },
      uOriginColor: { value: new THREE.Vector3(...originColor) },
      uOriginAlpha: { value: originAlpha },
      uPixelsPerUnit: { value: 1.0 },
      uMinSpacingPx: { value: minSpacingPx },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Update uniforms reactively
  uniforms.uGridSize.value = gridSize;
  uniforms.uMajorEvery.value = majorEvery;
  uniforms.uGridColor.value.set(...color);
  uniforms.uGridAlpha.value = alpha;
  uniforms.uMajorAlpha.value = majorAlpha;
  uniforms.uOriginColor.value.set(...originColor);
  uniforms.uOriginAlpha.value = originAlpha;
  uniforms.uMinSpacingPx.value = minSpacingPx;

  // Move the grid plane to follow camera and compute pixels-per-unit
  useFrame(({ camera, viewport }) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const cam = camera as THREE.OrthographicCamera;

    // Position plane at camera center
    mesh.position.x = cam.position.x;
    mesh.position.y = cam.position.y;

    // Scale to cover viewport (with 2x margin for pan headroom)
    // viewport.width/height are already in scene units (px / zoom)
    const viewWidth = viewport.width;
    const viewHeight = viewport.height;
    mesh.scale.x = viewWidth * 3;
    mesh.scale.y = viewHeight * 3;

    // Pass pixels-per-unit to shader (camera zoom = pixels per world unit)
    uniforms.uPixelsPerUnit.value = cam.zoom;
  });

  if (!visible) return null;

  return (
    <mesh ref={meshRef} renderOrder={RENDER_ORDER.GRID} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
