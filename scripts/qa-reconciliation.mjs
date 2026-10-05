import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSources, MANIFEST, sha256 } from "./qa-reconciliation-sources.mjs";
import { validateManifest } from "./qa-reconciliation-validation.mjs";

const EVIDENCE = "docs/qa/2026-10-hardening/evidence/";

function repositoryFile(repo, path) {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\")) {
    throw new Error("artifact must use a repository-relative path");
  }
  if (
    path
      .split("/")
      .some((part) => ["..", ".", ".git", "node_modules"].includes(part))
  ) {
    throw new Error("artifact path traversal or excluded directory");
  }
  const real = realpathSync(resolve(repo, path));
  const within = relative(realpathSync(repo), real);
  if (within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error("artifact symlink escapes repository");
  }
  if (!statSync(real).isFile())
    throw new Error("artifact is not a regular file");
  return real;
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function createVerifier(repo) {
  return {
    file(path, hash) {
      try {
        if (!path.startsWith(EVIDENCE))
          return "fresh evidence must live under the hardening evidence directory";
        const bytes = readFileSync(repositoryFile(repo, path));
        return sha256(bytes) === hash ? "" : "artifact SHA-256 mismatch";
      } catch (error) {
        return `artifact unavailable: ${error.message}`;
      }
    },
    commit(sha) {
      try {
        git(repo, ["cat-file", "-e", `${sha}^{commit}`]);
        git(repo, ["merge-base", "--is-ancestor", sha, "HEAD"]);
        return "";
      } catch {
        return "commit missing or not reachable from current HEAD";
      }
    },
    ancestor(ancestor, descendant) {
      try {
        git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
        return "";
      } catch {
        return "evidence HEAD does not contain implementation/regression commit";
      }
    },
    regression(commit, path) {
      try {
        if (!/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path))
          return "regression must reference a test source file";
        const bytes = readFileSync(repositoryFile(repo, path));
        const committed = git(repo, ["show", `${commit}:${path}`]);
        git(repo, ["merge-base", "--is-ancestor", commit, "HEAD"]);
        return bytes.equals(committed)
          ? ""
          : "regression source differs from committed evidence";
      } catch (error) {
        return `committed regression unavailable: ${error.message}`;
      }
    },
  };
}

export function run(repo, path = MANIFEST, { verifyArchive = false } = {}) {
  const manifest = JSON.parse(readFileSync(resolve(repo, path), "utf8"));
  const errors = validateManifest(
    manifest,
    loadSources(repo, { verifyArchive }),
    createVerifier(repo),
  );
  if (errors.length) {
    for (const error of errors) console.error(error);
    return 1;
  }
  const states = manifest.roots.reduce((counts, root) => {
    counts[root.reproductionState] = (counts[root.reproductionState] ?? 0) + 1;
    return counts;
  }, {});
  const fixed = manifest.roots.filter(
    (root) => root.resolution === "fixed",
  ).length;
  console.log(
    `Reconciliation valid: 395 roots; 480 raw aliases; 344 historical approvals; ${fixed} qualified fixes.`,
  );
  console.log(`Fresh reproduction states: ${JSON.stringify(states)}.`);
  console.log(
    `Historical source contradictions retained: ${manifest.contradictions.length}. Validation is not a release gate or proof of behavioral correctness.`,
  );
  console.log(
    verifyArchive
      ? "Source verification: pinned projection matched all 89 original archive/source fingerprints."
      : "Source verification: pinned portable projection only; original archive not inspected.",
  );
  return 0;
}

function parseArguments(args) {
  const verifyArchive = args.includes("--verify-archive");
  const paths = args.filter((arg) => arg !== "--verify-archive");
  if (
    paths.length > 1 ||
    paths.some((arg) => arg.startsWith("-")) ||
    args.filter((arg) => arg === "--verify-archive").length > 1
  ) {
    throw new Error(
      "Usage: node scripts/qa-reconciliation.mjs [--verify-archive] [manifest.json]",
    );
  }
  return { path: paths[0], verifyArchive };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const { path, verifyArchive } = parseArguments(process.argv.slice(2));
    process.exitCode = run(process.cwd(), path, { verifyArchive });
  } catch (error) {
    console.error(`Reconciliation unavailable: ${error.message}`);
    process.exitCode = 1;
  }
}
