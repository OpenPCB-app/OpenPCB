import { Value } from "@sinclair/typebox/value";
import type { Static, TSchema } from "@sinclair/typebox";
import { ValidationError, NotFoundError } from "../../../core/contracts/errors";
import type {
  ModuleRouteContext,
  ModuleRouteHandler,
} from "../../../core/contracts/modules/backend-module";
import { problemForError, problemResponse } from "agentkit/transport-http";

const RESERVED_METADATA = new Set([
  "apikey",
  "clearapikey",
  "apikeysecretref",
  "secretref",
  "secretrefs",
  "secret_ref",
  "api_key",
  "authorization",
  "providergeneration",
  "actorscope",
  "actor",
  "readonly",
  "nativeidentity",
  "internal",
]);

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Reject ownership claims before a generic transport can persist metadata. */
export function validatePublicMetadata(value: unknown, depth = 0): void {
  if (depth > 8)
    throw new ValidationError("Metadata exceeds the nesting limit");
  if (!value || typeof value !== "object") return;
  const entries = Object.entries(value);
  if (entries.length > 128)
    throw new ValidationError("Metadata has too many fields");
  for (const [key, child] of entries) {
    if (
      key.startsWith("__openpcb") ||
      RESERVED_METADATA.has(key.toLowerCase())
    ) {
      throw new ValidationError(
        "Internal or credential metadata is not accepted",
      );
    }
    validatePublicMetadata(child, depth + 1);
  }
}

export async function readInput<T extends TSchema>(
  request: Request,
  schema: T,
  fields: readonly string[],
): Promise<Static<T>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Request body must be an object");
  }
  if (
    Object.keys(value).some((key) => !fields.includes(key)) ||
    !Value.Check(schema, value)
  ) {
    throw new ValidationError(
      "Request body contains unexpected or invalid fields",
    );
  }
  if ("metadata" in value) validatePublicMetadata(value.metadata);
  return value as Static<T>;
}

function publicData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !key.startsWith("__openpcb") &&
          !["apiKeySecretRef", "secretRef", "secretRefs"].includes(key),
      )
      .map(([key, child]) => [key, publicData(child)]),
  );
}

/** Host submission fingerprints remain private while generic DTOs remain canonical. */
export async function publicResponse(response: Response): Promise<Response> {
  if (!response.headers.get("content-type")?.includes("json") || !response.body)
    return response;
  const data: unknown = await response.json();
  return new Response(JSON.stringify(publicData(data)), {
    status: response.status,
    headers: response.headers,
  });
}

export function safeRoute(handler: ModuleRouteHandler): ModuleRouteHandler {
  return async (context: ModuleRouteContext) => {
    try {
      return await publicResponse(await handler(context));
    } catch (error) {
      const instance = new URL(context.req.url).pathname;
      if (error instanceof NotFoundError)
        return problemResponse({
          status: 404,
          code: "not_found",
          detail: error.message,
          instance,
        });
      if (error instanceof ValidationError)
        return problemResponse({
          status: 400,
          code: "invalid_request",
          detail: error.message,
          instance,
        });
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "idempotency_key_mismatch"
      ) {
        return problemResponse({
          status: 422,
          code: "idempotency_key_mismatch",
          detail:
            "This idempotency key was already used for a different request",
          instance,
        });
      }
      return problemForError(error, instance);
    }
  };
}
