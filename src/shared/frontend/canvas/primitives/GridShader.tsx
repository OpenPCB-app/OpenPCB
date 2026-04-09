import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

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
uniform vec3 uOriginColor;
uniform float uOriginAlpha;
uniform float uPixelsPerUnit;
uniform float uMinSpacingPx;
varying vec2 vWorldPos;

void main() {
  float gridPx = uGridSize * uPixelsPerUnit;
  if (gridPx < uMinSpacingPx) discard;

  vec2 gridCoord = vWorldPos / uGridSize;
  vec2 grid = abs(fract(gridCoord - 0.5) - 0.5);
  vec2 lineWidth = fwidth(gridCoord);
  vec2 draw = smoothstep(lineWidth * 0.5, lineWidth * 1.5, grid);
  float minorLine = 1.0 - min(draw.x, draw.y);

  float majorSize = uGridSize * uMajorEvery;
  vec2 majorCoord = vWorldPos / majorSize;
  vec2 majorGrid = abs(fract(majorCoord - 0.5) - 0.5);
  vec2 majorLineWidth = fwidth(majorCoord);
  vec2 majorDraw = smoothstep(majorLineWidth * 0.5, majorLineWidth * 1.5, majorGrid);
  float majorLine = 1.0 - min(majorDraw.x, majorDraw.y);

  vec2 originDist = abs(vWorldPos);
  vec2 originWidth = fwidth(vWorldPos) * 2.0;
  vec2 originDraw = smoothstep(originWidth * 0.5, originWidth * 1.5, originDist);
  float originLine = 1.0 - min(originDraw.x, originDraw.y);

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

interface GridShaderProps {
  gridSize: number;
  majorEvery?: number;
  color?: [number, number, number];
  alpha?: number;
  majorAlpha?: number;
  originColor?: [number, number, number];
  originAlpha?: number;
  minSpacingPx?: number;
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
    [
      alpha,
      color,
      gridSize,
      majorAlpha,
      majorEvery,
      minSpacingPx,
      originAlpha,
      originColor,
    ],
  );

  uniforms.uGridSize.value = gridSize;
  uniforms.uMajorEvery.value = majorEvery;
  uniforms.uGridColor.value.set(...color);
  uniforms.uGridAlpha.value = alpha;
  uniforms.uMajorAlpha.value = majorAlpha;
  uniforms.uOriginColor.value.set(...originColor);
  uniforms.uOriginAlpha.value = originAlpha;
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
