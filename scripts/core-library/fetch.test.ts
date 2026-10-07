import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fetchCoreLibrary } from "./fetch";
import { downloader, fixture, writePolicy } from "./test-fixture";

const roots: string[] = [];
function setup() {
  const result = fixture();
  roots.push(result.repoRoot);
  return result;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("CoreLibrary fetch/cache and CLI", () => {
  test("injected download uses pinned identity, publishes then revalidates cache without network", async () => {
    const f = setup();
    let downloads = 0;
    const download = (
      request: Parameters<ReturnType<typeof downloader>>[0],
    ) => {
      expect(request.repository).toBe(f.policy.repository);
      expect(request.pin.tag).toBe("v1.2.3");
      downloads++;
      downloader(f.files)(request);
    };
    const options = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download,
    };
    expect((await fetchCoreLibrary(options)).sha256).toBe(f.pin.sha256);
    const target = path.join(
      f.repoRoot,
      "resources",
      "core-library",
      f.pin.artifact,
    );
    expect(readFileSync(target)).toEqual(Buffer.from(f.files.artifact));
    expect(
      (await fetchCoreLibrary({ ...options, args: ["--offline"] })).keyId,
    ).toBe(f.pin.keyId);
    expect(downloads).toBe(1);
    expect(
      readdirSync(path.dirname(target)).some((name) =>
        name.startsWith(".verified-"),
      ),
    ).toBe(false);
  });

  test("poisoned cache and revoked cache signing key are rejected; previous artifacts intact", async () => {
    const f = setup();
    const options = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    };
    await fetchCoreLibrary(options);
    const cache = path.join(
      f.repoRoot,
      ".build",
      "core-library-cache",
      f.pin.sha256,
      f.pin.artifact,
    );
    const target = path.join(
      f.repoRoot,
      "resources",
      "core-library",
      f.pin.artifact,
    );
    writeFileSync(cache, "poison");
    await expect(
      fetchCoreLibrary({ ...options, args: ["--offline"] }),
    ).rejects.toThrow("sha256 mismatch");
    expect(readFileSync(target)).toEqual(Buffer.from(f.files.artifact));
    writeFileSync(cache, f.files.artifact);
    rmSync(path.join(f.repoRoot, "resources", "keys", `${f.pin.keyId}.pub`));
    await expect(fetchCoreLibrary(options)).rejects.toThrow("unknown-key");
    expect(readFileSync(target)).toEqual(Buffer.from(f.files.artifact));
  });

  test("failed new download leaves every previous artifact and sum unchanged", async () => {
    const f = setup();
    const destinations = [
      path.join(f.repoRoot, ".build", "core-library"),
      path.join(f.repoRoot, "resources", "core-library"),
    ];
    for (const directory of destinations) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, "previous.opclib"),
        "previous trusted bytes",
      );
      writeFileSync(
        path.join(directory, "SHA256SUMS"),
        "previous trusted sums",
      );
    }
    await expect(
      fetchCoreLibrary({
        repoRoot: f.repoRoot,
        args: [],
        environment: {},
        download: downloader({
          ...f.files,
          sums: `${"0".repeat(64)}  ${f.pin.artifact}\n`,
        }),
      }),
    ).rejects.toThrow("sha256 mismatch");
    for (const directory of destinations) {
      expect(
        readFileSync(path.join(directory, "previous.opclib"), "utf8"),
      ).toBe("previous trusted bytes");
      expect(readFileSync(path.join(directory, "SHA256SUMS"), "utf8")).toBe(
        "previous trusted sums",
      );
      expect(existsSync(path.join(directory, f.pin.artifact))).toBe(false);
    }
    expect(
      existsSync(path.join(f.repoRoot, ".build", "core-library-cache")),
    ).toBe(false);
  });

  test("cache checksum/public-key poisoning and missing signature sidecars fail closed", async () => {
    const f = setup();
    const options = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    };
    await fetchCoreLibrary(options);
    const cache = path.join(
      f.repoRoot,
      ".build",
      "core-library-cache",
      f.pin.sha256,
    );
    const sums = path.join(cache, "SHA256SUMS");
    writeFileSync(sums, `${"0".repeat(64)}  ${f.pin.artifact}\n`);
    await expect(fetchCoreLibrary(options)).rejects.toThrow("sha256 mismatch");
    writeFileSync(sums, f.files.sums);
    writeFileSync(path.join(cache, "openpcb-core.pub"), "not a public key");
    await expect(fetchCoreLibrary(options)).rejects.toThrow();
    rmSync(path.join(cache, "openpcb-core.pub"));
    await expect(fetchCoreLibrary(options)).rejects.toThrow("ENOENT");
    const target = path.join(
      f.repoRoot,
      "resources",
      "core-library",
      f.pin.artifact,
    );
    expect(readFileSync(target)).toEqual(Buffer.from(f.files.artifact));
  });

  test("incomplete or extra release downloads never replace previous artifacts", async () => {
    const f = setup();
    const destination = path.join(f.repoRoot, "resources", "core-library");
    mkdirSync(destination);
    const previous = path.join(destination, "previous.opclib");
    writeFileSync(previous, "previous trusted bytes");
    for (const extra of [false, true]) {
      await expect(
        fetchCoreLibrary({
          repoRoot: f.repoRoot,
          args: [],
          environment: {},
          download: (request) => {
            downloader(f.files)(request);
            if (extra)
              writeFileSync(
                path.join(request.directory, "extra.opclib"),
                "poison",
              );
            else rmSync(path.join(request.directory, "openpcb-core.pub"));
          },
        }),
      ).rejects.toThrow("release download must contain exactly");
      expect(readFileSync(previous, "utf8")).toBe("previous trusted bytes");
      expect(existsSync(path.join(destination, f.pin.artifact))).toBe(false);
    }
  });

  test("FIFO cache entries are rejected without waiting for a writer", async () => {
    if (process.platform === "win32") return;
    const f = setup();
    const options = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    };
    await fetchCoreLibrary(options);
    const cache = path.join(
      f.repoRoot,
      ".build",
      "core-library-cache",
      f.pin.sha256,
    );
    const target = path.join(cache, f.pin.artifact);
    rmSync(target);
    expect(spawnSync("mkfifo", [target]).status).toBe(0);
    const runner = path.join(f.repoRoot, "fifo-cli.ts");
    const script = path.resolve(import.meta.dir, "..", "fetch-core-library.ts");
    writeFileSync(
      runner,
      `import { runCoreLibraryCli } from ${JSON.stringify(script)};\nawait runCoreLibraryCli({repoRoot: ${JSON.stringify(f.repoRoot)}, args: ["--offline"], environment: {}});\n`,
    );
    const rejected = spawnSync(process.execPath, [runner], {
      encoding: "utf8",
      timeout: 2000,
    });
    expect(rejected.error).toBeUndefined();
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("unsafe or oversized release file");
    expect(
      readFileSync(
        path.join(f.repoRoot, "resources", "core-library", f.pin.artifact),
      ),
    ).toEqual(Buffer.from(f.files.artifact));
  });

  test("poisoned destination and symlink destination/cache refused before publishing", async () => {
    const f = setup();
    const destination = path.join(f.repoRoot, "resources", "core-library");
    mkdirSync(destination);
    const target = path.join(destination, f.pin.artifact);
    writeFileSync(target, "poison");
    const options = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    };
    await expect(fetchCoreLibrary(options)).rejects.toThrow(
      "poisoned artifact destination",
    );
    expect(readFileSync(target, "utf8")).toBe("poison");
    rmSync(target);
    symlinkSync(
      path.join(f.repoRoot, "resources", "core-library-release.json"),
      target,
    );
    await expect(fetchCoreLibrary(options)).rejects.toThrow(
      "unsafe artifact destination",
    );
    rmSync(target);
    mkdirSync(path.join(f.repoRoot, ".build"));
    symlinkSync(
      destination,
      path.join(f.repoRoot, ".build", "core-library-cache"),
    );
    await expect(fetchCoreLibrary(options)).rejects.toThrow(
      "unsafe artifact directory",
    );
  });

  test("tag, repository, threshold and unknown-argument overrides cannot bypass pin", async () => {
    const f = setup();
    const base = {
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    };
    for (const args of [
      ["v1.2.2"],
      ["--tag=v1.2.4"],
      ["v1.2.3", "v1.2.2"],
      ["--force"],
    ]) {
      await expect(fetchCoreLibrary({ ...base, args })).rejects.toThrow();
    }
    for (const environment of [
      { OPENPCB_CORELIB_TAG: "v1.2.2" },
      { OPENPCB_CORELIB_REPO: "attacker/library" },
      { OPENPCB_CORELIB_MIN_COMPONENTS: "0" },
    ])
      await expect(fetchCoreLibrary({ ...base, environment })).rejects.toThrow(
        "override refused",
      );
    expect(
      (await fetchCoreLibrary({ ...base, args: ["--tag=v1.2.3"] })).version,
    ).toBe("1.2.3");
  });

  test("unqualified policy cannot succeed with offline or skip in any NODE_ENV", async () => {
    const f = setup();
    writePolicy(f.repoRoot, { ...f.policy, productionRelease: null });
    for (const NODE_ENV of ["development", "test", "production"]) {
      await expect(
        fetchCoreLibrary({
          repoRoot: f.repoRoot,
          args: ["--offline"],
          environment: { NODE_ENV, OPENPCB_SKIP_CORELIB_FETCH: "1" },
          download: () => {
            throw new Error("must never download unqualified release");
          },
        }),
      ).rejects.toThrow("no qualified CoreLibrary production release");
    }
  });

  test("real CLI offline success and skip failure use production entrypoint", async () => {
    const f = setup();
    const runner = path.join(f.repoRoot, "cli.ts");
    const script = path.resolve(import.meta.dir, "..", "fetch-core-library.ts");
    writeFileSync(
      runner,
      `import { runCoreLibraryCli } from ${JSON.stringify(script)};\nawait runCoreLibraryCli({repoRoot: ${JSON.stringify(f.repoRoot)}});\n`,
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      OPENPCB_SKIP_CORELIB_FETCH: "1",
    };
    delete environment.OPENPCB_CORELIB_TAG;
    delete environment.OPENPCB_CORELIB_REPO;
    delete environment.OPENPCB_CORELIB_MIN_COMPONENTS;
    const missing = spawnSync(process.execPath, [runner], {
      env: environment,
      encoding: "utf8",
    });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain(
      "offline fetch requires an already verified pinned cache",
    );
    await fetchCoreLibrary({
      repoRoot: f.repoRoot,
      args: [],
      environment: {},
      download: downloader(f.files),
    });
    const success = spawnSync(process.execPath, [runner, "--offline"], {
      env: environment,
      encoding: "utf8",
    });
    expect(success.status).toBe(0);
    expect(JSON.parse(success.stdout).sha256).toBe(f.pin.sha256);
    const cache = path.join(
      f.repoRoot,
      ".build",
      "core-library-cache",
      f.pin.sha256,
      f.pin.artifact,
    );
    writeFileSync(cache, "poison");
    const poisoned = spawnSync(process.execPath, [runner], {
      env: environment,
      encoding: "utf8",
    });
    expect(poisoned.status).toBe(1);
    expect(poisoned.stdout).toBe("");
    expect(poisoned.stderr).toContain("sha256 mismatch");
  });
});
