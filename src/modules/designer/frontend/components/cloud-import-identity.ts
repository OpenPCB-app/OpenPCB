const ERROR = "Cloud import cannot preserve durable net identity yet. No local design was created.";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function namespaced(value: unknown): boolean {
  return typeof value === "string" && /^(net:|pending:|nc:)/.test(value);
}

function rowsHaveReference(value: unknown, fields: readonly string[]): boolean {
  return Array.isArray(value) && value.some((entry) => {
    const row = record(entry);
    return row !== null && fields.some((field) => namespaced(row[field]));
  });
}

function boardHasReference(board: Record<string, unknown>): boolean {
  if (Object.keys(record(board.perNetClassAssignments) ?? {}).some(namespaced)) return true;
  if (rowsHaveReference(board.diffPairs, ["pNetId", "nNetId"])) return true;
  if (Array.isArray(board.lengthMatchGroups) && board.lengthMatchGroups.some((value) => {
    const ids = record(value)?.netIds;
    return Array.isArray(ids) && ids.some(namespaced);
  })) return true;
  return Array.isArray(board.drcRules) && board.drcRules.some((value) => {
    const scopes = record(value)?.scopes;
    return Array.isArray(scopes) && scopes.some((value) => {
      const scope = record(value);
      return namespaced(scope?.netId) || (Array.isArray(scope?.netIds) && scope.netIds.some(namespaced));
    });
  });
}

function hasIdentity(node: Record<string, unknown>): boolean {
  // Inspect declared protocol fields only; labels and other authored text may
  // legitimately contain these strings without being identity references.
  if (Object.keys(node).some((key) => /^(netIdentity($|[A-Z])|net_identity($|_))/.test(key))) return true;
  if (rowsHaveReference(node.nets, ["id"])) return true;
  for (const key of ["traces", "vias", "freePads", "free_pads", "zones"]) {
    if (rowsHaveReference(node[key], ["netId"])) return true;
  }
  if (Object.keys(record(node.netNames) ?? {}).some(namespaced)) return true;
  if (Object.values(record(node.padNets) ?? {}).some(namespaced)) return true;
  return boardHasReference(node);
}

/** The current importer creates a new identity domain; it cannot restore a ledger. */
export function cloudNetIdentityImportError(projection: unknown): string | null {
  const root = record(projection);
  if (!root) return null;
  const containers = [root, record(root.schematic), record(root.pcb)];
  for (const container of containers) {
    if (!container) continue;
    for (const node of [container, record(container.board), record(container.boardSettings)]) {
      if (node && hasIdentity(node)) return ERROR;
    }
  }
  return null;
}
