import type { ToolExecutionContext } from "../../../../src-ts/shared/types/tool.types";

interface ActiveTargetContext {
  targetType?: unknown;
  targetId?: unknown;
}

interface KnowledgeScopeContext {
  rootPageId?: unknown;
  mentionedPageIds?: unknown;
  grantMode?: unknown;
  grantLifetime?: unknown;
}

interface ToolActiveContext {
  activeTarget?: ActiveTargetContext;
  knowledgeScope?: KnowledgeScopeContext;
}

export interface KnowledgePageScope {
  isScoped: boolean;
  rootPageId: string | null;
  mentionedPageIds: Set<string>;
}

export interface AncestorLookup {
  isAncestor(ancestorId: string, nodeId: string): Promise<boolean>;
}

function parseMentionedPageIds(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) {
    return new Set<string>();
  }

  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && item.length > 0) {
      ids.add(item);
    }
  }
  return ids;
}

export function getKnowledgePageScope(
  context?: ToolExecutionContext,
): KnowledgePageScope {
  const activeContext = context?.activeContext as ToolActiveContext | undefined;
  const knowledgeScope = activeContext?.knowledgeScope;
  const activeTarget = activeContext?.activeTarget;

  const explicitRoot =
    typeof knowledgeScope?.rootPageId === "string" &&
    knowledgeScope.rootPageId.length > 0
      ? knowledgeScope.rootPageId
      : null;
  const activeRoot =
    activeTarget?.targetType === "knowledge.page" &&
    typeof activeTarget.targetId === "string" &&
    activeTarget.targetId.length > 0
      ? activeTarget.targetId
      : null;
  const rootPageId = explicitRoot ?? activeRoot;
  const mentionedPageIds = parseMentionedPageIds(
    knowledgeScope?.mentionedPageIds,
  );

  return {
    isScoped: rootPageId !== null,
    rootPageId,
    mentionedPageIds,
  };
}

export function resolvePageIdWithScopeDefault(
  pageIdArg: unknown,
  scope: KnowledgePageScope,
): string | null {
  if (typeof pageIdArg === "string" && pageIdArg.length > 0) {
    return pageIdArg;
  }

  if (scope.isScoped && scope.rootPageId) {
    return scope.rootPageId;
  }

  return null;
}

export async function isPageAllowedByScope(
  pageId: string,
  scope: KnowledgePageScope,
  ancestry: AncestorLookup,
): Promise<boolean> {
  if (!scope.isScoped) {
    return true;
  }

  if (scope.rootPageId === pageId) {
    return true;
  }

  if (scope.mentionedPageIds.has(pageId)) {
    return true;
  }

  if (!scope.rootPageId) {
    return false;
  }

  return ancestry.isAncestor(scope.rootPageId, pageId);
}
