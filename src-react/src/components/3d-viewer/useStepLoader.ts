import { useState, useEffect, useCallback, useRef } from "react";
import type {
  LoaderStatus,
  ParsePhase,
  NormalizedMesh,
  StepParseError,
  StepWorkerResponse,
} from "./step-types";
import {
  PHASE_LABELS,
  ERROR_MESSAGES,
  isStepFile,
  isWrlFile,
} from "./step-types";

export interface UseStepLoaderResult {
  status: LoaderStatus;
  phase: ParsePhase | null;
  phaseLabel: string | null;
  meshes: NormalizedMesh[];
  error: StepParseError | null;
  reload: () => void;
}

function getFileName(path: string): string {
  try {
    const url = new URL(path, window.location.origin);
    return url.pathname.split("/").pop() || "model.step";
  } catch {
    return path.split("?")[0]?.split("/").pop() || "model.step";
  }
}

export function useStepLoader(
  assetPath: string | null,
  fileName?: string | null,
): UseStepLoaderResult {
  const [status, setStatus] = useState<LoaderStatus>("idle");
  const [phase, setPhase] = useState<ParsePhase | null>(null);
  const [meshes, setMeshes] = useState<NormalizedMesh[]>([]);
  const [error, setError] = useState<StepParseError | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadIdRef = useRef(0);
  const fileNameRef = useRef<string | null>(fileName ?? null);

  useEffect(() => {
    fileNameRef.current = fileName ?? null;
  }, [fileName]);

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("./step-parser.worker.ts", import.meta.url),
        { type: "module" },
      );
    }
    return workerRef.current;
  }, []);

  const cancelPending = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (workerRef.current) {
      workerRef.current.postMessage({ type: "cancel" });
      workerRef.current.onmessage = null;
    }
  }, []);

  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
  }, []);

  const load = useCallback(
    async (path: string, loadId: number) => {
      cancelPending();

      const nameToCheck = fileNameRef.current || getFileName(path);

      if (isWrlFile(nameToCheck)) {
        setStatus("error");
        setPhase(null);
        setMeshes([]);
        setError({
          kind: "unsupported_format",
          message: "Preview unavailable for WRL files",
        });
        return;
      }

      if (!isStepFile(nameToCheck)) {
        setStatus("error");
        setPhase(null);
        setMeshes([]);
        setError({
          kind: "unsupported_format",
          message: ERROR_MESSAGES.unsupported_format,
        });
        return;
      }

      setStatus("loading");
      setPhase("fetching");
      setError(null);
      setMeshes([]);

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const response = await fetch(path, {
          signal: abortController.signal,
        });

        if (loadId !== loadIdRef.current) return;

        if (!response.ok) {
          setStatus("error");
          setPhase(null);
          setError({
            kind: "fetch_failed",
            message: ERROR_MESSAGES.fetch_failed,
          });
          return;
        }

        const buffer = await response.arrayBuffer();

        if (loadId !== loadIdRef.current) return;

        const worker = getWorker();

        worker.onmessage = (event: MessageEvent<StepWorkerResponse>) => {
          if (loadId !== loadIdRef.current) return;

          const { data } = event;

          switch (data.type) {
            case "progress":
              setPhase(data.phase);
              return;

            case "success":
              setStatus("success");
              setPhase(null);
              setMeshes(data.meshes);
              setError(null);
              return;

            case "error":
              setStatus("error");
              setPhase(null);
              setError(data.error);
              return;

            default:
              return;
          }
        };

        worker.postMessage(
          { type: "parse", buffer, fileName: getFileName(path) },
          [buffer],
        );
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (loadId !== loadIdRef.current) return;

        setStatus("error");
        setPhase(null);
        setError({
          kind: "fetch_failed",
          message:
            err instanceof Error ? err.message : ERROR_MESSAGES.fetch_failed,
        });
      }
    },
    [cancelPending, getWorker],
  );

  const reload = useCallback(() => {
    if (!assetPath) return;

    loadIdRef.current += 1;
    void load(assetPath, loadIdRef.current);
  }, [assetPath, load]);

  useEffect(() => {
    loadIdRef.current += 1;

    if (!assetPath) {
      cancelPending();
      setStatus("idle");
      setPhase(null);
      setMeshes([]);
      setError(null);
      return;
    }

    void load(assetPath, loadIdRef.current);

    return () => {
      cancelPending();
    };
  }, [assetPath, cancelPending, load]);

  useEffect(() => {
    return () => {
      cancelPending();
      terminateWorker();
    };
  }, [cancelPending, terminateWorker]);

  const phaseLabel = phase ? PHASE_LABELS[phase] : null;

  return {
    status,
    phase,
    phaseLabel,
    meshes,
    error,
    reload,
  };
}
