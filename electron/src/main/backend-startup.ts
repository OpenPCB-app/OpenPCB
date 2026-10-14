import type { StartedBackendRuntime } from "../../../src/core/backend/runtime";
import type { ModuleRegistryResponse } from "../../../src/core/contracts/modules/registry";

// The assistant is deliberately optional: its failure degrades to "assistant unavailable"
// (user decision, OPENPCB-116) so a damaged agentkit.sqlite never blocks design work.
const REQUIRED_DESKTOP_MODULES = ["library", "designer"] as const;

export function summarizeModuleSnapshot(
  snapshot: ModuleRegistryResponse,
): string {
  if (snapshot.modules.length === 0)
    return "No module manifests were discovered.";
  return snapshot.modules
    .map((module) => {
      const reason = module.reason ? ` — ${module.reason}` : "";
      return `${module.id}: ${module.status}${reason}`;
    })
    .join("\n");
}

export class DesktopModuleStartupError extends Error {
  readonly code = "DESKTOP_REQUIRED_MODULES_FAILED";
  readonly recoverable = true;

  constructor(
    readonly missingModules: readonly string[],
    snapshot: ModuleRegistryResponse,
  ) {
    super(
      `Desktop backend started, but required module(s) failed to load: ${missingModules.join(", ")}\n\nModule registry:\n${summarizeModuleSnapshot(snapshot)}`,
    );
    this.name = "DesktopModuleStartupError";
  }
}

interface DesktopStartupCleanup {
  close(): Promise<void>;
  reportCleanupFailure(error: unknown): void;
  reportFailure?(error: unknown): void;
}

interface DesktopStartupDependencies extends DesktopStartupCleanup {
  start(): Promise<StartedBackendRuntime>;
  logSnapshot(snapshot: ModuleRegistryResponse): void;
}

export async function failDesktopStartup(
  error: unknown,
  dependencies: DesktopStartupCleanup,
): Promise<never> {
  try {
    await dependencies.close();
  } catch (cleanupError) {
    try {
      dependencies.reportCleanupFailure(cleanupError);
    } catch {
      // A diagnostic failure must not replace the original startup cause.
    }
  }
  try {
    dependencies.reportFailure?.(error);
  } catch {
    // Preserve the cause even when logging or telemetry is unavailable.
  }
  throw error;
}

/** Startup failure can require repair by the user; it never authorizes discarding data. */
export async function startRequiredDesktopRuntime(
  dependencies: DesktopStartupDependencies,
): Promise<StartedBackendRuntime> {
  try {
    const started = await dependencies.start();
    dependencies.logSnapshot(started.snapshot);
    const missing = REQUIRED_DESKTOP_MODULES.filter(
      (id) => !started.snapshot.loadedModules.includes(id),
    );
    if (missing.length > 0)
      throw new DesktopModuleStartupError(missing, started.snapshot);
    return started;
  } catch (error) {
    return failDesktopStartup(error, dependencies);
  }
}
