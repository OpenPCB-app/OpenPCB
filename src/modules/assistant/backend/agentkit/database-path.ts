import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { ValidationError } from "../../../../core/contracts/errors";

async function canonicalPath(path: string): Promise<string> {
  let current = resolve(path);
  const absent: string[] = [];
  for (;;) {
    try { return join(await realpath(current), ...absent.reverse()); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      absent.push(basename(current));
      current = parent;
    }
  }
}

export async function separateDatabasePath(
  agentKitPath: string, applicationPath?: string,
): Promise<string> {
  const path = await canonicalPath(agentKitPath);
  const explicit = applicationPath || process.env.OPENPCB_DB_PATH;
  const appPath = explicit || (process.env.NODE_ENV === "development" ? "dev-data/openpcb.sqlite" : join(homedir(), ".openpcb/data.sqlite"));
  if (path === await canonicalPath(appPath)) {
    throw new ValidationError("AgentKit requires a separate database");
  }
  return path;
}
