import type { ModuleRouterHandle } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantAvailability,
  AssistantUnavailable,
  AssistantUnavailableCode,
} from "../../../sdks/assistant/availability";

const CORRUPT = new Set(["SQLITE_NOTADB", "sqlite_schema_integrity"]);
const UNREADABLE = new Set(["EACCES", "EPERM", "EROFS", "SQLITE_CANTOPEN", "SQLITE_READONLY", "SQLITE_PERM", "SQLITE_AUTH"]);
const UNSUPPORTED = new Set(["sqlite_schema_version"]);

function errorCodes(error: unknown, found: Set<string> = new Set(), depth = 0): Set<string> {
  if (!error || typeof error !== "object" || depth > 6) return found;
  if ("code" in error && typeof error.code === "string") found.add(error.code);
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const inner of error.errors) errorCodes(inner, found, depth + 1);
  }
  if ("cause" in error) errorCodes(error.cause, found, depth + 1);
  return found;
}

function classify(codes: Set<string>): AssistantUnavailableCode {
  const all = [...codes];
  if (all.some((code) => UNREADABLE.has(code))) return "ASSISTANT_DATABASE_UNREADABLE";
  if (all.some((code) => CORRUPT.has(code) || code.startsWith("SQLITE_CORRUPT"))) return "ASSISTANT_DATABASE_CORRUPT";
  if (all.some((code) => UNSUPPORTED.has(code))) return "ASSISTANT_DATABASE_UNSUPPORTED";
  return "ASSISTANT_RUNTIME_FAILED";
}

function message(code: AssistantUnavailableCode, path: string | undefined): string {
  const file = path ? `The assistant database at ${path}` : "The assistant database";
  const keep = "Designs and libraries are unaffected; the file was left in place for diagnosis.";
  switch (code) {
    case "ASSISTANT_DATABASE_CORRUPT":
      return `${file} is damaged or is not an OpenPCB assistant database. ${keep} Quit OpenPCB and move the file aside to start a fresh assistant history.`;
    case "ASSISTANT_DATABASE_UNREADABLE":
      return `${file} cannot be opened (permission denied or read-only). ${keep} Restore read and write access to it, then restart OpenPCB.`;
    case "ASSISTANT_DATABASE_UNSUPPORTED":
      return `${file} was written by a newer or unsupported OpenPCB version. ${keep} Update OpenPCB, or move the file aside to start a fresh assistant history.`;
    case "ASSISTANT_RUNTIME_FAILED":
      return "The assistant runtime failed to start. Designs and libraries are unaffected. Restart OpenPCB; if this persists, check the application log.";
  }
}

/** Never resets, renames or rewrites the assistant database: the user decides what to do with it. */
export function describeAssistantUnavailable(error: unknown, databasePath: string | undefined): AssistantUnavailable {
  const code = classify(errorCodes(error));
  return {
    available: false,
    code,
    message: message(code, databasePath),
    ...(databasePath && code !== "ASSISTANT_RUNTIME_FAILED" ? { databasePath } : {}),
  };
}

export function errorSummary(error: unknown): { codes: string[]; message: string } {
  return {
    codes: [...errorCodes(error)],
    message: error instanceof Error ? error.message : "Unknown assistant boot failure",
  };
}

export function registerAvailabilityRoute(router: ModuleRouterHandle, availability: AssistantAvailability): void {
  router.get("/availability", () => Response.json(availability));
}
