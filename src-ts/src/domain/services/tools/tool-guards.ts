import type { 
  ToolGuard, 
  ToolGuardContext, 
  GuardResult 
} from "../../../../shared/types/tool-spec.types.ts";

/** Requires workspaceId in context */
export class WorkspaceContextGuard implements ToolGuard {
  readonly type = "workspace-context";

  async validate(context: ToolGuardContext): Promise<GuardResult> {
    const { workspaceId } = context;
    
    if (typeof workspaceId === "string" && workspaceId.trim().length > 0) {
      return { pass: true };
    }

    return { 
      pass: false, 
      error: "Workspace context is required" 
    };
  }
}

/** Requires projectId in context */
export class ProjectContextGuard implements ToolGuard {
  readonly type = "project-context";

  async validate(context: ToolGuardContext): Promise<GuardResult> {
    const { projectId } = context;
    
    if (typeof projectId === "string" && projectId.trim().length > 0) {
      return { pass: true };
    }

    return { 
      pass: false, 
      error: "Project context is required" 
    };
  }
}

export class AuthGuard implements ToolGuard {
  readonly type = "auth";

  async validate(_context: ToolGuardContext): Promise<GuardResult> {
    return { pass: true };
  }
}

/** Creates WorkspaceContextGuard */
export function requireWorkspaceContext(): ToolGuard {
  return new WorkspaceContextGuard();
}

/** Creates ProjectContextGuard */
export function requireProjectContext(): ToolGuard {
  return new ProjectContextGuard();
}

/** Creates AuthGuard */
export function requireAuth(): ToolGuard {
  return new AuthGuard();
}
