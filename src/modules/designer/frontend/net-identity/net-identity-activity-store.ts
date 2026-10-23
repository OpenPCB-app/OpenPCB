import { create } from "zustand";
import type { DesignerNetIdentityEvent } from "../../../../sdks/designer";

type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
export type NetIdentityActivitySource = "command" | "undo" | "redo";
export interface NetIdentityActivityContext {
  readonly scope: string;
  readonly designId: string;
  readonly revision: number;
  readonly source: NetIdentityActivitySource;
}
export interface NetIdentityActivityEntry extends NetIdentityActivityContext {
  readonly id: string;
  readonly eventIndex: number;
  readonly event: Immutable<DesignerNetIdentityEvent>;
  readonly read: boolean;
}
export interface NetIdentityActivityState {
  readonly entries: readonly NetIdentityActivityEntry[];
  readonly byDesign: Readonly<Record<string, readonly NetIdentityActivityEntry[]>>;
  append(context: NetIdentityActivityContext, events: readonly DesignerNetIdentityEvent[]): readonly NetIdentityActivityEntry[];
  markRead(scope: string, designId: string): void;
}

export const NET_IDENTITY_ACTIVITY_LIMIT = 200;
const EMPTY_ENTRIES: readonly NetIdentityActivityEntry[] = Object.freeze([]);
const designKey = (scope: string, designId: string) => JSON.stringify([scope, designId]);

function freeze<T>(value: T): Immutable<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as Immutable<T>;
}

function indexEntries(entries: readonly NetIdentityActivityEntry[]): NetIdentityActivityState["byDesign"] {
  const groups: Record<string, NetIdentityActivityEntry[]> = {};
  for (const entry of entries) (groups[designKey(entry.scope, entry.designId)] ??= []).push(entry);
  for (const group of Object.values(groups)) Object.freeze(group);
  return Object.freeze(groups);
}

/** Session memory only. Retry dedup lasts for the retained activity window. */
export function createNetIdentityActivityStore() {
  return create<NetIdentityActivityState>((set, get) => ({
    entries: EMPTY_ENTRIES,
    byDesign: Object.freeze({}),
    append(context, events) {
      const seen = new Set(get().entries.map((entry) => entry.id));
      const added: NetIdentityActivityEntry[] = [];
      events.forEach((event, eventIndex) => {
        const id = JSON.stringify([context.scope, context.designId, context.revision, eventIndex]);
        if (!seen.has(id)) added.push(Object.freeze({ ...context, id, eventIndex,
          event: freeze(structuredClone(event)), read: false }));
      });
      if (added.length === 0) return EMPTY_ENTRIES;
      const entries = Object.freeze([...get().entries, ...added].slice(-NET_IDENTITY_ACTIVITY_LIMIT));
      set({ entries, byDesign: indexEntries(entries) });
      return Object.freeze(added);
    },
    markRead(scope, designId) {
      const entries = get().entries.map((entry) => entry.scope === scope && entry.designId === designId && !entry.read
        ? Object.freeze({ ...entry, read: true }) : entry);
      if (entries.every((entry, index) => entry === get().entries[index])) return;
      Object.freeze(entries);
      set({ entries, byDesign: indexEntries(entries) });
    },
  }));
}

export const useNetIdentityActivityStore = createNetIdentityActivityStore();

/** Factory selectors return stable arrays between store updates, including absent designs. */
export const selectNetIdentityActivity = (scope: string, designId: string) =>
  (state: NetIdentityActivityState): readonly NetIdentityActivityEntry[] =>
    state.byDesign[designKey(scope, designId)] ?? EMPTY_ENTRIES;

export const selectNetIdentityUnreadCount = (scope: string, designId: string) =>
  (state: NetIdentityActivityState): number =>
    selectNetIdentityActivity(scope, designId)(state).filter((entry) => !entry.read).length;
