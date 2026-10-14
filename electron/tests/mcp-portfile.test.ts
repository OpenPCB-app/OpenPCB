import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Portfile = typeof import("../src/main/mcp-portfile");
let portfile: Portfile;

// Module mocks are process-wide in `bun test` and a re-mock cannot add export
// names, so this mock exposes the same names as the startup suite's `electron`
// mock. The query keeps this suite on the real portfile module even when
// another suite mocks it.
beforeAll(async () => {
  mock.module("electron", () => ({
    app: { getVersion: () => "portfile-test" },
    BrowserWindow: { getAllWindows: () => [] },
  }));
  mock.module("../src/main/logger.js", () => ({
    log: { scope: () => ({ info: () => {}, warn: () => {} }) },
  }));
  portfile = await import("../src/main/mcp-portfile.ts?portfile-unit") as Portfile;
});

let directory: string;
const filePath = () => join(directory, portfile.MCP_PORTFILE_NAME);
const mode = () => statSync(filePath()).mode & 0o777;
const write = () => portfile.writeMcpPortfile({ appDataDir: directory, url: "http://127.0.0.1:4567", port: 4567 });
const seed = (pid: unknown, permissions = 0o644) => {
  writeFileSync(filePath(), JSON.stringify({ version: 1, url: "http://127.0.0.1:1/x", port: 1, token: "other", pid }), { mode: permissions });
  chmodSync(filePath(), permissions);
};
function deadPid(): number {
  const exited = spawnSync(process.execPath, ["-e", ""]);
  if (!exited.pid) throw new Error("No pid for exited child");
  return exited.pid;
}

beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "openpcb-mcp-portfile-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe("MCP portfile", () => {
  test("fresh write is 0600 and carries this process's pid, URL and per-launch token", () => {
    const written = write();
    expect(written).toMatchObject({ pid: process.pid, port: 4567, url: "http://127.0.0.1:4567/api/modules/assistant/mcp",
      token: portfile.ensureMcpToken(), appVersion: "portfile-test" });
    expect(JSON.parse(readFileSync(filePath(), "utf8"))).toEqual(written);
    expect(mode()).toBe(0o600);
  });

  test("overwriting a stale or unparseable file tightens existing permissions to 0600", () => {
    seed(deadPid(), 0o644);
    expect(write()?.pid).toBe(process.pid);
    expect(mode()).toBe(0o600);
    writeFileSync(filePath(), "{not json");
    chmodSync(filePath(), 0o666);
    expect(write()?.pid).toBe(process.pid);
    expect(mode()).toBe(0o600);
    seed(process.pid, 0o640);
    expect(write()?.token).toBe(portfile.ensureMcpToken());
    expect(mode()).toBe(0o600);
  });

  test("a portfile owned by another live pid is never overwritten, cleared or removed", () => {
    seed(process.ppid);
    const before = readFileSync(filePath(), "utf8");
    expect(write()).toBeNull();
    portfile.clearStaleMcpPortfile(directory);
    portfile.removeMcpPortfile(directory);
    expect(readFileSync(filePath(), "utf8")).toBe(before);
  });

  test("stale and unparseable files are cleared; our own file is removed on shutdown", () => {
    seed(deadPid());
    portfile.clearStaleMcpPortfile(directory);
    expect(existsSync(filePath())).toBe(false);
    writeFileSync(filePath(), "garbage");
    portfile.clearStaleMcpPortfile(directory);
    expect(existsSync(filePath())).toBe(false);
    write();
    portfile.removeMcpPortfile(directory);
    expect(existsSync(filePath())).toBe(false);
  });
});
