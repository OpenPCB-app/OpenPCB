import { readFileSync } from "node:fs";
import path from "node:path";

export interface ReleasePin {
  tag: string;
  version: string;
  artifact: string;
  sha256: string;
  keyId: string;
  keySpkiSha256: string;
}

export interface ReleasePolicy {
  schemaVersion: 1;
  repository: string;
  minComponents: number;
  productionRelease: ReleasePin | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePin(value: unknown): ReleasePin {
  if (!isRecord(value))
    throw new Error("production release pin must be an object");
  const fields = [
    "tag",
    "version",
    "artifact",
    "sha256",
    "keyId",
    "keySpkiSha256",
  ];
  if (fields.some((field) => typeof value[field] !== "string")) {
    throw new Error("production release pin has missing or invalid fields");
  }
  const pin = value as unknown as ReleasePin;
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin.version) ||
    pin.tag !== `v${pin.version}` ||
    pin.artifact !== `openpcb-core-library-${pin.version}.opclib` ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    !/^[a-f0-9]{64}$/.test(pin.keySpkiSha256) ||
    !/^[a-zA-Z0-9_-]+$/.test(pin.keyId)
  ) {
    throw new Error("production release pin identity is malformed");
  }
  return pin;
}

export function readPolicy(repoRoot: string): ReleasePolicy {
  const value: unknown = JSON.parse(
    readFileSync(
      path.join(repoRoot, "resources", "core-library-release.json"),
      "utf8",
    ),
  );
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.repository !== "string" ||
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value.repository) ||
    typeof value.minComponents !== "number" ||
    !Number.isSafeInteger(value.minComponents) ||
    value.minComponents < 10
  ) {
    throw new Error("invalid committed CoreLibrary release policy");
  }
  return {
    schemaVersion: 1,
    repository: value.repository,
    minComponents: value.minComponents,
    productionRelease:
      value.productionRelease === null
        ? null
        : parsePin(value.productionRelease),
  };
}

export function requireRelease(policy: ReleasePolicy): ReleasePin {
  if (!policy.productionRelease) {
    throw new Error(
      "no qualified CoreLibrary production release: publish a release signed by the existing trusted key, then review resources/core-library-release.json; v0.1.0-beta.1 is unsigned and unqualified (see docs/core-library-trust.md)",
    );
  }
  return policy.productionRelease;
}
