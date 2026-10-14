import { describe, expect, test } from "bun:test";
import {
  TELEMETRY_REDACTED,
  TELEMETRY_SCRUB_HOOKS,
  scrubTelemetry,
  scrubTelemetryString,
} from "../../contracts/credentials/telemetry-scrub";

const KEY = "sk-or-v1-0123456789abcdef0123456789abcdef";
const OPAQUE = "fixture-opaque-credential-77f1";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnbmF0dXJlLXZhbHVl";

describe("telemetry scrubber", () => {
  test("redacts bearer, header-shaped, query and provider-key patterns inside strings", () => {
    for (const text of [
      `Authorization: Bearer ${OPAQUE}`,
      `authorization=${OPAQUE}`,
      `request failed with bearer ${OPAQUE}`,
      `X-OpenPCB-Token: ${OPAQUE}`,
      `{"apiKey":"${OPAQUE}"}`,
      `https://api.example.test/v1/models?key=${OPAQUE}&page=2`,
      `https://api.example.test/v1/models?api_key=${OPAQUE}`,
      `access_token=${OPAQUE}; path=/`,
    ]) {
      const scrubbed = scrubTelemetryString(text);
      expect(scrubbed).not.toContain(OPAQUE);
      expect(scrubbed).toContain(TELEMETRY_REDACTED);
    }
    expect(scrubTelemetryString(`upstream echoed ${KEY}`)).toBe(`upstream echoed ${TELEMETRY_REDACTED}`);
    expect(scrubTelemetryString(`session ${JWT}`)).toBe(`session ${TELEMETRY_REDACTED}`);
    expect(scrubTelemetryString("https://api.example.test/v1/models?page=2")).toBe(
      "https://api.example.test/v1/models?page=2",
    );
    expect(scrubTelemetryString("List models failed: 404 Not Found")).toBe("List models failed: 404 Not Found");
  });

  test("redacts known credential fields at any depth without mutating the input", () => {
    const event = {
      message: "provider failed",
      request: { headers: { Authorization: `Bearer ${OPAQUE}`, "x-openpcb-token": OPAQUE, accept: "json" } },
      extra: { provider: { apiKey: OPAQUE, api_key: OPAQUE, secretRef: "provider/abc", label: "OpenAI" } },
      contexts: { auth: { accessToken: OPAQUE, refresh_token: OPAQUE, password: OPAQUE, cookie: OPAQUE } },
      breadcrumbs: [{ data: { url: `https://x.test?key=${OPAQUE}`, mcpToken: OPAQUE } }],
      tokens: { promptTokens: 12 },
    };
    const original = JSON.stringify(event);
    const scrubbed = scrubTelemetry(event);
    expect(JSON.stringify(event)).toBe(original);
    expect(JSON.stringify(scrubbed)).not.toContain(OPAQUE);
    expect(JSON.stringify(scrubbed)).not.toContain("provider/abc");
    expect(scrubbed.request.headers.accept).toBe("json");
    expect(scrubbed.extra.provider.label).toBe("OpenAI");
    expect(scrubbed.tokens.promptTokens).toBe(12);
    expect(scrubbed.request.headers.Authorization).toBe(TELEMETRY_REDACTED);
  });

  test("handles cycles, shared references, depth and non-plain values", () => {
    const shared = { note: `Bearer ${OPAQUE}` };
    const cyclic: Record<string, unknown> = { a: shared, b: shared };
    cyclic.self = cyclic;
    const scrubbed = scrubTelemetry(cyclic);
    expect(scrubbed.self).toBe("[Circular]");
    expect(JSON.stringify([scrubbed.a, scrubbed.b])).not.toContain(OPAQUE);
    let deep: Record<string, unknown> = { leaf: OPAQUE };
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(JSON.stringify(scrubTelemetry(deep))).not.toContain(OPAQUE);
    const date = new Date(0);
    expect(scrubTelemetry({ when: date }).when).toBe(date);
    expect(scrubTelemetry(null)).toBeNull();
    expect(scrubTelemetry(42)).toBe(42);
  });

  test("every Sentry hook returns a scrubbed copy and never drops the payload", () => {
    const payload = { message: `Authorization: Bearer ${OPAQUE}`, data: { authorization: OPAQUE } };
    for (const hook of Object.values(TELEMETRY_SCRUB_HOOKS)) {
      const result = hook(payload);
      expect(result).not.toBeNull();
      expect(JSON.stringify(result)).not.toContain(OPAQUE);
    }
    expect(Object.keys(TELEMETRY_SCRUB_HOOKS).sort()).toEqual([
      "beforeBreadcrumb", "beforeSend", "beforeSendLog", "beforeSendTransaction",
    ]);
  });
});
