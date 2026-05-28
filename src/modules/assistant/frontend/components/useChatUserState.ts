import { useCallback, useEffect, useState } from "react";

/**
 * Per-chat user state (pinned / archived) persisted client-side in
 * localStorage — the assistant backend has no pin/archive fields yet. Mirrors
 * the Home dashboard's useDesignUserState; migrate to a server table later.
 */

const PIN_KEY = "openpcb.chat.pinned";
const ARCHIVE_KEY = "openpcb.chat.archived";

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
    // storage unavailable — ignore
  }
}

export interface ChatUserState {
  isPinned: (id: string) => boolean;
  isArchived: (id: string) => boolean;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  pinnedCount: number;
  archivedCount: number;
}

export function useChatUserState(): ChatUserState {
  const [pinned, setPinned] = useState<Set<string>>(() => readSet(PIN_KEY));
  const [archived, setArchived] = useState<Set<string>>(() =>
    readSet(ARCHIVE_KEY),
  );

  useEffect(() => writeSet(PIN_KEY, pinned), [pinned]);
  useEffect(() => writeSet(ARCHIVE_KEY, archived), [archived]);

  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
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
    isPinned: useCallback((id) => pinned.has(id), [pinned]),
    isArchived: useCallback((id) => archived.has(id), [archived]),
    togglePin,
    toggleArchive,
    pinnedCount: pinned.size,
    archivedCount: archived.size,
  };
}
