import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import occtImportJsSource from "occt-import-js/dist/occt-import-js.js?raw";
import { getCategoryMaterial } from "./category-materials";
import type {
  ConversionResult,
  StepToGlbWorkerCancelRequest,
  StepToGlbWorkerRequest,
  StepToGlbWorkerResponse,
  TessellationParams,
} from "./step-to-glb";

const GLB_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

interface OcctImportJsModule {
  ReadStepFile(
    content: Uint8Array,
    params: TessellationParams | null,
  ): OcctReadStepResult;
}

type OcctImportJsInit = (options?: {
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<OcctImportJsModule>;

interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

interface OcctMesh {
  name?: string;
  color?: [number, number, number];
  brep_faces?: Array<{
    first: number;
    last: number;
    color: [number, number, number] | null;
  }>;
  attributes: {
    position: { array: ArrayLike<number> };
    normal?: { array: ArrayLike<number> };
  };
  index: { array: ArrayLike<number> };
}

interface OcctReadStepResult {
  success: boolean;
  error?: string;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

interface WorkerScopeLike {
  onmessage:
    | ((
        event: MessageEvent<
          StepToGlbWorkerRequest | StepToGlbWorkerCancelRequest
        >,
      ) => void)
    | null;
  postMessage(
    message: StepToGlbWorkerResponse,
    transfer?: Transferable[],
  ): void;
}

const occtWasmUrl = new URL(
  "../../../../../node_modules/occt-import-js/dist/occt-import-js.wasm",
  import.meta.url,
).href;
const initOcctImportJs = new Function(
  `${occtImportJsSource.replaceAll("import.meta.url", "self.location.href")}; return occtimportjs;`,
)() as OcctImportJsInit;
const cancelledRequests = new Set<string>();
const workerScope = self as unknown as WorkerScopeLike;
let occtPromise: Promise<OcctImportJsModule> | null = null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function errorResult(code: string, message: string): ConversionResult {
  return { status: "error", code, message };
}

function assertNotCancelled(requestId: string, deadline: number): void {
  if (cancelledRequests.has(requestId)) {
    throw new Error("conversion_cancelled");
  }
  if (performance.now() > deadline) {
    throw new Error("conversion_timeout");
  }
}

function getOcct(): Promise<OcctImportJsModule> {
  occtPromise ??= initOcctImportJs({
    locateFile: (assetPath) =>
      assetPath.endsWith(".wasm") ? occtWasmUrl : assetPath,
  });

  return occtPromise;
}

function buildGeometry(mesh: OcctMesh): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.name = mesh.name ?? "STEP mesh";
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      Array.from(mesh.attributes.position.array),
      3,
    ),
  );

  if (mesh.attributes.normal) {
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(
        Array.from(mesh.attributes.normal.array),
        3,
      ),
    );
  } else {
    geometry.computeVertexNormals();
  }

  geometry.setIndex(
    new THREE.BufferAttribute(
      Uint32Array.from(Array.from(mesh.index.array)),
      1,
    ),
  );
  return geometry;
}

function buildMaterial(
  mesh: OcctMesh,
): THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] {
  const fallback = getCategoryMaterial(null, []);
  if (mesh.color) {
    fallback.color = new THREE.Color(
      mesh.color[0],
      mesh.color[1],
      mesh.color[2],
    );
  }

  if (!mesh.brep_faces?.length) {
    return fallback;
  }

  const materials = [fallback];
  for (const face of mesh.brep_faces) {
    const material = fallback.clone();
    if (face.color) {
      material.color = new THREE.Color(
        face.color[0],
        face.color[1],
        face.color[2],
      );
    }
    materials.push(material);
  }

  return materials;
}

function addFaceGroups(geometry: THREE.BufferGeometry, mesh: OcctMesh): void {
  if (!mesh.brep_faces?.length) {
    return;
  }

  const triangleCount = mesh.index.array.length / 3;
  let triangleIndex = 0;
  let faceIndex = 0;

  while (triangleIndex < triangleCount) {
    const firstIndex = triangleIndex;
    let lastIndex = triangleCount;
    let materialIndex = 0;
    const face = mesh.brep_faces[faceIndex];

    if (face && triangleIndex < face.first) {
      lastIndex = face.first;
    } else if (face) {
      lastIndex = face.last + 1;
      materialIndex = faceIndex + 1;
      faceIndex += 1;
    }

    geometry.addGroup(
      firstIndex * 3,
      (lastIndex - firstIndex) * 3,
      materialIndex,
    );
    triangleIndex = lastIndex;
  }
}

function buildMesh(mesh: OcctMesh): THREE.Mesh {
  const geometry = buildGeometry(mesh);
  addFaceGroups(geometry, mesh);
  const threeMesh = new THREE.Mesh(geometry, buildMaterial(mesh));
  threeMesh.name = mesh.name ?? "STEP mesh";
  return threeMesh;
}

function buildGroupFromNode(node: OcctNode, meshes: OcctMesh[]): THREE.Group {
  const group = new THREE.Group();
  group.name = node.name ?? "STEP node";

  for (const meshIndex of node.meshes ?? []) {
    const mesh = meshes[meshIndex];
    if (mesh) {
      group.add(buildMesh(mesh));
    }
  }

  for (const child of node.children ?? []) {
    group.add(buildGroupFromNode(child, meshes));
  }

  return group;
}

function buildGroup(result: OcctReadStepResult): THREE.Group {
  const meshes = result.meshes ?? [];
  if (result.root) {
    return buildGroupFromNode(result.root, meshes);
  }

  const group = new THREE.Group();
  group.name = "STEP model";
  for (const mesh of meshes) {
    group.add(buildMesh(mesh));
  }
  return group;
}

