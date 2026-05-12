import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";
import { hexToNormalizedRgb } from "../theme";

const vertexShader = /* glsl */ `
varying vec2 vWorldPos;
void main() {
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
uniform float uPixelsPerUnit;
uniform float uMinSpacingPx;
varying vec2 vWorldPos;

void main() {
  float gridPx = uGridSize * uPixelsPerUnit;
  if (gridPx < uMinSpacingPx) discard;

  vec2 gridCoord = vWorldPos / uGridSize;
  vec2 grid = abs(fract(gridCoord - 0.5) - 0.5);
  vec2 lineWidth = fwidth(gridCoord);
  float dotSize = 1.5;
  vec2 draw = smoothstep(lineWidth * dotSize * 0.5, lineWidth * dotSize * 1.5, grid);
  float minorDot = (1.0 - draw.x) * (1.0 - draw.y);

  float majorSize = uGridSize * uMajorEvery;
  vec2 majorCoord = vWorldPos / majorSize;
  vec2 majorGrid = abs(fract(majorCoord - 0.5) - 0.5);
  vec2 majorLineWidth = fwidth(majorCoord);
  vec2 majorDraw = smoothstep(majorLineWidth * 1.0, majorLineWidth * 2.0, majorGrid);
  float majorDot = (1.0 - majorDraw.x) * (1.0 - majorDraw.y);

  float alpha = minorDot * uGridAlpha;
  alpha = max(alpha, majorDot * uMajorAlpha);

  if (alpha < 0.005) discard;
  gl_FragColor = vec4(uGridColor, alpha);
}
`;

interface GridShaderProps {
  gridSize: number;
  majorEvery?: number;
  /** Grid dot color as hex string or normalized RGB array */
  color?: string | [number, number, number];
  alpha?: number;
  majorAlpha?: number;
  minSpacingPx?: number;
  visible?: boolean;
}

function resolveColor(
  color: string | [number, number, number],
): [number, number, number] {
  if (typeof color === "string") {
    return hexToNormalizedRgb(color);
  }
  return color;
}

export function GridShader({
  gridSize,
  majorEvery = 5,
  color = [0.58, 0.64, 0.72],
  alpha = 0.3,
  majorAlpha = 0.12,
  minSpacingPx = 4,
  visible = true,
}: GridShaderProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const resolvedColor = resolveColor(color);

  const uniforms = useMemo(
    () => ({
      uGridSize: { value: gridSize },
      uMajorEvery: { value: majorEvery },
      uGridColor: { value: new THREE.Vector3(...resolvedColor) },
      uGridAlpha: { value: alpha },
      uMajorAlpha: { value: majorAlpha },
      uPixelsPerUnit: { value: 1.0 },
      uMinSpacingPx: { value: minSpacingPx },
    }),
    [alpha, resolvedColor, gridSize, majorAlpha, majorEvery, minSpacingPx],
  );

  uniforms.uGridSize.value = gridSize;
  uniforms.uMajorEvery.value = majorEvery;
  uniforms.uGridColor.value.set(...resolvedColor);
  uniforms.uGridAlpha.value = alpha;
  uniforms.uMajorAlpha.value = majorAlpha;
  uniforms.uMinSpacingPx.value = minSpacingPx;

  useFrame(({ camera, viewport }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const cam = camera as THREE.OrthographicCamera;
    mesh.position.x = cam.position.x;
    mesh.position.y = cam.position.y;
    mesh.scale.x = viewport.width * 3;
    mesh.scale.y = viewport.height * 3;
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
