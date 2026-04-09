import type { Middleware } from "../http/request-context";

export const requestLoggingMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  if (process.env.NODE_ENV === "test") {
    return response;
  }
  const durationMs = Date.now() - start;
  console.info(
    `[core-backend] ${ctx.req.method} ${ctx.url.pathname} ${response.status} ${durationMs}ms id=${ctx.requestId}`,
  );
  return response;
};
