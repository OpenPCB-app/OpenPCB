import { afterEach, describe, expect, test } from "bun:test";
import {
  evaluateFeatureFlag,
  featureFlagEnvSuffix,
  parseOverride,
  type FeatureFlagDef,
} from "../../contracts/feature-flags/registry";
import { isFeatureEnabled } from "../feature-flags";

const DEV_FLAG: FeatureFlagDef = { availability: "dev", description: "x" };
const ALL_FLAG: FeatureFlagDef = { availability: "all", description: "x" };
const PROD_FLAG: FeatureFlagDef = { availability: "prod", description: "x" };

describe("evaluateFeatureFlag", () => {
  test("dev flag follows isDev", () => {
    expect(evaluateFeatureFlag(DEV_FLAG, { isDev: true })).toBe(true);
    expect(evaluateFeatureFlag(DEV_FLAG, { isDev: false })).toBe(false);
  });

  test("all flag is always on", () => {
    expect(evaluateFeatureFlag(ALL_FLAG, { isDev: false })).toBe(true);
  });

  test("prod flag is the inverse of isDev", () => {
    expect(evaluateFeatureFlag(PROD_FLAG, { isDev: true })).toBe(false);
    expect(evaluateFeatureFlag(PROD_FLAG, { isDev: false })).toBe(true);
  });

  test("override wins over availability", () => {
    expect(
      evaluateFeatureFlag(DEV_FLAG, { isDev: false, override: true }),
    ).toBe(true);
    expect(
      evaluateFeatureFlag(ALL_FLAG, { isDev: true, override: false }),
    ).toBe(false);
    expect(
      evaluateFeatureFlag(PROD_FLAG, { isDev: true, override: true }),
    ).toBe(true);
    expect(
      evaluateFeatureFlag(PROD_FLAG, { isDev: false, override: false }),
    ).toBe(false);
  });
});

describe("featureFlagEnvSuffix", () => {
  test("uppercases and replaces separators", () => {
    expect(featureFlagEnvSuffix("cloud.autolayout")).toBe("CLOUD_AUTOLAYOUT");
  });
});

describe("parseOverride", () => {
  test("truthy / falsy / unset", () => {
    expect(parseOverride("1")).toBe(true);
    expect(parseOverride("true")).toBe(true);
    expect(parseOverride("on")).toBe(true);
    expect(parseOverride("0")).toBe(false);
    expect(parseOverride("off")).toBe(false);
    expect(parseOverride(undefined)).toBeUndefined();
    expect(parseOverride("")).toBeUndefined();
    expect(parseOverride("garbage")).toBeUndefined();
  });
});

describe("backend isFeatureEnabled", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevOverride = process.env.OPENPCB_FEATURE_CLOUD_AUTOLAYOUT;

  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevOverride === undefined)
      delete process.env.OPENPCB_FEATURE_CLOUD_AUTOLAYOUT;
    else process.env.OPENPCB_FEATURE_CLOUD_AUTOLAYOUT = prevOverride;
  });

  // cloud.presence is still a dev-only flag (cloud.autolayout/auth/sync
  // graduated to "all" for the pro beta), so it exercises the dev gating.
  test("cloud flag enabled in dev, disabled in production", () => {
    delete process.env.OPENPCB_FEATURE_CLOUD_PRESENCE;
    process.env.NODE_ENV = "development";
    expect(isFeatureEnabled("cloud.presence")).toBe(true);
    process.env.NODE_ENV = "production";
    expect(isFeatureEnabled("cloud.presence")).toBe(false);
  });

  test("non-production NODE_ENV (e.g. test) keeps cloud flags on", () => {
    delete process.env.OPENPCB_FEATURE_CLOUD_PRESENCE;
    process.env.NODE_ENV = "test";
    expect(isFeatureEnabled("cloud.presence")).toBe(true);
  });

  test("env override force-enables in production", () => {
    process.env.NODE_ENV = "production";
    process.env.OPENPCB_FEATURE_CLOUD_PRESENCE = "1";
    expect(isFeatureEnabled("cloud.presence")).toBe(true);
  });

  test("graduated cloud flags (autolayout/auth/sync) are on in production", () => {
    process.env.NODE_ENV = "production";
    for (const flag of [
      "cloud.autolayout",
      "cloud.auth",
      "cloud.sync",
    ] as const) {
      expect(isFeatureEnabled(flag)).toBe(true);
    }
  });
});
