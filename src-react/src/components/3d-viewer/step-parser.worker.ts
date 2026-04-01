/**
 * STEP Parser Web Worker
 *
 * Uses occt-import-js to parse STEP files and tessellate to mesh data.
 * Runs in a separate thread to avoid blocking the UI.
 */

import initOcctImportJs from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

import type {
    NormalizedMesh,
    StepWorkerRequest,
    StepWorkerResponse,
} from "./step-types";

interface WorkerScope {
    postMessage(message: StepWorkerResponse, transfer?: Transferable[]): void;
    onmessage: ((event: MessageEvent<StepWorkerRequest>) => void | Promise<void>) | null;
}

const workerScope = self as unknown as WorkerScope;

interface OcctResult {
    success: boolean;
    meshes: Array<{
        name: string;
        color?: [number, number, number];
        brep_faces?: { first: number; last: number }[];
        index: { array: number[] };
        attributes: {
            position: { array: number[] };
            normal?: { array: number[] };
        };
    }>;
}

interface OcctApi {
    ReadStepFile(data: Uint8Array, params: null): OcctResult;
}

let occtApi: OcctApi | null = null;
let occtInitPromise: Promise<void> | null = null;
let parseRequestId = 0;

async function initOcct(): Promise<void> {
    if (occtApi) {
        return;
    }

    if (!occtInitPromise) {
        occtInitPromise = (async () => {
            occtApi = (await initOcctImportJs({
                locateFile: (path: string) => {
                    if (path.endsWith(".wasm")) {
                        return occtWasmUrl;
                    }
                    return path;
                },
            })) as OcctApi;
        })();
    }

    try {
        await occtInitPromise;
    } finally {
        occtInitPromise = null;
    }
}

function postResponse(response: StepWorkerResponse, transferables?: Transferable[]): void {
    if (transferables && transferables.length > 0) {
        workerScope.postMessage(response, transferables);
        return;
    }
    workerScope.postMessage(response);
}

function normalizeMeshes(result: OcctResult, fileName: string): {
    meshes: NormalizedMesh[];
    transferables: Transferable[];
} {
    const meshes: NormalizedMesh[] = [];
    const transferables: Transferable[] = [];

    result.meshes.forEach((mesh, index) => {
        const positions = new Float32Array(mesh.attributes.position.array);
        const indices = new Uint32Array(mesh.index.array);
        const normals = mesh.attributes.normal
            ? new Float32Array(mesh.attributes.normal.array)
            : null;

        const color = Array.isArray(mesh.color) && mesh.color.length === 3
            ? [mesh.color[0], mesh.color[1], mesh.color[2]] as [number, number, number]
            : null;

        meshes.push({
            name: mesh.name || `${fileName}_mesh_${index}`,
            positions,
            indices,
            normals,
            color,
        });

        transferables.push(positions.buffer, indices.buffer);
        if (normals) {
            transferables.push(normals.buffer);
        }
    });

    return { meshes, transferables };
}

async function handleParse(buffer: ArrayBuffer, fileName: string): Promise<void> {
    const requestId = ++parseRequestId;

    try {
        postResponse({ type: "progress", phase: "parsing" });

        await initOcct();
        if (requestId !== parseRequestId) {
            return;
        }

        if (!occtApi) {
            throw new Error("OCCT module not initialized");
        }

        const result = occtApi.ReadStepFile(new Uint8Array(buffer), null);
        if (!result.success) {
            throw new Error("Failed to parse STEP file");
        }

        postResponse({ type: "progress", phase: "meshing" });
        if (requestId !== parseRequestId) {
            return;
        }

        const { meshes, transferables } = normalizeMeshes(result, fileName);
        postResponse({ type: "success", meshes }, transferables);
    } catch (error) {
        if (requestId !== parseRequestId) {
            return;
        }

        postResponse({
            type: "error",
            error: {
                kind: "parse_failed",
                message: error instanceof Error ? error.message : "Unknown parse error",
            },
        });
    }
}

workerScope.onmessage = async (event: MessageEvent<StepWorkerRequest>) => {
    const data = event.data;

    switch (data.type) {
        case "init": {
            try {
                await initOcct();
                postResponse({ type: "ready" });
            } catch {
                postResponse({
                    type: "error",
                    error: {
                        kind: "parse_failed",
                        message: "Failed to initialize OCCT module",
                    },
                });
            }
            break;
        }

        case "parse": {
            await handleParse(data.buffer, data.fileName);
            break;
        }

        case "cancel": {
            parseRequestId += 1;
            break;
        }
    }
};

export type { StepWorkerRequest, StepWorkerResponse };
