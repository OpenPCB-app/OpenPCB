export type Revision = number;

export interface RevisionConflict {
  expected: Revision | null;
  actual: Revision;
}

export function nextRevision(current: Revision): Revision {
  return current + 1;
}
