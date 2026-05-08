import type { ProblemDetails } from "../../contracts/errors";

export function problemDetailsResponse(
  problem: ProblemDetails,
  headers?: HeadersInit,
): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: {
      "content-type": "application/problem+json",
      ...headers,
    },
  });
}
