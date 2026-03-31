import { afterEach, describe, expect, it } from "bun:test";
import { LicenseDeniedError, LicenseUtil } from "./license-util";
import type { LicenseStatus } from "../../kernel/license-types";

describe("LicenseUtil", () => {
  const originalGetCurrentStatus = LicenseUtil.getCurrentStatus;
  const originalStartupState = process.env.OPENPCB_STARTUP_LICENSE_STATE;
  const originalStartupCode = process.env.OPENPCB_STARTUP_LICENSE_CODE;

  afterEach(() => {
    LicenseUtil.getCurrentStatus = originalGetCurrentStatus;
    if (originalStartupState === undefined) {
      delete process.env.OPENPCB_STARTUP_LICENSE_STATE;
    } else {
      process.env.OPENPCB_STARTUP_LICENSE_STATE = originalStartupState;
    }

    if (originalStartupCode === undefined) {
      delete process.env.OPENPCB_STARTUP_LICENSE_CODE;
    } else {
      process.env.OPENPCB_STARTUP_LICENSE_CODE = originalStartupCode;
    }
  });

  it("should allow active state", () => {
    const status: LicenseStatus = { state: 'active', expiresAt: null, features: ['*'] };
    expect(LicenseUtil.isAllowed(status)).toBe(true);
  });

  it("should allow grace state", () => {
    const status: LicenseStatus = { state: 'grace', expiresAt: null, features: ['*'] };
    expect(LicenseUtil.isAllowed(status)).toBe(true);
  });

  it("should deny restricted state", () => {
    const status: LicenseStatus = { state: 'restricted', expiresAt: null, features: ['*'] };
    expect(LicenseUtil.isAllowed(status)).toBe(false);
  });

  it("should deny blocked state", () => {
    const status: LicenseStatus = { state: 'blocked', expiresAt: null, features: ['*'] };
    expect(LicenseUtil.isAllowed(status)).toBe(false);
  });

  it("should create correct denial for blocked state", () => {
    const status: LicenseStatus = { state: 'blocked', expiresAt: null, features: ['*'], reason: 'Violation' };
    const denial = LicenseUtil.createDenial(status);
    expect(denial.ok).toBe(false);
    expect(denial.error.code).toBe('LICENSE_BLOCKED');
    expect(denial.error.message).toBe('Violation');
  });

  it("returns null denial for grace status", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "grace",
      expiresAt: null,
      features: ["*"],
    });

    const denial = await LicenseUtil.getDenialIfNotAllowed();
    expect(denial).toBeNull();
  });

  it("throws LicenseDeniedError for restricted status", async () => {
    LicenseUtil.getCurrentStatus = async () => ({
      state: "restricted",
      expiresAt: null,
      features: [],
      reason: "Restricted by policy",
    });

    expect(LicenseUtil.enforceAllowed()).rejects.toBeInstanceOf(LicenseDeniedError);
  });

  it("reads active startup state from env", async () => {
    process.env.OPENPCB_STARTUP_LICENSE_STATE = "active";
    process.env.OPENPCB_STARTUP_LICENSE_CODE = "TOKEN_VALID";

    const status = await LicenseUtil.getCurrentStatus();
    expect(status.state).toBe("active");
    expect(status.features).toEqual(["*"]);
    expect(status.reason).toBeUndefined();
  });

  it("reads blocked startup state from env", async () => {
    process.env.OPENPCB_STARTUP_LICENSE_STATE = "blocked";
    process.env.OPENPCB_STARTUP_LICENSE_CODE = "ACCESS_BLOCKED";

    const status = await LicenseUtil.getCurrentStatus();
    expect(status.state).toBe("blocked");
    expect(status.features).toEqual([]);
    expect(status.reason).toBe("ACCESS_BLOCKED");
  });
});
