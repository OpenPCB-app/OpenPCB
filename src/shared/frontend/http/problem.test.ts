import { describe, expect, it } from "vitest";
import {
  ApiError,
  CLOUD_UNREACHABLE,
  CLOUD_UNREACHABLE_TYPE,
  LOCAL_SERVICE_UNREACHABLE,
  apiErrorFromBody,
  apiErrorFromResponse,
  describeError,
  isApiError,
  isRetryableError,
  isSafeDetail,
} from "./problem";

function problemResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json", ...headers },
  });
}

describe("apiErrorFromResponse", () => {
  it("parses RFC 7807 problem documents and the request id", async () => {
    const err = await apiErrorFromResponse(
      problemResponse(
        400,
        { type: "https://openpcb.dev/problems/validation", title: "Bad Request", status: 400, detail: "Name is required", code: "INVALID" },
        { "x-request-id": "req-1" },
      ),
    );
    expect(isApiError(err)).toBe(true);
    expect(err.status).toBe(400);
    expect(err.type).toBe("https://openpcb.dev/problems/validation");
    expect(err.code).toBe("INVALID");
    expect(err.detail).toBe("Name is required");
    expect(err.requestId).toBe("req-1");
    expect(err.message).toBe("Name is required");
  });

  it("parses the { error } and { ok:false, code } envelopes", async () => {
    const a = await apiErrorFromResponse(problemResponse(404, { error: "Page not found" }));
    expect(a.detail).toBe("Page not found");
    const b = apiErrorFromBody(409, { ok: false, code: "REVISION_CONFLICT", conflict: { expected: 1, actual: 2 } });
    expect(b.code).toBe("REVISION_CONFLICT");
    const c = apiErrorFromBody(500, { error: { code: "E_DB", message: "Disk full" } });
    expect(c.code).toBe("E_DB");
    expect(c.detail).toBe("Disk full");
  });

  it("survives empty and HTML bodies", async () => {
    const empty = await apiErrorFromResponse(new Response("", { status: 502 }), "Couldn't load");
    expect(empty.status).toBe(502);
    expect(empty.title).toBe("Couldn't load");
    const html = await apiErrorFromResponse(new Response("<html>proxy</html>", { status: 500 }));
    expect(html.detail).toBeUndefined();
  });
});

