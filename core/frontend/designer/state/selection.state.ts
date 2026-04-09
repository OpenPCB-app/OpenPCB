export interface SelectionState {
  selectedEntityIds: Set<string>;
}

export function createInitialSelectionState(): SelectionState {
  return {
    selectedEntityIds: new Set(),
  };
}
