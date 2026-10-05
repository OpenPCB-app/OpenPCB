#!/usr/bin/env bun
import path from "node:path";
import { fetchCoreLibrary, type FetchOptions } from "./core-library/fetch";

export { fetchCoreLibrary } from "./core-library/fetch";

export async function runCoreLibraryCli(options: FetchOptions): Promise<void> {
  try {
    const summary = await fetchCoreLibrary(options);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    console.error(
      `[corelib:fetch] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await runCoreLibraryCli({ repoRoot: path.resolve(import.meta.dir, "..") });
}
