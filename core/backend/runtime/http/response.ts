export interface ApiSuccess<T = unknown> {
  ok: true;
  data: T;
}

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

export function success<T>(data: T, status = 200, headers?: HeadersInit): Response {
  const body: ApiSuccess<T> = { ok: true, data };
  return jsonResponse(body, status, headers);
}
