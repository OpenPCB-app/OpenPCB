export type Revision = number;

export interface RevisionConflict {
  code: "REVISION_CONFLICT";
  serverRevision: Revision;
}
