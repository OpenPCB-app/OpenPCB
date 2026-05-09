import type { ModelConversionMetadata } from "../../contracts/import";
import { toUserError } from "../utils";
import { convertStepToGlb, type Model3DRef } from "./step-to-glb";

const STEP_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;
const STEP_UPLOAD_PARAMS = {
  linearUnit: "millimeter" as const,
  // Absolute deflection (50µm) gives predictable surface fidelity regardless of
  // part size. Bounding-box-ratio scales tolerance with model size, producing
  // visible faceting on lead radii of larger parts (e.g. DIP-40).
  linearDeflectionType: "absolute_value" as const,
  linearDeflection: 0.05,
  angularDeflection: 0.5,
};

type ModelConversionProgress =
  | "fetching_source"
  | "converting"
  | "uploading"
  | "ready"
  | "failed";

interface UploadConvertedModelInput {
  backendURL: string;
  moduleId: string;
  footprintId: string;
  sourceFilename: string;
  sourceStepSha256: string;
  stepBytes: ArrayBuffer;
  includeSourceStep: boolean;
  modelRef?: Model3DRef | null;
  signal?: AbortSignal;
  onProgress?: (status: ModelConversionProgress, message?: string) => void;
}

interface UploadFootprintStepModelInput {
  backendURL: string;
  moduleId: string;
  footprintId: string;
  stepFile: File;
  modelRef?: Model3DRef | null;
  signal?: AbortSignal;
  onProgress?: (status: ModelConversionProgress, message?: string) => void;
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function validateStepUploadFile(file: File): string | null {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".step") && !lowerName.endsWith(".stp")) {
    return "Select a STEP file (.step or .stp).";
  }
  if (file.size > STEP_SIZE_LIMIT_BYTES) {
    return "STEP file must be 25 MB or smaller.";
  }
  return null;
}

async function markPendingModelConversionFailed({
  backendURL,
  moduleId,
  footprintId,
  message,
  signal,
}: {
  backendURL: string;
  moduleId: string;
  footprintId: string;
  message: string;
  signal?: AbortSignal;
}): Promise<void> {
  await fetch(
    `${backendURL}/api/modules/${encodePathSegment(moduleId)}/footprints/${encodePathSegment(footprintId)}/model`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "failed", errorMessage: message }),
      signal,
    },
  ).catch(() => undefined);
}

async function uploadConvertedModel({
  backendURL,
  moduleId,
  footprintId,
  sourceFilename,
  sourceStepSha256,
  stepBytes,
  includeSourceStep,
  modelRef = null,
  signal,
  onProgress,
}: UploadConvertedModelInput): Promise<void> {
  onProgress?.("converting", "Converting 3D model...");
  const conversion = await convertStepToGlb(
    stepBytes.slice(0),
    STEP_UPLOAD_PARAMS,
    modelRef,
    signal,
  );
  if (conversion.status !== "ok") {
    onProgress?.("failed", conversion.message);
    throw new Error(conversion.message);
  }

  onProgress?.("uploading", "Uploading GLB...");
  const formData = new FormData();
  formData.set(
    "glb",
    new File([conversion.glbBytes], `${sourceFilename}.glb`, {
      type: "model/gltf-binary",
    }),
  );
  formData.set("sha256", conversion.sha256);
  if (includeSourceStep) {
    formData.set(
      "sourceStep",
      new File([stepBytes], sourceFilename, { type: "model/step" }),
    );
  }
  formData.set("sourceStepSha256", sourceStepSha256);
  formData.set("sourceFilename", sourceFilename);
  formData.set("tessellationParamsJson", JSON.stringify(STEP_UPLOAD_PARAMS));
  formData.set("converterVersion", "client-step-to-glb");
  if (modelRef) {
    formData.set("modelRefJson", JSON.stringify(modelRef));
  }

  const response = await fetch(
    `${backendURL}/api/modules/${encodePathSegment(moduleId)}/footprints/${encodePathSegment(footprintId)}/model`,
    { method: "POST", body: formData, signal },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = toUserError(
      payload,
      `Model upload failed (HTTP ${response.status})`,
    );
    onProgress?.("failed", message);
    throw new Error(message);
  }
  onProgress?.("ready", "Ready");
}

export async function uploadFootprintStepModel({
  backendURL,
  moduleId,
  footprintId,
  stepFile,
  modelRef = null,
  signal,
  onProgress,
}: UploadFootprintStepModelInput): Promise<void> {
  const validationError = validateStepUploadFile(stepFile);
  if (validationError) {
    throw new Error(validationError);
  }

  const stepBytes = await stepFile.arrayBuffer();
  await uploadConvertedModel({
    backendURL,
    moduleId,
    footprintId,
    sourceFilename: stepFile.name,
    sourceStepSha256: await sha256Hex(stepBytes),
    stepBytes,
    includeSourceStep: true,
    modelRef,
    signal,
    onProgress,
  });
}

export async function convertPendingModelConversion({
  backendURL,
  moduleId,
  conversion,
  signal,
  onProgress,
}: {
  backendURL: string;
  moduleId: string;
  conversion: ModelConversionMetadata;
  signal?: AbortSignal;
  onProgress?: (status: ModelConversionProgress, message?: string) => void;
}): Promise<void> {
  const sourceUrl = `${backendURL}/api/modules/${encodePathSegment(moduleId)}${conversion.sourceStepUrl}`;
  onProgress?.("fetching_source", "Fetching STEP source...");
  const sourceResponse = await fetch(sourceUrl, { signal });
  if (!sourceResponse.ok) {
    throw new Error(`STEP source fetch failed (HTTP ${sourceResponse.status})`);
  }
  const stepBytes = await sourceResponse.arrayBuffer();

  try {
    await uploadConvertedModel({
      backendURL,
      moduleId,
      footprintId: conversion.footprintId,
      sourceFilename: conversion.sourceFilename,
      sourceStepSha256: conversion.sourceStepSha256,
      stepBytes,
      includeSourceStep: false,
      modelRef: conversion.modelRef as Model3DRef | null,
      signal,
      onProgress,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "3D model conversion failed";
    await markPendingModelConversionFailed({
      backendURL,
      moduleId,
      footprintId: conversion.footprintId,
      message,
      signal,
    });
    throw error;
  }
}
