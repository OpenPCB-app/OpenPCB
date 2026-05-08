import { AppError, type ProblemDetails } from "../../contracts/errors";
import type { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { problemDetailsResponse } from "../http/problem-details";
import type { Middleware } from "../http/request-context";

function toProblem(error: unknown, path: string): ProblemDetails {
  if (error instanceof AppError) {
    return {
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.message,
      instance: path,
      ...(error.extras ?? {}),
    };
  }

  return {
    type: "https://openpcb.dev/problems/internal-error",
    title: "Internal Server Error",
    status: 500,
    detail: error instanceof Error ? error.message : "Internal server error",
    instance: path,
  };
}

export function createErrorMiddleware(
  diagnosticsStore: DiagnosticsStore,
): Middleware {
  return async (ctx, next) => {
    try {
      return await next();
    } catch (error) {
      const problem = toProblem(error, ctx.url.pathname);
      diagnosticsStore.recordError({
        timestamp: new Date().toISOString(),
        requestId: ctx.requestId,
        method: ctx.req.method,
        path: ctx.url.pathname,
        status: problem.status,
        title: problem.title,
        detail: problem.detail ?? problem.title,
      });
      if (process.env.NODE_ENV !== "test") {
        console.error(
          `[core-backend] ${ctx.req.method} ${ctx.url.pathname} ${problem.status}`,
          error,
        );
      }
      return problemDetailsResponse(
        problem,
        error instanceof AppError ? error.headers : undefined,
      );
    }
  };
}
