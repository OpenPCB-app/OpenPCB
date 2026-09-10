// Local Designer HTTP surface for composite Auto Layout (`/v1/layout`).
//
// Registered from routes.ts as a single call — that file is already 3k+ lines and is a
// known hotspot, and everything Auto Layout needs (client, capabilities, staleness, apply,
// SSE proxy) is cohesive enough to live together.
//
// The renderer talks ONLY to these endpoints. It never holds the cloud base URL, never
// holds a bearer beyond the header it already sends for every cloud call, and never sends
// operations — see ./apply-candidate.ts for why the backend re-fetches them instead.

import type { ModuleRouterHandle } from "../../../../core/contracts/modules/backend-module";
import type {
  DesignerCommandEnvelope,
  DesignerPcbProjection,
  PlaceOptions,
  RouteOptions,
} from "../../../../sdks/designer";
import { computeBoardContentDigest } from "../pcb/board-content-digest";
import { buildBoardSnapshot } from "../pcb/board-snapshot";
import { applyCandidate } from "./apply-candidate";
import { getAutoLayoutCapabilities, supportsLayout } from "./capabilities";
import { AutoLayoutError } from "./errors";
import {
  cancelLayout,
  getLayoutStatus,
  openLayoutStream,
  selectLayoutCandidate,
  submitLayout,
} from "./layout-client";
import { parseApplyCandidateBody } from "./parsers";

export interface AutolayoutRouteDeps {
  /** Bearer extraction shared with the route/place handlers (401s when absent). */
  requireCloudBearer: (req: Request) => string;
  parseJsonBody: <T>(req: Request) => Promise<T>;
  loadProjection: (designId: string) => Promise<DesignerPcbProjection | null>;
  dispatch: (
    designId: string,
    envelope: DesignerCommandEnvelope,
  ) => Promise<import("../../../../sdks/designer").DesignerDispatchResult>;
  /** Post-apply report, by design id — the run service owns execution (09 §7). */
  runDrc: (
    designId: string,
  ) => Promise<import("../../../../sdks/designer").DrcReport | null>;
  notFound: (message: string) => Error;
  success: (data: unknown, status?: number) => Response;
}

interface SubmitBody {
  routeOptions?: RouteOptions;
  placeOptions?: PlaceOptions;
  routableNetClassIds?: unknown;
  excludedNetIds?: unknown;
  serializePours?: unknown;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

/** RFC 7807 problem response for a typed Auto Layout failure. */
function problemResponse(error: AutoLayoutError): Response {
  return new Response(JSON.stringify(error.toProblem()), {
    status: error.status,
    headers: { "content-type": "application/problem+json" },
  });
}

async function guard(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AutoLayoutError) return problemResponse(error);
    throw error;
  }
}

export function registerAutolayoutRoutes(
  router: ModuleRouterHandle,
  deps: AutolayoutRouteDeps,
): void {
  const { requireCloudBearer, parseJsonBody, success } = deps;

  /**
   * Submit the current board for composite layout.
   *
   * Capability-gated on the way in: a deployment without `/v1/layout` gets a typed
   * "unsupported" answer here rather than a confusing 404 from the cloud mid-run. The
   * response carries the content digest the client must send back at apply time.
   */
  router.post("/designs/:designId/autolayout", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      const designId = params.getOrThrow("designId");
      const body = await parseJsonBody<SubmitBody>(req).catch(() => ({}) as SubmitBody);

      const capabilities = await getAutoLayoutCapabilities();
      if (!supportsLayout(capabilities)) {
        throw new AutoLayoutError(
          "AUTO_LAYOUT_SERVICE_UNSUPPORTED",
          "Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available.",
        );
      }

      const projection = await deps.loadProjection(designId);
      if (!projection) throw deps.notFound(`Design '${designId}' not found`);

      // Layout consumes the union of place + route inputs, so pours ride along when the
      // deployment accepts them (the route stage of each candidate reads them).
      const requestedPours = body.serializePours;
      const serializePours =
        requestedPours === true || requestedPours === false
          ? requestedPours
          : Boolean(capabilities?.poursAccepted);

      const { snapshot, warnings } = buildBoardSnapshot(projection, {
        routeOptions: body.routeOptions,
        placeOptions: body.placeOptions ?? {},
        routableNetClassIds: asStringArray(body.routableNetClassIds),
        excludedNetIds: asStringArray(body.excludedNetIds),
        serializePours,
      });

      const submitted = await submitLayout(snapshot, bearer);
      return success({
        ...submitted,
        warnings,
        // Staleness key for the eventual apply. Revision would be wrong here: view-state
        // commands bump it, so a pan during the run would invalidate the result.
        snapshotDigest: computeBoardContentDigest(projection),
        baseRevision: projection.revision,
        maxCandidates: capabilities?.layoutLimits?.maxCandidates ?? null,
      });
    }),
  );

  router.get("/designs/:designId/autolayout/:jobId", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      params.getOrThrow("designId");
      const status = await getLayoutStatus(params.getOrThrow("jobId"), bearer);
      return success(status);
    }),
  );

  /**
   * SSE proxy. The upstream body is piped through untouched so frame ids survive — they are
   * what `Last-Event-ID` resumes from, and the desktop reconnects on network blips.
   */
  router.get("/designs/:designId/autolayout/:jobId/stream", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      params.getOrThrow("designId");
      const upstream = await openLayoutStream(
        params.getOrThrow("jobId"),
        bearer,
        req.headers.get("last-event-id"),
      );
      return new Response(upstream.body, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }),
  );

  router.post("/designs/:designId/autolayout/:jobId/cancel", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      params.getOrThrow("designId");
      return success(await cancelLayout(params.getOrThrow("jobId"), bearer));
    }),
  );

  /**
   * Explicit selection endpoint. The apply path already fires this automatically; this
   * exists for the cases where a client legitimately records a pick it did not apply
   * through us (and keeps the surface complete against the service).
   */
  router.post("/designs/:designId/autolayout/:jobId/selection", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      params.getOrThrow("designId");
      const body = await parseJsonBody<{ candidateId?: unknown }>(req);
      if (typeof body?.candidateId !== "string") {
        throw new AutoLayoutError(
          "AUTO_LAYOUT_INVALID_CANDIDATE",
          "candidateId must be a string",
        );
      }
      return success(
        await selectLayoutCandidate(
          params.getOrThrow("jobId"),
          body.candidateId,
          bearer,
        ),
      );
    }),
  );

  /** Atomic apply — see ./apply-candidate.ts for the step order and why each step is there. */
  router.post("/designs/:designId/autolayout/apply", async ({ params, req }) =>
    guard(async () => {
      const bearer = requireCloudBearer(req);
      const designId = params.getOrThrow("designId");
      const request = parseApplyCandidateBody(await parseJsonBody<unknown>(req));
      const result = await applyCandidate({
        designId,
        bearer,
        request,
        loadProjection: () => deps.loadProjection(designId),
        dispatch: (envelope) => deps.dispatch(designId, envelope),
        runDrc: deps.runDrc,
      });
      return success(result);
    }),
  );
}
