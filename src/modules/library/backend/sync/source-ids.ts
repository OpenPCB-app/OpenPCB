/**
 * Library source ids the backend owns. Trust is decided by id, never by the
 * `library.kind` an `.opclib` manifest declares: a manifest is untrusted input,
 * so a pack that omits or spoofs `kind: "core"` must not become read-only core.
 */
export const CORE_SOURCE_ID = "openpcb.core";
export const USER_LOCAL_SOURCE_ID = "user.local";

export type LibrarySourceKind = "core" | "user" | "team";

/** The bundled core and the local user library can never be removed or overwritten by an install. */
export function isProtectedSourceId(sourceId: string): boolean {
  return sourceId === CORE_SOURCE_ID || sourceId === USER_LOCAL_SOURCE_ID;
}

/**
 * Stored `kind` for an imported library: `core` only for the bundled core id;
 * any other pack keeps a declared `user` and otherwise becomes `team`.
 */
export function trustedSourceKind(library: {
  id: string;
  kind?: string;
}): LibrarySourceKind {
  if (library.id === CORE_SOURCE_ID) return "core";
  return library.kind === "user" ? "user" : "team";
}
