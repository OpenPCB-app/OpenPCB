import { AppError } from "../../../core/contracts/errors";
import { isFeatureEnabled } from "../../../core/contracts/feature-flags/backend";
import {
  MANUFACTURING_UNAVAILABLE,
  PROJECT_IMPORT_UNAVAILABLE,
  QUALIFICATION_BLOCKERS,
} from "../shared/capability-policy";

/** A valid-looking coordinate net ID can already refer to a different electrical net. */
export function assertQualifiedManufacturing(): void {
  if (!isFeatureEnabled("designer.outputQuarantine")) return;
  throw new AppError(
    MANUFACTURING_UNAVAILABLE,
    422,
    "Manufacturing output unqualified",
    "https://openpcb.dev/problems/unqualified-manufacturing",
    {
      code: "UNQUALIFIED_MANUFACTURING",
      blockedCapability: "manufacturing-export",
      blockers: [...QUALIFICATION_BLOCKERS],
    },
  );
}

export function assertQualifiedProjectImport(): void {
  if (!isFeatureEnabled("designer.outputQuarantine")) return;
  throw new AppError(
    PROJECT_IMPORT_UNAVAILABLE,
    422,
    "KiCad project import unqualified",
    "https://openpcb.dev/problems/unqualified-import",
    {
      code: "UNQUALIFIED_IMPORT",
      blockedCapability: "kicad-project-import",
      blockers: [...QUALIFICATION_BLOCKERS],
    },
  );
}