describe("describeError", () => {
  it("maps network failures to the local-service copy", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toBe(LOCAL_SERVICE_UNREACHABLE);
    expect(describeError(new TypeError("Load failed"), "delete part")).toBe(
      `Couldn't delete part: ${LOCAL_SERVICE_UNREACHABLE}`,
    );
    expect(describeError(new ApiError({ status: 0 }))).toBe(LOCAL_SERVICE_UNREACHABLE);
  });

  it("blames the named remote when the browser fetched it directly (Open from Cloud)", () => {
    const cloud = { service: "OpenPCB Cloud" };
    expect(describeError(new TypeError("Failed to fetch"), "open design from cloud", cloud)).toBe(
      `Couldn't open design from cloud: ${CLOUD_UNREACHABLE}`,
    );
    expect(describeError(new ApiError({ status: 0 }), undefined, cloud)).toBe(CLOUD_UNREACHABLE);
    expect(
      describeError(new TypeError("NetworkError when attempting to fetch resource."), undefined, {
        service: "the AI provider",
      }),
    ).toMatch(/^Can't reach the AI provider/);
  });

  it("never shows 'Failed to fetch' re-thrown as a string or plain Error", () => {
    expect(describeError("Failed to fetch", "load")).toBe(`Couldn't load: ${LOCAL_SERVICE_UNREACHABLE}`);
    expect(describeError(new Error("Failed to fetch"))).toBe(LOCAL_SERVICE_UNREACHABLE);
    expect(describeError(new Error("Cloud list failed: Failed to fetch"), undefined, { service: "OpenPCB Cloud" })).toBe(
      CLOUD_UNREACHABLE,
    );
    // The backend answered: its "failed to fetch" is about a remote it called.
    expect(describeError(new ApiError({ status: 502, detail: "Failed to fetch" }))).toMatch(
      /^Can't reach the remote service/,
    );
    expect(
      describeError(
        new ApiError({ status: 400, detail: "failed to fetch https://x.test/a.opclib: ERR_CONNECTION_RESET" }),
        "install library",
      ),
    ).toBe("Couldn't install library: Can't reach the remote service — you're offline or it's down");
    // Safari's generic wording only counts on fetch's own TypeError.
    expect(describeError(new Error("Footprint load failed"))).toBe("Footprint load failed");
  });

  it("maps the cloud-unreachable problem type and outbound connect errors", () => {
    expect(describeError(new ApiError({ status: 503, type: CLOUD_UNREACHABLE_TYPE }))).toBe(CLOUD_UNREACHABLE);
    const bun = new ApiError({
      status: 500,
      detail: "Unable to connect. Is the computer able to access the url?",
    });
    expect(describeError(bun)).toMatch(/^Can't reach the remote service/);
    expect(describeError(bun, "sync to cloud", { service: "OpenPCB Cloud" })).toBe(
      `Couldn't sync to cloud: ${CLOUD_UNREACHABLE}`,
    );
    expect(describeError(new Error("fetch failed"), undefined, { service: "the AI provider" })).toMatch(
      /^Can't reach the AI provider/,
    );
  });

  it("maps statuses to fixed copy", () => {
    expect(describeError(new ApiError({ status: 413 }))).toBe("File too large");
    expect(describeError(new ApiError({ status: 404 }))).toBe("Not found — it may have been deleted");
    expect(describeError(new ApiError({ status: 409, code: "REVISION_CONFLICT" }))).toMatch(
      /^The design changed elsewhere/,
    );
    expect(describeError(new ApiError({ status: 409, detail: "A library with this id exists" }))).toBe(
      "A library with this id exists",
    );
    expect(describeError(new ApiError({ status: 422, detail: "Width must be positive" }))).toBe(
      "Width must be positive",
    );
  });

  it("never shows raw 5xx internals", () => {
    const internal = new ApiError({
      status: 500,
      title: "Internal Server Error",
      detail: "Cannot read properties of undefined (reading 'x')",
    });
    expect(describeError(internal)).toBe("Something went wrong in the local service (HTTP 500)");
    const safe = new ApiError({ status: 503, detail: "Library index is rebuilding" });
    expect(describeError(safe)).toBe(
      "Something went wrong in the local service (HTTP 503): Library index is rebuilding",
    );
  });

  it("upgrades legacy `HTTP 500` errors and hides stack traces", () => {
    expect(describeError(new Error("HTTP 500"))).toBe("Something went wrong in the local service (HTTP 500)");
    expect(describeError(new Error("boom\n    at foo (file.ts:1:2)"))).toBe("Something went wrong");
    expect(describeError("Part name is taken")).toBe("Part name is taken");
  });

  it("keeps an action that is already a full phrase", () => {
    expect(describeError(new ApiError({ status: 413 }), "Couldn't import PDF")).toBe(
      "Couldn't import PDF: File too large",
    );
  });
});

describe("isRetryableError / isSafeDetail", () => {
  it("retries network, timeouts, rate limits and 5xx only", () => {
    expect(isRetryableError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableError(new ApiError({ status: 503 }))).toBe(true);
    expect(isRetryableError(new ApiError({ status: 429 }))).toBe(true);
    expect(isRetryableError(new ApiError({ status: 400 }))).toBe(false);
    expect(isRetryableError(new ApiError({ status: 409 }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isRetryableError(new Error("HTTP 502"))).toBe(true);
    expect(isRetryableError("Failed to fetch")).toBe(true);
  });

  it("rejects technical detail", () => {
    expect(isSafeDetail("Board outline is not closed")).toBe(true);
    expect(isSafeDetail("SQLITE_CONSTRAINT: UNIQUE constraint failed")).toBe(false);
    expect(isSafeDetail("x".repeat(300))).toBe(false);
    expect(isSafeDetail(undefined)).toBe(false);
    expect(isSafeDetail("Failed to fetch")).toBe(false);
    expect(isSafeDetail("net::ERR_CONNECTION_REFUSED")).toBe(false);
  });
});
