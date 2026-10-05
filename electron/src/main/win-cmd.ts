/**
 * Windows command-line helpers for running the user's `claude` CLI without
 * trusting cmd.exe's parser more than necessary. Pure (no `electron`, no
 * `child_process`) so Bun tests pin the behaviour down on any OS.
 *
 * Preferred path: an npm-installed `claude.cmd` is an npm "cmd-shim" that
 * only runs `node <package>\cli.js %*` (or an .exe). `cmdShimTarget` reads
 * that target out of the shim so the CLI can be spawned directly — no cmd.exe
 * at all, so no quoting rules to get wrong.
 *
 * Fallback (a .cmd we cannot parse): `cmd.exe /d /s /c "<line>"` with
 * `windowsVerbatimArguments`, escaped by the algorithm cross-spawn uses
 * (https://github.com/moxystudio/node-cross-spawn, lib/util/escape.js, MIT;
 * itself based on https://qntm.org/cmd): quote each argument for the C
 * runtime, then caret-escape every cmd metacharacter — including `%`, `&`,
 * `^`, `(`, `)` — and escape once more when the target re-parses `%*`
 * (a cmd-shim does).
 */

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Escape the program path for a cmd.exe command line. */
export function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META, "^$1");
}

/** Escape one argument for `cmd.exe /d /s /c "<line>"` (verbatim arguments). */
export function escapeCmdArgument(argument: string, doubleEscapeMeta = false): string {
  let arg = `${argument}`;
  // Double the backslashes that precede a quote, and escape the quote.
  arg = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  // Double trailing backslashes (they will precede the closing quote).
  arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
  arg = `"${arg}"`;
  arg = arg.replace(CMD_META, "^$1");
  if (doubleEscapeMeta) arg = arg.replace(CMD_META, "^$1");
  return arg;
}

/** The full `/c` payload for running `command args…` through cmd.exe. */
export function cmdCommandLine(command: string, args: readonly string[], doubleEscapeMeta: boolean): string {
  return `"${[escapeCmdCommand(command), ...args.map((a) => escapeCmdArgument(a, doubleEscapeMeta))].join(" ")}"`;
}

/**
 * The script or binary an npm cmd-shim runs, relative to the shim's folder
 * (`node_modules\@anthropic-ai\claude-code\cli.js`), or null when the file is
 * not a recognisable shim. Handles both shim generations (`%dp0%\` and
 * `%~dp0\`).
 */
export function cmdShimTarget(content: string): { path: string; kind: "script" | "exe" } | null {
  // The target is on the line that forwards the arguments (`%*`) — not the
  // `IF EXIST "%dp0%\node.exe"` probe for a bundled node.
  const line = content.split(/\r?\n/).find((l) => l.includes("%*"));
  if (!line) return null;
  const pattern = /"%(?:~dp0|dp0%)\\?([^"%]+?\.(c?js|mjs|exe))"/gi;
  let target: { path: string; kind: "script" | "exe" } | null = null;
  for (const match of line.matchAll(pattern)) {
    if (/(^|\\)node\.exe$/i.test(match[1]!)) continue;
    target = { path: match[1]!, kind: match[2]!.toLowerCase() === "exe" ? "exe" : "script" };
  }
  return target;
}

/** A cmd-shim forwards its arguments with `%*`, which cmd.exe parses again. */
export function reparsesArguments(content: string | null): boolean {
  return content === null || content.includes("%*");
}
