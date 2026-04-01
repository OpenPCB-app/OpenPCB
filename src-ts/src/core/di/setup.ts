/**
 * DI Container Setup
 * Registers all services and controllers for the application
 */

import { Container, TOKENS } from "./container";
import { WorkspaceService } from "../../domain/services/workspace-service";
import { ProjectService } from "../../domain/services/project-service";
import { DesignService } from "../../domain/services/design-service";
import { ChatService } from "../../domain/services/chat-service";
import { FolderService } from "../../domain/services/folder-service";
import { FavoriteService } from "../../domain/services/favorite-service";
import { TagService } from "../../domain/services/tag-service";
import { BookmarkService } from "../../domain/services/bookmark-service";
import { BranchService } from "../../domain/services/branch-service";
import { UsageService } from "../../domain/services/usage-service";
import { getMessageService } from "../../domain/services/message-service";
import { TaskService } from "../../domain/services/task-service";
import { ProviderService } from "../../domain/services/provider-service";
import { McpService } from "../../domain/services/mcp-service";
import { StreamService } from "../../domain/services/stream-service";
import { WorkspaceController } from "../../transport/controllers/workspace-controller";
import { ProjectController } from "../../transport/controllers/project-controller";
import { DesignController } from "../../transport/controllers/design-controller";
import { ChatController } from "../../transport/controllers/chat-controller";
import { FolderController } from "../../transport/controllers/folder-controller";
import { FavoriteController } from "../../transport/controllers/favorite-controller";
import { TagController } from "../../transport/controllers/tag-controller";
import { BookmarkController } from "../../transport/controllers/bookmark-controller";
import { BranchController } from "../../transport/controllers/branch-controller";
import { UsageController } from "../../transport/controllers/usage-controller";
import { FileController } from "../../transport/controllers/file-controller";
import { MentionController } from "../../transport/controllers/mention-controller";
import { TaskController } from "../../transport/controllers/task-controller";
import { ProviderController } from "../../transport/controllers/provider-controller";
import { McpController } from "../../transport/controllers/mcp-controller";
import { StreamController } from "../../transport/controllers/stream-controller";
import { ContentEditorController } from "../../transport/controllers/content-editor-controller";
import { MessageActionController } from "../../transport/controllers/message-action-controller";
import {
  ContentEditorService,
  initializeContentTargetRegistry,
} from "../../domain/services/content-editor";
import { ToolRegistry } from "../../domain/services/tools/tool-registry";
import { ComponentValidationService } from "../../domain/services/component-validation-service";
import { PackageSwitchService } from "../../domain/services/package-switch-service";
import { ComponentImportService } from "../../domain/services/component-import-service";
import { ComponentFamilyController } from "../../transport/controllers/component-family-controller";
import { ComponentDraftController } from "../../transport/controllers/component-draft-controller";
import { ComponentImportController } from "../../transport/controllers/component-import-controller";
import { ComponentZipImportController } from "../../transport/controllers/component-zip-import-controller";
import { ComponentZipImportService } from "../../domain/services/component-zip-import-service";
import { ComponentPresetController } from "../../transport/controllers/component-preset-controller";
import { FileService } from "../../domain/services/file-service";
import { FileStorage } from "../../infrastructure/storage/file-storage";
import * as path from "path";
import type { DatabaseAccess } from "../../db";
import type { ProviderRegistry } from "../../infrastructure/ai-providers/registry";
import type { ProviderApiKeyStore } from "../../infrastructure/ai-providers/api-key-store";
import type { ProviderResolver } from "../../domain/services/provider-resolver";
import type { TaskManager } from "../../kernel/tasks/manager";
import type { TaskOrchestrator } from "../../domain/services/queue/task-orchestrator";

/**
 * Setup options for the DI container
 */
export interface DISetupOptions {
  db: DatabaseAccess;
  providerRegistry: ProviderRegistry;
  providerResolver: ProviderResolver;
  providerApiKeyStore: ProviderApiKeyStore;
  taskManager: TaskManager;
  taskOrchestrator: TaskOrchestrator;
}

