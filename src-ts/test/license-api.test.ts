import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TestServer } from "./helpers/test-server";
import { cleanTestDatabase } from "./setup";

const BLOCKED_PORT = 3011;
const ACTIVE_PORT = 3012;

const blockedServer = new TestServer(BLOCKED_PORT);
const activeServer = new TestServer(ACTIVE_PORT);

const originalState = process.env.OPENPCB_STARTUP_LICENSE_STATE;
const originalCode = process.env.OPENPCB_STARTUP_LICENSE_CODE;

const restoreEnv = () => {
  if (originalState === undefined) {
    delete process.env.OPENPCB_STARTUP_LICENSE_STATE;
  } else {
    process.env.OPENPCB_STARTUP_LICENSE_STATE = originalState;
  }

  if (originalCode === undefined) {
    delete process.env.OPENPCB_STARTUP_LICENSE_CODE;
  } else {
    process.env.OPENPCB_STARTUP_LICENSE_CODE = originalCode;
  }
};

describe("License API contract", () => {
  beforeAll(async () => {
    await cleanTestDatabase();

    process.env.OPENPCB_STARTUP_LICENSE_STATE = "blocked";
    process.env.OPENPCB_STARTUP_LICENSE_CODE = "ACCESS_BLOCKED";
    await blockedServer.start();

    process.env.OPENPCB_STARTUP_LICENSE_STATE = "active";
    process.env.OPENPCB_STARTUP_LICENSE_CODE = "TOKEN_VALID";
    await activeServer.start();
  }, { timeout: 180000 });

  afterAll(async () => {
    await blockedServer.stop();
    await activeServer.stop();
    restoreEnv();
    await cleanTestDatabase();
  }, { timeout: 180000 });

  it("GET /api/license/status returns deterministic blocked status envelope", async () => {
    const res = await fetch(`${blockedServer.getUrl()}/api/license/status`);
    expect(res.status).toBe(200);

    const json = await res.json() as {
      ok: boolean;
      data: {
        state: string;
        expiresAt: string | null;
        features: string[];
        reason?: string;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      state: "blocked",
      expiresAt: null,
      features: [],
      reason: "ACCESS_BLOCKED",
    });
  });

  it("POST /api/license/activate returns deterministic blocked response", async () => {
    const res = await fetch(`${blockedServer.getUrl()}/api/license/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "dummy-key" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json() as {
      ok: boolean;
      data: {
        success: boolean;
        license: {
          state: string;
          expiresAt: string | null;
          features: string[];
          reason?: string;
        };
        devices: unknown[];
        requiresReplacement: boolean;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      success: false,
      license: {
        state: "blocked",
        expiresAt: null,
        features: [],
        reason: "ACCESS_BLOCKED",
      },
      devices: [],
      requiresReplacement: false,
    });
  });

  it("POST /api/license/replace-device returns deterministic active response", async () => {
    const res = await fetch(`${activeServer.getUrl()}/api/license/replace-device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "dummy-key", deviceIdToReplace: "device-1" }),
    });
    expect(res.status).toBe(200);

    const json = await res.json() as {
      ok: boolean;
      data: {
        success: boolean;
        license: {
          state: string;
          expiresAt: string | null;
          features: string[];
          reason?: string;
        };
        devices: unknown[];
        requiresReplacement: boolean;
      };
    };

    expect(json.ok).toBe(true);
    expect(json.data).toEqual({
      success: true,
      license: {
        state: "active",
        expiresAt: null,
        features: ["*"],
      },
      devices: [],
      requiresReplacement: false,
    });
  });
});
