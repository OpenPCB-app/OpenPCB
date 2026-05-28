import { useCallback, useEffect, useState } from "react";

/**
 * Per-design user state (starred / archived) persisted client-side in
 * localStorage. Intentionally NOT stored in the .openpcb package (it must not
 * follow a shared design) — migrate to a SQLite user-state table in a later
 * wave.
 */

const STAR_KEY = "openpcb.home.starred";
const ARCHIVE_KEY = "openpcb.home.archived";

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // storage unavailable (private mode, quota) — ignore
  }
}

export interface DesignUserState {
  isStarred: (id: string) => boolean;
  isArchived: (id: string) => boolean;
  toggleStar: (id: string) => void;
  toggleArchive: (id: string) => void;
  starredCount: number;
  archivedCount: number;
}

export function useDesignUserState(): DesignUserState {
  const [starred, setStarred] = useState<Set<string>>(() => readSet(STAR_KEY));
  const [archived, setArchived] = useState<Set<string>>(() =>
    readSet(ARCHIVE_KEY),
  );

  useEffect(() => writeSet(STAR_KEY, starred), [starred]);
  useEffect(() => writeSet(ARCHIVE_KEY, archived), [archived]);

  const toggleStar = useCallback((id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleArchive = useCallback((id: string) => {
    setArchived((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  return {
    isStarred: useCallback((id) => starred.has(id), [starred]),
    isArchived: useCallback((id) => archived.has(id), [archived]),
    toggleStar,
    toggleArchive,
    starredCount: starred.size,
    archivedCount: archived.size,
  };
}