/**
 * Setup the DI container with all services and controllers
 * @returns Configured Container instance
 */
export function setupDIContainer(options: DISetupOptions): Container {
  const container = new Container();

  // Register infrastructure singletons
  container.registerSingleton(TOKENS.DatabaseAccess, () => options.db);
  container.registerSingleton(
    TOKENS.ProviderRegistry,
    () => options.providerRegistry,
  );
  container.registerSingleton(
    TOKENS.ProviderResolver,
    () => options.providerResolver,
  );
  container.registerSingleton(
    TOKENS.ProviderApiKeyStore,
    () => options.providerApiKeyStore,
  );
  container.registerSingleton(TOKENS.TaskManager, () => options.taskManager);
  container.registerSingleton(
    TOKENS.TaskOrchestrator,
    () => options.taskOrchestrator,
  );

  // Register services (transient - new instance per resolve)
  container.register(
    TOKENS.WorkspaceService,
    (c) => new WorkspaceService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.ChatService,
    (c) => new ChatService(c.resolve(TOKENS.DatabaseAccess)),
  );

  // MessageService uses singleton pattern (depends on ChatManager + TaskOrchestrator)
  container.registerSingleton(TOKENS.MessageService, () => getMessageService());

  container.register(
    TOKENS.ProjectService,
    (c) => new ProjectService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.DesignService,
    (c) => new DesignService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.FolderService,
    (c) => new FolderService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.FavoriteService,
    (c) => new FavoriteService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.TagService,
    (c) => new TagService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.BookmarkService,
    (c) => new BookmarkService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.BranchService,
    (c) => new BranchService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.register(
    TOKENS.UsageService,
    (c) => new UsageService(c.resolve(TOKENS.DatabaseAccess)),
  );

  container.registerSingleton(TOKENS.FileStorage, () => {
    const basePath = path.join(
      process.env.APP_DATA_DIR || path.join(process.cwd(), "data"),
      "files",
    );
    return new FileStorage({ basePath });
  });

  container.register(
    TOKENS.FileService,
    (c) =>
      new FileService(
        c.resolve(TOKENS.DatabaseAccess),
        c.resolve(TOKENS.FileStorage),
      ),
  );

  container.register(
    TOKENS.TaskService,
    (c) => new TaskService(c.resolve(TOKENS.TaskManager)),
  );

  container.register(
    TOKENS.ProviderService,
    (c) =>
      new ProviderService(
        c.resolve(TOKENS.ProviderRegistry),
        c.resolve(TOKENS.ProviderApiKeyStore),
      ),
  );

  container.registerSingleton(
    TOKENS.McpService,
    (c) =>
      new McpService(
        c.resolve(TOKENS.DatabaseAccess),
        c.resolve(TOKENS.ToolRegistry),
      ),
  );

  // StreamService now uses TaskOrchestrator with event bridge pattern
  container.register(
    TOKENS.StreamService,
    (c) =>
      new StreamService(
        c.resolve(TOKENS.DatabaseAccess),
        c.resolve(TOKENS.TaskOrchestrator),
        c.resolve(TOKENS.ToolRegistry),
      ),
  );

  // Register controllers (transient)
  container.register(
    TOKENS.WorkspaceController,
    (c) => new WorkspaceController(c.resolve(TOKENS.WorkspaceService)),
  );

  container.register(
    TOKENS.ProjectController,
    (c) => new ProjectController(c.resolve(TOKENS.ProjectService)),
  );

  container.register(
    TOKENS.DesignController,
    (c) => new DesignController(c.resolve(TOKENS.DesignService)),
  );

  container.register(
    TOKENS.ChatController,
    (c) =>
      new ChatController(
        c.resolve(TOKENS.ChatService),
        c.resolve(TOKENS.MessageService),
      ),
  );

  container.register(
    TOKENS.TaskController,
    (c) => new TaskController(c.resolve(TOKENS.TaskService)),
  );

  container.register(
    TOKENS.ProviderController,
    (c) => new ProviderController(c.resolve(TOKENS.ProviderService)),
  );

  container.register(
    TOKENS.McpController,
    (c) => new McpController(c.resolve(TOKENS.McpService)),
  );

  container.register(
    TOKENS.StreamController,
    (c) => new StreamController(c.resolve(TOKENS.StreamService)),
  );

  container.register(
    TOKENS.FolderController,
    (c) => new FolderController(c.resolve(TOKENS.FolderService)),
  );

  container.register(
    TOKENS.FavoriteController,
    (c) => new FavoriteController(c.resolve(TOKENS.FavoriteService)),
  );

  container.register(
    TOKENS.TagController,
    (c) => new TagController(c.resolve(TOKENS.TagService)),
  );

  container.register(
    TOKENS.BookmarkController,
    (c) => new BookmarkController(c.resolve(TOKENS.BookmarkService)),
  );

  container.register(
    TOKENS.BranchController,
    (c) => new BranchController(c.resolve(TOKENS.BranchService)),
  );

  container.register(
    TOKENS.UsageController,
    (c) => new UsageController(c.resolve(TOKENS.UsageService)),
  );

  container.register(
    TOKENS.FileController,
    (c) => new FileController(c.resolve(TOKENS.FileService)),
  );

  container.register(TOKENS.MentionController, () => new MentionController());

  // Content Editor
  container.registerSingleton(TOKENS.ContentTargetRegistry, () =>
    initializeContentTargetRegistry(),
  );

  container.registerSingleton(TOKENS.ToolRegistry, () => new ToolRegistry());

  container.register(
    TOKENS.ContentEditorService,
    (c) =>
      new ContentEditorService(
        c.resolve(TOKENS.DatabaseAccess),
        c.resolve(TOKENS.ProviderRegistry),
        c.resolve(TOKENS.ContentTargetRegistry),
        c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess).contentEditSnapshots,
        c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess).contentEditLocks,
      ),
  );

  container.register(
    TOKENS.ContentEditorController,
    (c) => new ContentEditorController(c.resolve(TOKENS.ContentEditorService)),
  );

  container.register(
    TOKENS.MessageActionController,
    (c) => new MessageActionController(c.resolve(TOKENS.MessageService)),
  );

  // Component Library
  container.register(
    TOKENS.ComponentValidationService,
    () => new ComponentValidationService(),
  );

  container.register(
    TOKENS.PackageSwitchService,
    () => new PackageSwitchService(),
  );

  container.register(
    TOKENS.ComponentFamilyController,
    (c) =>
      new ComponentFamilyController(
        c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess).componentFamilies,
      ),
  );

  container.register(TOKENS.ComponentDraftController, (c) => {
    const db = c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess);
    return new ComponentDraftController(
      db.componentDrafts,
      db.componentFamilies,
      c.resolve(TOKENS.ComponentValidationService),
    );
  });

  container.register(
    TOKENS.ComponentImportService,
    () => new ComponentImportService(),
  );

  container.register(
    TOKENS.ComponentImportController,
    (c) =>
      new ComponentImportController(
        c.resolve(TOKENS.ComponentImportService),
        c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess),
      ),
  );

  container.register(
    TOKENS.ComponentZipImportController,
    (c) => {
      const db = c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess);
      const logger = db.getLogger();
      const drizzleDb = db.getDb();
      return new ComponentZipImportController(
        new ComponentZipImportService(
          db.componentImportJobs,
          db.componentFamilies,
          db.fileRecords,
          db.fileBlobs,
          drizzleDb,
          process.env.APP_DATA_DIR || ".",
        ),
      );
    },
  );

  container.register(
    TOKENS.ComponentPresetController,
    (c) =>
      new ComponentPresetController(
        c.resolve<DatabaseAccess>(TOKENS.DatabaseAccess).presetCatalogs,
      ),
  );

  console.log("[DI] Container initialized with all services and controllers");

  return container;
}
