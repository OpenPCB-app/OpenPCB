import { useEffect, useRef, useState } from "react";
import type { FootprintRenderModel } from "../../../../shared/rendering";
import { asFootprintRender, stripReferenceLabels } from "../detail-helpers";
import { toUserError } from "../utils";

export type FootprintGeometryState =
  | { status: "loading" }
  | { status: "ready"; model: FootprintRenderModel }
  | { status: "empty" }
  | { status: "error"; message: string };

interface UseFootprintGeometryParams {
  backendURL: string | null | undefined;
  moduleId: string;
  /** The footprint option currently selected in the UI. */
  selectedFootprintId: string;
  /** The default footprint id — its geometry is already in the detail payload. */
  defaultFootprintId: string;
  /** Pre-resolved render model for the default option (from `getComponentDetail`). */
  defaultModel: FootprintRenderModel | null;
}

/**
 * Resolves the footprint render model for the selected option. The default
 * option's geometry ships in the detail payload; non-default options are
 * fetched lazily from `GET /footprints/:id` and cached by `footprintId`, so
 * re-selecting is instant.
 */
export function useFootprintGeometry({
  backendURL,
  moduleId,
  selectedFootprintId,
  defaultFootprintId,
  defaultModel,
}: UseFootprintGeometryParams): FootprintGeometryState {
  const cacheRef = useRef<Map<string, FootprintGeometryState>>(new Map());
  const [state, setState] = useState<FootprintGeometryState>({
    status: "loading",
  });

  useEffect(() => {
    const cache = cacheRef.current;

    // Default option: geometry is already resolved in the payload.
    if (selectedFootprintId === defaultFootprintId) {
      const resolved: FootprintGeometryState = defaultModel
        ? { status: "ready", model: stripReferenceLabels(defaultModel) }
        : { status: "empty" };
      cache.set(selectedFootprintId, resolved);
      setState(resolved);
      return;
    }

    const cached = cache.get(selectedFootprintId);
    if (cached && cached.status !== "loading") {
      setState(cached);
      return;
    }

    if (!backendURL) {
      setState({ status: "error", message: "Backend URL unavailable" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading" });

    const publish = (id: string, next: FootprintGeometryState) => {
      cache.set(id, next);
      setState((current) => (id === selectedFootprintId ? next : current));
    };

    void (async () => {
      try {
        const response = await fetch(
          `${backendURL}/api/modules/${moduleId}/footprints/${encodeURIComponent(
            selectedFootprintId,
          )}`,
          { signal: controller.signal },
        );
        const payload = (await response.json().catch(() => null)) as {
          ok?: boolean;
          data?: { footprint?: { data?: Record<string, unknown> } };
        } | null;
        if (!response.ok || !payload?.ok || !payload.data?.footprint) {
          throw new Error(
            toUserError(
              payload,
              `Footprint fetch failed (HTTP ${response.status})`,
            ),
          );
        }
        const data = payload.data.footprint.data ?? {};
        const normalized =
          data.normalized && typeof data.normalized === "object"
            ? (data.normalized as Record<string, unknown>)
            : null;
        const model = asFootprintRender(normalized?.preview ?? data.preview);
        publish(
          selectedFootprintId,
          model
            ? { status: "ready", model: stripReferenceLabels(model) }
            : { status: "empty" },
        );
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        publish(selectedFootprintId, {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to load footprint geometry",
        });
      }
    })();

    return () => controller.abort();
  }, [
    backendURL,
    moduleId,
    selectedFootprintId,
    defaultFootprintId,
    defaultModel,
  ]);

  return state;
}
