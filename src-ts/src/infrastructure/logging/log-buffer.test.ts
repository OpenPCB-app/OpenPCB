import { beforeEach, describe, expect, it } from "bun:test";

import { initializeLogBuffer, logBuffer } from "./log-buffer";

describe("log buffer redaction", () => {
  beforeEach(() => {
    initializeLogBuffer();
    logBuffer.clear();
  });

  it("redacts token and secret fields from captured logs", () => {
    console.info("license-audit", {
      eventType: "license.entitlement.validation",
      accountId: "acct-1",
      token: "header.payload.signature",
      sessionSecret: "super-secret",
      entitlementJws: "header.payload.signature",
    });

    const logs = logBuffer.getRecentLogs({ count: 1 });
    expect(logs.length).toBe(1);
    const [entry] = logs;
    if (!entry) {
      throw new Error("expected a log entry");
    }

    expect(entry.message).toContain("[REDACTED]");
    expect(entry.message).not.toContain("super-secret");
    expect(entry.message).not.toContain("header.payload.signature");
  });
});
