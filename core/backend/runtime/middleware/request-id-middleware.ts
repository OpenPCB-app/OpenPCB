import type { Middleware } from "../http/request-context";

export const requestIdMiddleware: Middleware = async (ctx, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-request-id", ctx.requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
