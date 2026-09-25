/**
 * The KiCad project importer's user-input failures. Every one is a problem with
 * the uploaded file, never a server fault, so each maps to a 4xx
 * `application/problem+json` response through `AppError` instead of a 500.
 * `reason` is a stable machine key for the wizard; `detail` is the user-facing
 * sentence.
 */

import { AppError } from "../../../../../core/contracts/errors";

export type KicadProjectImportFailure =
  | "legacy_kicad"
  | "library_archive"
  | "missing_project"
  | "missing_board"
  | "missing_schematic"
  | "unreadable_file";

const PROBLEM_BASE = "https://openpcb.dev/problems";

const TITLE_BY_FAILURE: Record<KicadProjectImportFailure, string> = {
  legacy_kicad: "Unsupported KiCad version",
  library_archive: "Not a KiCad project",
  missing_project: "Incomplete KiCad project",
  missing_board: "Incomplete KiCad project",
  missing_schematic: "Incomplete KiCad project",
  unreadable_file: "Unreadable KiCad file",
};

const TYPE_BY_FAILURE: Record<KicadProjectImportFailure, string> = {
  legacy_kicad: `${PROBLEM_BASE}/kicad-legacy-project`,
  library_archive: `${PROBLEM_BASE}/kicad-project-incomplete`,
  missing_project: `${PROBLEM_BASE}/kicad-project-incomplete`,
  missing_board: `${PROBLEM_BASE}/kicad-project-incomplete`,
  missing_schematic: `${PROBLEM_BASE}/kicad-project-incomplete`,
  unreadable_file: `${PROBLEM_BASE}/kicad-project-unreadable`,
};

export class KicadProjectImportError extends AppError {
  readonly reason: KicadProjectImportFailure;

  constructor(
    reason: KicadProjectImportFailure,
    detail: string,
    extras: Record<string, unknown> = {},
  ) {
    super(detail, 422, TITLE_BY_FAILURE[reason], TYPE_BY_FAILURE[reason], {
      reason,
      ...extras,
    });
    this.reason = reason;
  }
}

/**
 * Run one parser over one archive file; a parse failure is the FILE's fault,
 * so it becomes a 422 naming the file instead of escaping as a 500.
 */
export function parseProjectFile<T>(
  fileName: string,
  parse: () => T,
): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof AppError) throw error;
    const cause = error instanceof Error ? error.message : String(error);
    throw new KicadProjectImportError(
      "unreadable_file",
      `'${fileName}' could not be read as a KiCad file: ${cause}`,
      { fileName },
    );
  }
}
