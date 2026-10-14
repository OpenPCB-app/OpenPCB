export const QUALIFICATION_BLOCKERS = [
  "electrical-identity",
  "source-frame",
  "output-completeness",
] as const;

export const MANUFACTURING_UNAVAILABLE =
  "Manufacturing exports are unavailable until electrical identities, source coordinate frames and complete output are qualified. Gerber, drill and placement-coordinate files cannot be generated; DRC acknowledgement does not override this restriction.";

export const PROJECT_IMPORT_UNAVAILABLE =
  "KiCad project import is unavailable until electrical identities, source coordinate frames and entity completeness are qualified. ZIP inspection remains available; inspection does not create a design or import Library assets.";
