/**
 * Thin shim around `@openpcb/step-to-glb`. Wraps the package's
 * `convertStepToGlb` with a Vite-resolved worker factory; preserves the
 * 5-argument signature so tests can inject a mock worker factory.
 */
import StepToGlbWorker from "@openpcb/step-to-glb/worker?worker";
import {
  convertStepToGlb as packageConvert,
  type ConversionResult,
  type Model3DRef,
  type StepToGlbErrorResult,
  type StepToGlbOkResult,
  type StepToGlbRequest,
  type StepToGlbWorkerCancelRequest,
  type StepToGlbWorkerRequest,
  type StepToGlbWorkerResponse,
  type TessellationParams,
} from "@openpcb/step-to-glb";

export type {
  ConversionResult,
  Model3DRef,
  StepToGlbErrorResult,
  StepToGlbOkResult,
  StepToGlbRequest,
  StepToGlbWorkerCancelRequest,
  StepToGlbWorkerRequest,
  StepToGlbWorkerResponse,
  TessellationParams,
};

type WorkerFactory = () => Worker;

export function convertStepToGlb(
  stepBytes: ArrayBuffer,
  params: TessellationParams,
  modelRef?: Model3DRef | null,
  signal?: AbortSignal,
  workerFactory: WorkerFactory = () => new StepToGlbWorker(),
): Promise<ConversionResult> {
  return packageConvert(stepBytes, params, modelRef, signal, workerFactory);
}
