import { Container, TOKENS } from "./container";
import type { DatabaseAccess } from "../../db";
import { WorkspaceService } from "../../domain/services/workspace-service";
import { ProjectService } from "../../domain/services/project-service";
import { WorkspaceController } from "../../transport/controllers/workspace-controller";
import { ProjectController } from "../../transport/controllers/project-controller";

export interface DISetupOptions {
  db: DatabaseAccess;
}

/**
 * Minimal core DI graph.
 * Module-owned features (chat/mcp/oauth/bookmarks/branches) are intentionally excluded.
 */
export function setupDIContainer(options: DISetupOptions): Container {
  const container = new Container();

  container.registerSingleton(TOKENS.DatabaseAccess, () => options.db);

  container.register(TOKENS.WorkspaceService, (c) =>
    new WorkspaceService(c.resolve(TOKENS.DatabaseAccess)),
  );
  container.register(TOKENS.ProjectService, (c) =>
    new ProjectService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(TOKENS.WorkspaceController, (c) =>
    new WorkspaceController(c.resolve(TOKENS.WorkspaceService)),
  );
  container.register(TOKENS.ProjectController, (c) =>
    new ProjectController(c.resolve(TOKENS.ProjectService)),
  );

  return container;
}
