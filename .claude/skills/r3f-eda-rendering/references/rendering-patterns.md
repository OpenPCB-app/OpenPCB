# R3F EDA Rendering Patterns — Detailed Reference

## InstancedMesh pattern (pads, vias, pins, junctions)

Use `InstancedMesh` for ANY element that appears many times with the same geometry but different position/rotation/scale/color. This is the primary GPU batching strategy.

### When to use
- PCB pads (dozens to hundreds per board)
- PCB vias
- Schematic pin dots
- Junction dots
- Any repeated marker or indicator

### Pattern

```tsx
function PadInstances({ pads, color }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { invalidate } = useThree();

  // Shared geometry — created once
  const geometry = useMemo(() => new THREE.CircleGeometry(0.5, 16), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  // Update instance matrices when data changes
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      position.set(pad.x, pad.y, 0);
      quaternion.setFromEuler(new THREE.Euler(0, 0, pad.rotation));
      scale.set(pad.width, pad.height, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, color.set(pad.selected ? '#ffffff' : pad.color));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = pads.length;
    invalidate();
  }, [pads, invalidate]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, pads.length]}
      renderOrder={RENDER_ORDER.PINS}
    />
  );
}
```

### Rules
- Create geometry and material via `useMemo` — never in render body
- Update instance matrices in `useEffect`, not `useFrame`
- Always call `invalidate()` after updating instance data
- Set `mesh.count = actualCount` (may be less than args max)
- Use `setColorAt()` for per-instance colors (selection highlighting)
- Separate InstancedMesh per shape type (circles vs rectangles)

### Shape separation
Circle pads and rect pads need separate InstancedMesh instances because they use different geometry:
```tsx
<>
  <instancedMesh args={[circleGeom, material, circleCount]}>  {/* circle pads */}
  <instancedMesh args={[planeGeom, material, rectCount]}>     {/* rect pads */}
</>
```

## Fat line pattern (PCB traces)

Use `LineSegments2` from Three.js addons for traces that need world-unit width (width in mm, not pixels).

### When to use
- PCB copper traces
- Any line that must have a specific physical width

### Pattern

```tsx
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

function TraceLines({ segments, color, width }: Props) {
  const lineRef = useRef<LineSegments2>(null);
  const { invalidate, size } = useThree();

  const geometry = useMemo(() => new LineSegmentsGeometry(), []);
  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(color),
    linewidth: width,        // in world units (mm)
    worldUnits: true,        // critical — width is in scene units, not pixels
    depthTest: false,
    depthWrite: false,
    dashed: false,
  }), [color, width]);

  useEffect(() => {
    // Flatten segment pairs into Float32Array
    const positions: number[] = [];
    for (const seg of segments) {
      positions.push(seg.start.x, seg.start.y, 0);
      positions.push(seg.end.x, seg.end.y, 0);
    }
    geometry.setPositions(positions);
    invalidate();
  }, [segments, geometry, invalidate]);

  // LineMaterial needs resolution for proper rendering
  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [size, material]);

  return (
    <primitive
      object={new LineSegments2(geometry, material)}
      renderOrder={RENDER_ORDER.FRONT_COPPER}
    />
  );
}
```

### Rules
- Always set `worldUnits: true` for PCB traces
- Always update `material.resolution` when canvas size changes
- Use `lineCap: 'round'` if available (not in all Three.js versions — check)
- Group traces by layer + state (default, selected, preview) for separate render order
- For routing preview: same pattern but with reduced opacity

## Triangulated wire pattern (schematic wires)

Schematic wires use manually triangulated rectangles (not Line2) for WebGPU forward-compatibility.

### When to use
- Schematic wires only
- Any line that needs consistent width regardless of zoom (screen-space width)

### Key difference from traces
- Schematic wires have constant screen-space apparent width
- PCB traces have world-unit physical width (changes with zoom)

### Pattern
The existing `WireLines.tsx` builds BufferGeometry from wire polylines:
1. Convert each wire segment to a rectangle (4 vertices, 2 triangles)
2. Add corner patches where segments meet (fill the gap at elbows)
3. Use `MeshBasicMaterial` with `side: DoubleSide`

Do NOT modify this pattern without understanding the corner-patch geometry.

## Text rendering (EDAText)

All text uses `@react-three/drei`'s `<Text>` component (troika-three-text internally, MSDF SDF rendering).

### Pattern

```tsx
import { Text } from '@react-three/drei';

<Text
  position={[x, y, 0]}
  fontSize={250_000}  // in domain units (nm) — ~0.25mm
  color={color}
  anchorX="center"    // or "left", "right"
  anchorY="middle"    // or "top", "bottom"
  renderOrder={RENDER_ORDER.LABELS}
  material-depthTest={false}
  material-depthWrite={false}
>
  {textContent}
</Text>
```

### Rules
- Always set `material-depthTest={false}` and `material-depthWrite={false}`
- Font size in scene units (nanometers for schematic, mm for PCB)
- Use the `EDAText` wrapper component if it exists — it handles defaults
- For PCB text, typical font size: 0.8–1.2mm
- For schematic text, typical font size: 200,000–300,000nm

## Ratsnest lines (dashed)

```tsx
<lineSegments renderOrder={RENDER_ORDER.RATSNEST}>
  <bufferGeometry>
    <bufferAttribute attach="attributes-position" args={[positionArray, 3]} />
  </bufferGeometry>
  <lineDashedMaterial
    color="#66ccff"
    dashSize={200_000}   // in scene units
    gapSize={150_000}
    depthTest={false}
    depthWrite={false}
  />
</lineSegments>
```

**Important**: `LineDashedMaterial` requires calling `computeLineDistances()` on the geometry for dashes to render.

## Selection overlay pattern

Separate overlay geometry — do NOT modify the original object's material.

```tsx
// SelectionOverlay.tsx
<group renderOrder={RENDER_ORDER.SELECTION}>
  {/* Semi-transparent fill */}
  <mesh>
    <shapeGeometry args={[shape]} />
    <meshBasicMaterial color="#3b82f6" transparent opacity={0.12} depthTest={false} />
  </mesh>
  {/* Dashed stroke */}
  <lineSegments>
    <bufferGeometry />
    <lineDashedMaterial color="#3b82f6" dashSize={...} gapSize={...} depthTest={false} />
  </lineSegments>
</group>
```

For PCB pads: use `setColorAt()` on InstancedMesh to change pad color for selection (more efficient than overlay).

## Preview ghost pattern

Wrapper group with reduced opacity for placement/routing preview:

```tsx
<group
  position={[previewX, previewY, 0]}
  rotation={[0, 0, previewRotation]}
  renderOrder={RENDER_ORDER.PREVIEW}
>
  <meshBasicMaterial transparent opacity={0.5} />
  {/* child geometry */}
</group>
```

## Performance guidelines

1. **InstancedMesh** for repeated geometry — always. 100 individual meshes = 100 draw calls. 1 InstancedMesh with 100 instances = 1 draw call.
2. **`useMemo`** for geometry and material creation — never create in render body.
3. **`useEffect`** for instance matrix updates — not `useFrame`.
4. **`invalidate()`** after every visual change — no continuous rendering.
5. **Dispose geometry/materials** on unmount — R3F handles this for JSX-declared objects. For imperative objects, add cleanup in useEffect return.
6. **Batch BufferGeometry updates** — build full Float32Array, set once. Don't loop `geometry.setAttribute()` per element.
7. **Minimize React re-renders** — use Zustand selectors that return stable references. Use `shallow` comparison for array selectors.
