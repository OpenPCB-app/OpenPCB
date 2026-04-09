import { buildCorsHeaders, isTrustedOrigin, withCorsHeaders } from "../http/cors";
import type { Middleware } from "../http/request-context";

export function createCorsMiddleware(allowedOrigins: Set<string>): Middleware {
  return async (ctx, next) => {
    const origin = ctx.req.headers.get("origin");
    if (!isTrustedOrigin(origin, allowedOrigins)) {
      return withCorsHeaders(
        new Response(
          JSON.stringify({
            type: "https://openpcb.dev/problems/cors-forbidden",
            title: "Forbidden",
            status: 403,
            detail: "Origin not allowed",
            instance: ctx.url.pathname,
          }),
          {
            status: 403,
            headers: { "content-type": "application/problem+json" },
          },
        ),
        buildCorsHeaders(origin, allowedOrigins),
      );
    }

    if (ctx.req.method.toUpperCase() === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin, allowedOrigins),
      });
    }

    const response = await next();
    return withCorsHeaders(response, buildCorsHeaders(origin, allowedOrigins));
  };
}
