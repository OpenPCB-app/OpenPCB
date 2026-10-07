import { app } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { CredentialError, publicCredentialError } from "../../src/core/contracts/credentials/secret-store";
import { CredentialVault, createSecretReference } from "../src/main/credential-vault";
import { osCredentialEncryption } from "../src/main/credential-runtime";

type Stage = "write" | "read" | "rotate" | "clear" | "read-cleared";
interface SmokeState { reference: string; digest: string }

class SmokeError extends Error {
  constructor(readonly code: "INVALID_SMOKE_PROFILE" | "READBACK_MISMATCH" | "PLAINTEXT_PERSISTED" | "PERMISSIONS_MISMATCH") {
    super(code);
  }
}

function digest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

function smokeRoot(value: string | undefined): string {
  if (!value) throw new SmokeError("INVALID_SMOKE_PROFILE");
  const root = realpathSync(resolve(value));
  const temporary = realpathSync(tmpdir());
  const withinTemporary = relative(temporary, root);
  if (!withinTemporary || withinTemporary.startsWith("..")
    || !/^openpcb-credential-native-[A-Za-z0-9_-]+$/.test(basename(root))) {
    throw new SmokeError("INVALID_SMOKE_PROFILE");
  }
  const marker: unknown = JSON.parse(readFileSync(join(root, "smoke-profile.json"), "utf8"));
  if (typeof marker !== "object" || marker === null
    || (marker as Record<string, unknown>).purpose !== "openpcb-credential-native-smoke") {
    throw new SmokeError("INVALID_SMOKE_PROFILE");
  }
  return root;
}

async function readState(root: string): Promise<SmokeState> {
  const state = JSON.parse(await readFile(join(root, "smoke-state.json"), "utf8")) as SmokeState;
  if (!/^provider\/[0-9a-f-]{36}$/.test(state.reference) || !/^[0-9a-f]{64}$/.test(state.digest)) {
    throw new SmokeError("INVALID_SMOKE_PROFILE");
  }
  return state;
}

async function writeSecret(vault: CredentialVault, path: string, root: string, reference: string): Promise<void> {
  const secret = `synthetic-native-smoke-${randomUUID()}`;
  await vault.set(reference, secret);
  if (await vault.get(reference) !== secret) throw new SmokeError("READBACK_MISMATCH");
  const content = await readFile(path, "utf8");
  if (content.includes(secret) || content.includes(Buffer.from(secret).toString("base64"))) {
    throw new SmokeError("PLAINTEXT_PERSISTED");
  }
  if (((await stat(path)).mode & 0o777) !== 0o600) throw new SmokeError("PERMISSIONS_MISMATCH");
  // Only a digest crosses process boundaries; the canary itself exists only in the encrypted vault.
  await writeFile(join(root, "smoke-state.json"), JSON.stringify({ reference, digest: digest(secret) }), { mode: 0o600 });
}

async function executeStage(stage: Stage, root: string): Promise<string[]> {
  const path = join(root, "profile", "credential-vault.json");
  const vault = new CredentialVault(path, osCredentialEncryption);
  if (stage === "write") {
    await writeSecret(vault, path, root, createSecretReference());
    return ["OS encryption", "durable write", "readback", "no plaintext/base64 fallback", "0600"];
  }
  const state = await readState(root);
  if (stage === "rotate") {
    await writeSecret(vault, path, root, state.reference);
    return ["OS encryption", "durable rotation", "readback", "no plaintext/base64 fallback", "0600"];
  }
  if (stage === "clear") {
    await vault.delete(state.reference);
    return ["durable clear"];
  }
  const secret = await vault.get(state.reference);
  if (stage === "read-cleared" ? secret !== null : secret === null || digest(secret) !== state.digest) {
    throw new SmokeError("READBACK_MISMATCH");
  }
  return [stage === "read-cleared" ? "cleared after process restart" : "OS decrypt after process restart"];
}

async function main(): Promise<void> {
  const stageValue = process.argv.find((argument) => argument.startsWith("--credential-stage="))?.split("=")[1];
  if (!["write", "read", "rotate", "clear", "read-cleared"].includes(stageValue ?? "")) {
    throw new SmokeError("INVALID_SMOKE_PROFILE");
  }
  const rootValue = process.argv.find((argument) => argument.startsWith("--credential-smoke-root="))?.slice("--credential-smoke-root=".length);
  // Configure every Electron data path before yielding or waiting for app readiness.
  const root = smokeRoot(rootValue);
  app.setName("OpenPCB Credential Native Smoke");
  app.setPath("userData", join(root, "profile"));
  app.setPath("sessionData", join(root, "profile"));
  app.setPath("logs", join(root, "logs"));
  app.setPath("crashDumps", join(root, "crash-dumps"));
  await app.whenReady();
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  const stage = stageValue as Stage;
  const checks = await executeStage(stage, root);
  console.log(`CREDENTIAL_NATIVE_RESULT ${JSON.stringify({
    passed: true, stage, pid: process.pid, platform: process.platform, arch: process.arch,
    electron: process.versions.electron, node: process.versions.node, packaged: app.isPackaged, checks,
  })}`);
}

main().then(() => app.exit(0), (error: unknown) => {
  const code = error instanceof SmokeError ? error.code
    : error instanceof CredentialError ? publicCredentialError(error).code : "NATIVE_SMOKE_FAILED";
  console.error(`CREDENTIAL_NATIVE_RESULT ${JSON.stringify({ passed: false, code })}`);
  app.exit(1);
});