/**
 * Many STEP sources (SnapEDA, Ultra Librarian, third-party CAD exports) ship
 * Y-up bodies, while the OpenPCB scene is Z-up (board on XY plane, body height
 * in +Z). Without compensation, those bodies render lying on their side in the
 * designer 3D view (the library preview uses drei <Bounds> auto-fit, which
 * masks the misorientation).
 *
 * Heuristic: for typical flat SMD/QFN/SOIC/BGA packages, the body's height is
 * the smallest of the three axis extents. Whichever axis has the smallest
 * bounding-box extent is treated as the up-axis; rotate it to Z if it isn't
 * already. Tall vertical cylinders (radial-lead caps, TO-220 standing) violate
 * this heuristic, but they're rare enough that getting QFN/SOIC right is the
 * higher-value default. KiCad model3dRef rotation (applied below) can override
 * this for parts that need explicit orientation.
 */
function correctUpAxisIfNeeded(group: THREE.Group): void {
  const box = new THREE.Box3().setFromObject(group);
  if (!isFinite(box.min.x) || !isFinite(box.max.x)) return;
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.x === 0 || size.y === 0 || size.z === 0) return;

  // Z is already smallest → assume Z-up; nothing to do.
  if (size.z <= size.x && size.z <= size.y) return;

  const correction = new THREE.Matrix4();
  if (size.y <= size.x && size.y <= size.z) {
    // Y-up source: rotate +90° about X so +Y maps to +Z (body sits on +Z).
    correction.makeRotationX(Math.PI / 2);
  } else {
    // X-up source (rare): rotate -90° about Y so +X maps to +Z.
    correction.makeRotationY(-Math.PI / 2);
  }

  group.updateMatrix();
  const next = correction.multiply(group.matrix);
  next.decompose(group.position, group.quaternion, group.scale);
}

function applyModelRefTransform(
  group: THREE.Group,
  request: StepToGlbWorkerRequest,
): void {
  const modelRef = request.modelRef;
  if (!modelRef) {
    return;
  }

  // Compose model-ref transform and MULTIPLY it onto whatever pre-existing
  // transform the group has (currently identity, but future Y-up→Z-up
  // compensation may live here). Replacing via .position.set / .rotation.set
  // would erase such compensations and is also fragile under refactor.
  const offset = new THREE.Vector3(
    modelRef.offset.x,
    modelRef.offset.y,
    modelRef.offset.z,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(modelRef.rotation.x),
      THREE.MathUtils.degToRad(modelRef.rotation.y),
      THREE.MathUtils.degToRad(modelRef.rotation.z),
      "XYZ",
    ),
  );
  const scale = new THREE.Vector3(
    modelRef.scale.x,
    modelRef.scale.y,
    modelRef.scale.z,
  );
  const transform = new THREE.Matrix4().compose(offset, quaternion, scale);

  group.updateMatrix();
  const next = transform.clone().multiply(group.matrix);
  next.decompose(group.position, group.quaternion, group.scale);
}

async function exportGlb(group: THREE.Group): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(group, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter returned JSON output instead of binary GLB");
  }

  return result;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

async function convert(
  request: StepToGlbWorkerRequest,
): Promise<ConversionResult> {
  const deadline =
    performance.now() + (request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  assertNotCancelled(request.requestId, deadline);

  const occt = await getOcct();
  assertNotCancelled(request.requestId, deadline);

  const result = occt.ReadStepFile(
    new Uint8Array(request.stepBytes),
    request.params ?? null,
  );
  assertNotCancelled(request.requestId, deadline);

  if (!result.success) {
    return errorResult(
      "occt_read_failed",
      result.error ?? "OCCT could not read the STEP file",
    );
  }

  const group = buildGroup(result);
  correctUpAxisIfNeeded(group);
  applyModelRefTransform(group, request);
  assertNotCancelled(request.requestId, deadline);

  const glbBytes = await exportGlb(group);
  assertNotCancelled(request.requestId, deadline);

  if (glbBytes.byteLength > GLB_SIZE_LIMIT_BYTES) {
    return errorResult(
      "glb_too_large",
      `Converted GLB is ${glbBytes.byteLength} bytes, exceeding ${GLB_SIZE_LIMIT_BYTES} bytes`,
    );
  }

  return { status: "ok", glbBytes, sha256: await sha256(glbBytes) };
}

workerScope.onmessage = async (
  event: MessageEvent<StepToGlbWorkerRequest | StepToGlbWorkerCancelRequest>,
) => {
  if (event.data.type === "cancel") {
    cancelledRequests.add(event.data.requestId);
    return;
  }

  const request = event.data;

  try {
    const result = await convert(request);
    const response: StepToGlbWorkerResponse = {
      requestId: request.requestId,
      ...result,
    };
    if (result.status === "ok") {
      workerScope.postMessage(response, [result.glbBytes]);
      return;
    }

    workerScope.postMessage(response);
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    const code =
      message === "conversion_timeout" || message === "conversion_cancelled"
        ? "conversion_timeout"
        : "conversion_worker_error";
    workerScope.postMessage({
      requestId: request.requestId,
      status: "error",
      code,
      message:
        code === "conversion_timeout"
          ? "STEP to GLB conversion timed out or was cancelled"
          : message,
    } satisfies StepToGlbWorkerResponse);
  } finally {
    cancelledRequests.delete(request.requestId);
  }
};

export {};
