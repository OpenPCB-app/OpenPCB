import { BaseHttpRouter } from "./BaseHttpRouter";
import { RouteContext } from "./route-parser";
import { errorHandlerMiddleware } from "../middleware/error-handler";
import { ResponseBuilder } from "../../core/utils/response-builder";
import type { Container } from "../../core/di/container";
import { TOKENS } from "../../core/di/container";
import type { WorkspaceController } from "../controllers/workspace-controller";
import type { ProjectController } from "../controllers/project-controller";
import type { DesignController } from "../controllers/design-controller";
import type { ChatController } from "../controllers/chat-controller";
import type { TaskController } from "../controllers/task-controller";
import type { ProviderController } from "../controllers/provider-controller";
import type { McpController } from "../controllers/mcp-controller";
import type { StreamController } from "../controllers/stream-controller";
import type { FolderController } from "../controllers/folder-controller";
import type { FavoriteController } from "../controllers/favorite-controller";
import type { TagController } from "../controllers/tag-controller";
import type { FileController } from "../controllers/file-controller";
import type { BookmarkController } from "../controllers/bookmark-controller";
import type { BranchController } from "../controllers/branch-controller";
import type { MessageActionController } from "../controllers/message-action-controller";
import type { UsageController } from "../controllers/usage-controller";
import type { MentionController } from "../controllers/mention-controller";
import type { ContentEditorController } from "../controllers/content-editor-controller";
import { DiagnosticsController } from "../controllers/diagnostics-controller";
import { LicenseController } from "../controllers/license-controller";
import type { ComponentFamilyController } from "../controllers/component-family-controller";
import type { ComponentController } from "../controllers/component-controller";
import type { ComponentImportController } from "../controllers/component-import-controller";
import type { ComponentPresetController } from "../controllers/component-preset-controller";

// Import schemas
import { z } from "../../core/schemas";
import {
  WorkspaceSchema,
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
  CreateWorkspaceInputSchema,
  UpdateWorkspaceInputSchema,
  ProjectSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  CreateProjectInputSchema,
  UpdateProjectInputSchema,
  DesignListResponseSchema,
  DesignResponseSchema,
  CreateDesignInputSchema,
  UpdateDesignInputSchema,
  ChatMetadataSchema,
  ChatListResponseSchema,
  ChatResponseSchema,
  CreateChatInputSchema,
  UpdateChatInputSchema,
  CreateMessageInputSchema,
  CreateMessageResponseSchema,
  TaskMetaSchema,
  TaskListResponseSchema,
  TaskResponseSchema,
  TaskMetaResponseSchema,
  ProviderInfoSchema,
  ProviderListResponseSchema,
  ProviderResponseSchema,
  StreamChatRequestSchema,
  StreamStartResponseSchema,
  StreamAbortResponseSchema,
  DeletedResponseSchema,
} from "../../core/schemas";

/**
 * CoreRouter - HTTP routing with DI, error handling, and OpenAPI schema metadata
 * Uses thin controllers from transport/controllers
 * Extends BaseHttpRouter for shared routing logic
 */
export class CoreRouter extends BaseHttpRouter {
  constructor(private container: Container) {
    super();
    this.registerRoutes();
  }

  /**
   * Register all routes with OpenAPI metadata
   */
  private registerRoutes(): void {
    // Resolve controllers from DI
    const workspaceController = this.container.resolve<WorkspaceController>(
      TOKENS.WorkspaceController,
    );
    const projectController = this.container.resolve<ProjectController>(
      TOKENS.ProjectController,
    );
    const designController = this.container.resolve<DesignController>(
      TOKENS.DesignController,
    );
    const chatController = this.container.resolve<ChatController>(
      TOKENS.ChatController,
    );
    const taskController = this.container.resolve<TaskController>(
      TOKENS.TaskController,
    );
    const providerController = this.container.resolve<ProviderController>(
      TOKENS.ProviderController,
    );
    const mcpController = this.container.resolve<McpController>(
      TOKENS.McpController,
    );
    const streamController = this.container.resolve<StreamController>(
      TOKENS.StreamController,
    );
    const folderController = this.container.resolve<FolderController>(
      TOKENS.FolderController,
    );
    const favoriteController = this.container.resolve<FavoriteController>(
      TOKENS.FavoriteController,
    );
    const tagController = this.container.resolve<TagController>(
      TOKENS.TagController,
    );
    const fileController = this.container.resolve<FileController>(
      TOKENS.FileController,
    );
    const bookmarkController = this.container.resolve<BookmarkController>(
      TOKENS.BookmarkController,
    );
    const branchController = this.container.resolve<BranchController>(
      TOKENS.BranchController,
    );
    const messageActionController =
      this.container.resolve<MessageActionController>(
        TOKENS.MessageActionController,
      );
    const usageController = this.container.resolve<UsageController>(
      TOKENS.UsageController,
    );
    const mentionController = this.container.resolve<MentionController>(
      TOKENS.MentionController,
    );
    const contentEditorController =
      this.container.resolve<ContentEditorController>(
        TOKENS.ContentEditorController,
      );
    const licenseController = new LicenseController();

    // =====================================================================
    // Health
    // =====================================================================
    this.get(
      "/api/health",
      async (_ctx) => {
        return ResponseBuilder.success({
          status: "ok",
          timestamp: Date.now(),
        });
      },
      {
        operationId: "healthCheck",
        tags: ["Health"],
        summary: "Health check endpoint",
        responses: {
          200: z.object({ status: z.literal("ok"), timestamp: z.number() }),
        },
      },
    );

    this.get("/api/license/status", (ctx) => licenseController.status(ctx), {
      operationId: "getLicenseStatus",
      tags: ["License"],
      summary: "Get current license status",
      responses: {
        200: z.object({
          state: z.enum(["active", "grace", "restricted", "blocked"]),
          expiresAt: z.string().nullable(),
          features: z.array(z.string()),
          reason: z.string().optional(),
        }),
      },
    });

    this.post(
      "/api/license/activate",
      (ctx) => licenseController.activate(ctx),
      {
        operationId: "activateLicense",
        tags: ["License"],
        summary: "Activate license key",
        requestBody: z.object({ key: z.string().min(1) }),
        responses: {
          200: z.object({
            success: z.boolean(),
            license: z.object({
              state: z.enum(["active", "grace", "restricted", "blocked"]),
              expiresAt: z.string().nullable(),
              features: z.array(z.string()),
              reason: z.string().optional(),
            }),
            devices: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                lastActive: z.string(),
              }),
            ),
            requiresReplacement: z.boolean(),
          }),
        },
      },
    );

    this.post(
      "/api/license/replace-device",
      (ctx) => licenseController.replaceDevice(ctx),
      {
        operationId: "replaceLicenseDevice",
        tags: ["License"],
        summary: "Replace an activated device for a license",
        requestBody: z.object({
          key: z.string().min(1),
          deviceIdToReplace: z.string().min(1),
        }),
        responses: {
          200: z.object({
            success: z.boolean(),
            license: z.object({
              state: z.enum(["active", "grace", "restricted", "blocked"]),
              expiresAt: z.string().nullable(),
              features: z.array(z.string()),
              reason: z.string().optional(),
            }),
            devices: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                lastActive: z.string(),
              }),
            ),
            requiresReplacement: z.boolean(),
          }),
        },
      },
    );

    // =====================================================================
    // Workspaces
    // =====================================================================
    this.get("/api/workspaces", (ctx) => workspaceController.list(ctx), {
      operationId: "listWorkspaces",
      tags: ["Workspaces"],
      summary: "List all workspaces",
      responses: { 200: WorkspaceListResponseSchema },
    });

    this.post("/api/workspaces", (ctx) => workspaceController.create(ctx), {
      operationId: "createWorkspace",
      tags: ["Workspaces"],
      summary: "Create a new workspace",
      requestBody: CreateWorkspaceInputSchema,
      responses: { 201: WorkspaceResponseSchema },
    });

    this.get("/api/workspaces/:id", (ctx) => workspaceController.get(ctx), {
      operationId: "getWorkspace",
      tags: ["Workspaces"],
      summary: "Get workspace by ID",
      responses: { 200: WorkspaceResponseSchema },
    });

    this.patch(
      "/api/workspaces/:id",
      (ctx) => workspaceController.update(ctx),
      {
        operationId: "updateWorkspace",
        tags: ["Workspaces"],
        summary: "Update workspace by ID",
        requestBody: UpdateWorkspaceInputSchema,
        responses: { 200: WorkspaceResponseSchema },
      },
    );

    this.delete(
      "/api/workspaces/:id",
      (ctx) => workspaceController.delete(ctx),
      {
        operationId: "deleteWorkspace",
        tags: ["Workspaces"],
        summary: "Delete workspace by ID",
        responses: { 200: DeletedResponseSchema },
      },
    );

    // =====================================================================
    // Projects
    // =====================================================================
    this.get("/api/projects", (ctx) => projectController.list(ctx), {
      operationId: "listProjects",
      tags: ["Projects"],
      summary: "List all projects",
      responses: { 200: ProjectListResponseSchema },
    });

    this.post("/api/projects", (ctx) => projectController.create(ctx), {
      operationId: "createProject",
      tags: ["Projects"],
      summary: "Create a new project",
      requestBody: CreateProjectInputSchema,
      responses: { 201: ProjectResponseSchema },
    });

    this.get("/api/projects/:id", (ctx) => projectController.get(ctx), {
      operationId: "getProject",
      tags: ["Projects"],
      summary: "Get project by ID",
      responses: { 200: ProjectResponseSchema },
    });

    this.patch("/api/projects/:id", (ctx) => projectController.update(ctx), {
      operationId: "updateProject",
      tags: ["Projects"],
      summary: "Update project by ID",
      requestBody: UpdateProjectInputSchema,
      responses: { 200: ProjectResponseSchema },
    });

    this.delete("/api/projects/:id", (ctx) => projectController.delete(ctx), {
      operationId: "deleteProject",
      tags: ["Projects"],
      summary: "Delete project by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.get(
      "/api/projects/:projectId/designs",
      (ctx) => designController.listByProject(ctx),
      {
        operationId: "listDesignsByProject",
        tags: ["Designs"],
        summary: "List designs by project ID",
        responses: { 200: DesignListResponseSchema },
      },
    );

    this.post(
      "/api/projects/:projectId/designs",
      (ctx) => designController.create(ctx),
      {
        operationId: "createDesign",
        tags: ["Designs"],
        summary: "Create a design in a project",
        requestBody: CreateDesignInputSchema.omit({
          projectId: true,
        }),
        responses: { 201: DesignResponseSchema },
      },
    );

    this.get("/api/designs", (ctx) => designController.list(ctx), {
      operationId: "listWorkspaceDesigns",
      tags: ["Designs"],
      summary: "List workspace-level designs or filter by project ID",
      responses: { 200: DesignListResponseSchema },
    });

    this.post("/api/designs", (ctx) => designController.create(ctx), {
      operationId: "createWorkspaceDesign",
      tags: ["Designs"],
      summary: "Create a workspace-level design or attach one to a project",
      requestBody: CreateDesignInputSchema,
      responses: { 201: DesignResponseSchema },
    });

    this.get("/api/designs/:id", (ctx) => designController.get(ctx), {
      operationId: "getDesign",
      tags: ["Designs"],
      summary: "Get design by ID",
      responses: { 200: DesignResponseSchema },
    });

    this.patch("/api/designs/:id", (ctx) => designController.update(ctx), {
      operationId: "updateDesign",
      tags: ["Designs"],
      summary: "Update design by ID",
      requestBody: UpdateDesignInputSchema,
      responses: { 200: DesignResponseSchema },
    });

    this.delete("/api/designs/:id", (ctx) => designController.delete(ctx), {
      operationId: "deleteDesign",
      tags: ["Designs"],
      summary: "Delete design by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.get(
      "/api/designs/:id/sheets/:sheetIndex/content",
      (ctx) => designController.getSheetContent(ctx),
      {
        operationId: "getDesignSheetContent",
        tags: ["Designs"],
        summary: "Get schematic sheet content for a design",
        responses: { 200: z.object({ sheet: z.any(), content: z.any() }) },
      },
    );

    this.put(
      "/api/designs/:id/sheets/:sheetIndex/content",
      (ctx) => designController.saveSheetContent(ctx),
      {
        operationId: "saveDesignSheetContent",
        tags: ["Designs"],
        summary: "Save schematic sheet content for a design",
        responses: { 200: z.object({ sheet: z.any() }) },
      },
    );

    // =====================================================================
    // Folders
    // =====================================================================
    this.get("/api/folders", (ctx) => folderController.list(ctx), {
      operationId: "listFolders",
      tags: ["Folders"],
      summary: "List folders by workspace or project",
      description: "Query param: workspaceId OR projectId (mutually exclusive)",
      responses: { 200: z.object({ folders: z.array(z.any()) }) },
    });

    this.post("/api/folders", (ctx) => folderController.create(ctx), {
      operationId: "createFolder",
      tags: ["Folders"],
      summary: "Create a new folder",
      requestBody: z
        .object({
          name: z.string(),
          workspaceId: z.string().optional(),
          projectId: z.string().optional(),
          sortOrder: z.number().optional(),
        })
        .refine(
          (data) =>
            (data.workspaceId && !data.projectId) ||
            (!data.workspaceId && data.projectId),
          {
            message: "Exactly one of workspaceId or projectId must be provided",
          },
        ),
      responses: { 201: z.object({ folder: z.any() }) },
    });

    this.get("/api/folders/:id", (ctx) => folderController.get(ctx), {
      operationId: "getFolder",
      tags: ["Folders"],
      summary: "Get folder by ID",
      responses: { 200: z.object({ folder: z.any() }) },
    });

    this.patch("/api/folders/:id", (ctx) => folderController.update(ctx), {
      operationId: "updateFolder",
      tags: ["Folders"],
      summary: "Update folder by ID",
      requestBody: z.object({
        name: z.string().optional(),
        sortOrder: z.number().optional(),
      }),
      responses: { 200: z.object({ folder: z.any() }) },
    });

    this.delete("/api/folders/:id", (ctx) => folderController.delete(ctx), {
      operationId: "deleteFolder",
      tags: ["Folders"],
      summary: "Delete folder by ID",
      description:
        "Query param action: move_to_root | delete_chats (required if folder has chats)",
      responses: {
        200: DeletedResponseSchema,
        409: z.object({
          error: z.literal("FOLDER_NOT_EMPTY"),
          chatCount: z.number(),
          message: z.string(),
        }),
      },
    });

    // =====================================================================
    // Favorites
    // =====================================================================
    this.get("/api/favorites", (ctx) => favoriteController.list(ctx), {
      operationId: "listFavorites",
      tags: ["Favorites"],
      summary: "List favorites by workspace",
      description: "Query param: workspaceId (required)",
      responses: { 200: z.object({ favorites: z.array(z.any()) }) },
    });

    this.post("/api/favorites", (ctx) => favoriteController.add(ctx), {
      operationId: "addFavorite",
      tags: ["Favorites"],
      summary: "Add a chat to favorites",
      requestBody: z.object({
        workspaceId: z.string(),
        chatId: z.string(),
        sortOrder: z.number().optional(),
      }),
      responses: { 201: z.object({ favorite: z.any() }) },
    });

    this.get("/api/favorites/:id", (ctx) => favoriteController.get(ctx), {
      operationId: "getFavorite",
      tags: ["Favorites"],
      summary: "Get favorite by ID",
      responses: { 200: z.object({ favorite: z.any() }) },
    });

    this.patch("/api/favorites/:id", (ctx) => favoriteController.update(ctx), {
      operationId: "updateFavorite",
      tags: ["Favorites"],
      summary: "Update favorite (sortOrder)",
      requestBody: z.object({ sortOrder: z.number() }),
      responses: { 200: z.object({ favorite: z.any() }) },
    });

    this.delete("/api/favorites/:id", (ctx) => favoriteController.delete(ctx), {
      operationId: "deleteFavorite",
      tags: ["Favorites"],
      summary: "Remove favorite by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.delete(
      "/api/favorites/chat/:chatId",
      (ctx) => favoriteController.deleteByChat(ctx),
      {
        operationId: "deleteFavoriteByChat",
        tags: ["Favorites"],
        summary: "Remove favorite by chat ID",
        responses: { 200: DeletedResponseSchema },
      },
    );

    this.get(
      "/api/favorites/status/:chatId",
      (ctx) => favoriteController.checkStatus(ctx),
      {
        operationId: "checkFavoriteStatus",
        tags: ["Favorites"],
        summary: "Check if chat is favorited",
        responses: {
          200: z.object({
            isFavorite: z.boolean(),
            favoriteId: z.string().nullable(),
          }),
        },
      },
    );

    // =====================================================================
    // Tags
    // =====================================================================
    this.get("/api/tags", (ctx) => tagController.list(ctx), {
      operationId: "listTags",
      tags: ["Tags"],
      summary: "List tags by workspace",
      description: "Query params: workspaceId (required), projectId (optional)",
      responses: { 200: z.object({ tags: z.array(z.any()) }) },
    });

    this.post("/api/tags", (ctx) => tagController.create(ctx), {
      operationId: "createTag",
      tags: ["Tags"],
      summary: "Create a new tag",
      requestBody: z.object({
        workspaceId: z.string(),
        projectId: z.string().nullable().optional(),
        name: z.string(),
        color: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
      }),
      responses: { 201: z.object({ tag: z.any() }) },
    });

    this.get("/api/tags/:id", (ctx) => tagController.get(ctx), {
      operationId: "getTag",
      tags: ["Tags"],
      summary: "Get tag by ID",
      responses: { 200: z.object({ tag: z.any() }) },
    });

    this.patch("/api/tags/:id", (ctx) => tagController.update(ctx), {
      operationId: "updateTag",
      tags: ["Tags"],
      summary: "Update tag by ID",
      requestBody: z.object({
        name: z.string().optional(),
        color: z.string().nullable().optional(),
        sortOrder: z.number().nullable().optional(),
      }),
      responses: { 200: z.object({ tag: z.any() }) },
    });

    this.delete("/api/tags/:id", (ctx) => tagController.delete(ctx), {
      operationId: "deleteTag",
      tags: ["Tags"],
      summary: "Delete tag by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.post(
      "/api/chats/:chatId/tags/:tagId",
      (ctx) => tagController.addTagToChat(ctx),
      {
        operationId: "addTagToChat",
        tags: ["Tags", "Chats"],
        summary: "Add tag to chat",
        responses: { 200: z.object({ added: z.boolean() }) },
      },
    );

    this.delete(
      "/api/chats/:chatId/tags/:tagId",
      (ctx) => tagController.removeTagFromChat(ctx),
      {
        operationId: "removeTagFromChat",
        tags: ["Tags", "Chats"],
        summary: "Remove tag from chat",
        responses: { 200: z.object({ removed: z.boolean() }) },
      },
    );

    this.get(
      "/api/chats/:chatId/tags",
      (ctx) => tagController.getChatTags(ctx),
      {
        operationId: "getChatTags",
        tags: ["Tags", "Chats"],
        summary: "Get all tags for a chat",
        responses: { 200: z.object({ tags: z.array(z.any()) }) },
      },
    );

    this.post(
      "/api/projects/:projectId/tags/:tagId",
      (ctx) => tagController.addTagToProject(ctx),
      {
        operationId: "addTagToProject",
        tags: ["Tags", "Projects"],
        summary: "Add tag to project",
        responses: { 200: z.object({ added: z.boolean() }) },
      },
    );

    this.delete(
      "/api/projects/:projectId/tags/:tagId",
      (ctx) => tagController.removeTagFromProject(ctx),
      {
        operationId: "removeTagFromProject",
        tags: ["Tags", "Projects"],
        summary: "Remove tag from project",
        responses: { 200: z.object({ removed: z.boolean() }) },
      },
    );

    this.get(
      "/api/projects/:projectId/tags",
      (ctx) => tagController.getProjectTags(ctx),
      {
        operationId: "getProjectTags",
        tags: ["Tags", "Projects"],
        summary: "Get all tags for a project",
        responses: { 200: z.object({ tags: z.array(z.any()) }) },
      },
    );

    // =====================================================================
    // Files
    // =====================================================================
    this.post("/api/files", (ctx) => fileController.upload(ctx), {
      operationId: "uploadFile",
      tags: ["Files"],
      summary: "Upload file (multipart)",
      responses: { 201: z.object({ file: z.any() }) },
    });

    this.get("/api/files", (ctx) => fileController.list(ctx), {
      operationId: "listFiles",
      tags: ["Files"],
      summary: "List files",
      responses: { 200: z.object({ files: z.array(z.any()) }) },
    });

    this.get("/api/files/:id/meta", (ctx) => fileController.getMeta(ctx), {
      operationId: "getFileMeta",
      tags: ["Files"],
      summary: "Get file metadata by ID",
      responses: { 200: z.object({ file: z.any() }) },
    });

    this.get(
      "/api/files/:id/content",
      (ctx) => fileController.getContent(ctx),
      {
        operationId: "getFileContent",
        tags: ["Files"],
        summary: "Stream file content",
        responses: { 200: z.any() },
      },
    );

    this.patch(
      "/api/files/:id/metadata",
      (ctx) => fileController.updateMetadata(ctx),
      {
        operationId: "updateFileMetadata",
        tags: ["Files"],
        summary: "Update file metadata",
        responses: { 200: z.object({ file: z.any() }) },
      },
    );

    this.delete("/api/files/:id", (ctx) => fileController.softDelete(ctx), {
      operationId: "softDeleteFile",
      tags: ["Files"],
      summary: "Soft delete file (trash)",
      responses: { 200: z.object({ file: z.any() }) },
    });

    this.post("/api/files/:id/restore", (ctx) => fileController.restore(ctx), {
      operationId: "restoreFile",
      tags: ["Files"],
      summary: "Restore trashed file",
      responses: { 200: z.object({ file: z.any() }) },
    });

    this.post(
      "/api/files/trash/empty",
      (ctx) => fileController.emptyTrash(ctx),
      {
        operationId: "emptyTrash",
        tags: ["Files"],
        summary: "Empty trash (hard delete)",
        responses: {
          200: z.object({ deletedCount: z.number(), freedBytes: z.number() }),
        },
      },
    );

    // File Versioning
    this.post(
      "/api/files/:id/versions",
      (ctx) => fileController.uploadVersion(ctx),
      {
        operationId: "uploadFileVersion",
        tags: ["Files", "Versions"],
        summary: "Upload a new version of a file",
        responses: { 201: z.object({ version: z.any(), file: z.any() }) },
      },
    );

    this.get(
      "/api/files/:id/versions",
      (ctx) => fileController.listVersions(ctx),
      {
        operationId: "listFileVersions",
        tags: ["Files", "Versions"],
        summary: "List all versions of a file",
        responses: { 200: z.object({ versions: z.array(z.any()) }) },
      },
    );

    this.get(
      "/api/files/:id/versions/:version",
      (ctx) => fileController.getVersion(ctx),
      {
        operationId: "getFileVersion",
        tags: ["Files", "Versions"],
        summary: "Get a specific version of a file",
        responses: { 200: z.object({ version: z.any() }) },
      },
    );

    this.get(
      "/api/files/:id/versions/:version/content",
      (ctx) => fileController.getVersionContent(ctx),
      {
        operationId: "getFileVersionContent",
        tags: ["Files", "Versions"],
        summary: "Stream content of a specific version",
        responses: { 200: z.any() },
      },
    );

    this.post(
      "/api/files/:id/versions/:version/restore",
      (ctx) => fileController.restoreVersion(ctx),
      {
        operationId: "restoreFileVersion",
        tags: ["Files", "Versions"],
        summary: "Restore a previous version as current",
        responses: { 200: z.object({ file: z.any() }) },
      },
    );

    this.delete(
      "/api/files/:id/versions/:version",
      (ctx) => fileController.deleteVersion(ctx),
      {
        operationId: "deleteFileVersion",
        tags: ["Files", "Versions"],
        summary: "Delete a specific version",
        responses: { 200: z.object({ deleted: z.boolean() }) },
      },
    );

    // File Processing
    this.post(
      "/api/files/:id/process",
      (ctx) => fileController.processFile(ctx),
      {
        operationId: "processFile",
        tags: ["Files", "Processing"],
        summary: "Process file (generate thumbnail, extract metadata)",
        requestBody: z
          .object({
            generateThumbnail: z.boolean().optional(),
            optimize: z.boolean().optional(),
          })
          .optional(),
        responses: {
          200: z.object({
            processed: z.boolean(),
            hasThumbnail: z.boolean(),
            metadata: z.any(),
          }),
        },
      },
    );

    this.get(
      "/api/files/:id/thumbnail",
      (ctx) => fileController.getThumbnail(ctx),
      {
        operationId: "getFileThumbnail",
        tags: ["Files", "Processing"],
        summary: "Get file thumbnail",
        responses: { 200: z.any() },
      },
    );

    // =====================================================================
    // Bookmarks
    // =====================================================================
    this.get("/api/bookmarks", (ctx) => bookmarkController.list(ctx), {
      operationId: "listBookmarks",
      tags: ["Bookmarks"],
      summary: "List bookmarks by workspace or chat",
      description: "Query params: workspaceId OR chatId (one required)",
      responses: { 200: z.object({ bookmarks: z.array(z.any()) }) },
    });

    this.post("/api/bookmarks", (ctx) => bookmarkController.create(ctx), {
      operationId: "createBookmark",
      tags: ["Bookmarks"],
      summary: "Create a new bookmark",
      requestBody: z.object({
        workspaceId: z.string(),
        messageId: z.string(),
        chatId: z.string().nullable().optional(),
        note: z.string().nullable().optional(),
      }),
      responses: { 201: z.object({ bookmark: z.any() }) },
    });

    this.get("/api/bookmarks/:id", (ctx) => bookmarkController.get(ctx), {
      operationId: "getBookmark",
      tags: ["Bookmarks"],
      summary: "Get bookmark by ID",
      responses: { 200: z.object({ bookmark: z.any() }) },
    });

    this.patch("/api/bookmarks/:id", (ctx) => bookmarkController.update(ctx), {
      operationId: "updateBookmark",
      tags: ["Bookmarks"],
      summary: "Update bookmark note",
      requestBody: z.object({
        note: z.string().nullable().optional(),
      }),
      responses: { 200: z.object({ bookmark: z.any() }) },
    });

    this.delete("/api/bookmarks/:id", (ctx) => bookmarkController.delete(ctx), {
      operationId: "deleteBookmark",
      tags: ["Bookmarks"],
      summary: "Delete bookmark by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.delete(
      "/api/bookmarks/message/:messageId",
      (ctx) => bookmarkController.deleteByMessage(ctx),
      {
        operationId: "deleteBookmarkByMessage",
        tags: ["Bookmarks"],
        summary: "Delete bookmark by message ID",
        responses: { 200: DeletedResponseSchema },
      },
    );

    this.get(
      "/api/bookmarks/status",
      (ctx) => bookmarkController.checkStatus(ctx),
      {
        operationId: "checkBookmarkStatus",
        tags: ["Bookmarks"],
        summary: "Check if message is bookmarked",
        description: "Query params: workspaceId, messageId (both required)",
        responses: {
          200: z.object({ isBookmarked: z.boolean() }),
        },
      },
    );

    // =====================================================================
    // Branches (Message Branching)
    // =====================================================================
    this.get(
      "/api/chats/:id/branches",
      (ctx) => branchController.getBranches(ctx),
      {
        operationId: "getChatBranches",
        tags: ["Branches", "Chats"],
        summary: "Get branch tree for a chat",
        responses: {
          200: z.object({
            chatId: z.string(),
            branches: z.array(z.any()),
            totalNodes: z.number(),
          }),
        },
      },
    );

    this.get(
      "/api/messages/:id/branches",
      (ctx) => branchController.getAlternateBranches(ctx),
      {
        operationId: "getMessageBranches",
        tags: ["Branches", "Messages"],
        summary: "Get alternate branches (siblings) for a message",
        responses: {
          200: z.object({
            parentMessageId: z.string().nullable(),
            branches: z.array(z.any()),
          }),
        },
      },
    );

    this.post(
      "/api/messages/:id/branch",
      (ctx) => branchController.createBranch(ctx),
      {
        operationId: "createBranch",
        tags: ["Branches", "Messages"],
        summary: "Create a new branch from a message",
        requestBody: z.object({
          content: z.any(),
          role: z.enum(["user", "assistant"]).optional(),
          provider: z.string().optional(),
          model: z.string().optional(),
        }),
        responses: {
          201: z.object({
            message: z.object({
              id: z.string(),
              chatId: z.string(),
              branchIndex: z.number(),
              depth: z.number(),
              isActive: z.boolean(),
            }),
          }),
        },
      },
    );

    this.post(
      "/api/messages/:id/activate",
      (ctx) => branchController.activateBranch(ctx),
      {
        operationId: "activateBranch",
        tags: ["Branches", "Messages"],
        summary: "Activate a branch (set as active path)",
        responses: {
          200: z.object({
            activated: z.boolean(),
            affectedMessages: z.number(),
          }),
        },
      },
    );

    this.post(
      "/api/messages/:id/archive",
      (ctx) => branchController.archiveBranch(ctx),
      {
        operationId: "archiveBranch",
        tags: ["Branches", "Messages"],
        summary: "Archive a branch (soft delete)",
        responses: {
          200: z.object({
            archived: z.boolean(),
            archivedCount: z.number(),
          }),
        },
      },
    );

    // =====================================================================
    // Message Actions (Edit, Resend, Regenerate)
    // =====================================================================
    this.post(
      "/api/messages/:id/edit",
      (ctx) => messageActionController.editMessage(ctx),
      {
        operationId: "editMessage",
        tags: ["Messages", "Actions"],
        summary: "Edit a user message (creates new branch)",
        requestBody: z.object({
          content: z.union([
            z.string(),
            z.object({
              type: z.literal("text"),
              text: z.string(),
            }),
          ]),
        }),
        responses: {
          200: z.object({
            newMessageId: z.string(),
            chatId: z.string(),
            branchIndex: z.number(),
            taskId: z.string(),
          }),
        },
      },
    );

    this.post(
      "/api/messages/:id/resend",
      (ctx) => messageActionController.resendMessage(ctx),
      {
        operationId: "resendMessage",
        tags: ["Messages", "Actions"],
        summary: "Resend a failed assistant message (retries task)",
        responses: {
          200: z.object({
            taskId: z.string(),
            messageId: z.string(),
            status: z.string(),
          }),
        },
      },
    );

    this.post(
      "/api/messages/:id/regenerate",
      (ctx) => messageActionController.regenerateMessage(ctx),
      {
        operationId: "regenerateMessage",
        tags: ["Messages", "Actions"],
        summary:
          "Regenerate an alternative assistant response (creates new branch)",
        responses: {
          200: z.object({
            newMessageId: z.string(),
            chatId: z.string(),
            branchIndex: z.number(),
            taskId: z.string(),
          }),
        },
      },
    );

    // =====================================================================
    // Chats
    // =====================================================================
    this.get("/api/chats", (ctx) => chatController.list(ctx), {
      operationId: "listChats",
      tags: ["Chats"],
      summary: "List all chats",
      responses: { 200: ChatListResponseSchema },
    });

    this.post("/api/chats", (ctx) => chatController.create(ctx), {
      operationId: "createChat",
      tags: ["Chats"],
      summary: "Create a new chat",
      requestBody: CreateChatInputSchema,
      responses: { 201: ChatResponseSchema },
    });

    this.get("/api/chats/:id", (ctx) => chatController.get(ctx), {
      operationId: "getChat",
      tags: ["Chats"],
      summary: "Get chat by ID",
      responses: { 200: ChatResponseSchema },
    });

    this.patch("/api/chats/:id", (ctx) => chatController.update(ctx), {
      operationId: "updateChat",
      tags: ["Chats"],
      summary: "Update chat by ID",
      requestBody: UpdateChatInputSchema,
      responses: { 200: ChatResponseSchema },
    });

    this.delete("/api/chats/:id", (ctx) => chatController.delete(ctx), {
      operationId: "deleteChat",
      tags: ["Chats"],
      summary: "Delete chat by ID",
      responses: { 200: DeletedResponseSchema },
    });

    this.post("/api/chats/:id/fork", (ctx) => chatController.fork(ctx), {
      operationId: "forkChat",
      tags: ["Chats"],
      summary: "Fork chat from a message",
      requestBody: z.object({ fromMessageId: z.string() }),
      responses: {
        200: z.object({
          chat: z.object({ id: z.string(), title: z.string() }),
          messageCount: z.number(),
        }),
      },
    });

    this.post(
      "/api/chats/bulk-delete",
      (ctx) => chatController.bulkDelete(ctx),
      {
        operationId: "bulkDeleteChats",
        tags: ["Chats"],
        summary: "Bulk delete chats",
        requestBody: z.object({ ids: z.array(z.string()) }),
        responses: { 200: DeletedResponseSchema },
      },
    );

    this.get(
      "/api/chats/:id/messages",
      (ctx) => chatController.getMessages(ctx),
      {
        operationId: "getChatMessages",
        tags: ["Chats"],
        summary: "Get all messages for a chat",
        responses: { 200: z.object({ messages: z.array(z.any()) }) },
      },
    );

    this.post(
      "/api/chats/:id/messages",
      (ctx) => chatController.createMessage(ctx),
      {
        operationId: "createChatMessage",
        tags: ["Chats"],
        summary: "Create user message and AI task",
        description:
          "Creates a user message and queues an AI task for response generation. See TASK_SYSTEM_SPECIFICATION.md Section 6.1",
        requestBody: CreateMessageInputSchema,
        responses: { 202: CreateMessageResponseSchema },
      },
    );

    this.get(
      "/api/messages/search",
      (ctx) => chatController.searchMessages(ctx),
      {
        operationId: "searchMessages",
        tags: ["Messages"],
        summary: "Full-text search across messages",
        responses: {
          200: z.object({ messages: z.array(z.any()), total: z.number() }),
        },
      },
    );

    // =====================================================================
    // Tasks
    // =====================================================================
    this.get("/api/tasks", (ctx) => taskController.list(ctx), {
      operationId: "listTasks",
      tags: ["Tasks"],
      summary: "List all tasks",
      responses: { 200: TaskListResponseSchema },
    });

    this.get("/api/tasks/:id", (ctx) => taskController.get(ctx), {
      operationId: "getTask",
      tags: ["Tasks"],
      summary: "Get task by ID",
      responses: { 200: TaskResponseSchema },
    });

    this.get("/api/tasks/:id/meta", (ctx) => taskController.getMeta(ctx), {
      operationId: "getTaskMeta",
      tags: ["Tasks"],
      summary: "Get task metadata",
      responses: { 200: TaskMetaResponseSchema },
    });

    this.post("/api/tasks/:id/cancel", (ctx) => taskController.cancel(ctx), {
      operationId: "cancelTask",
      tags: ["Tasks"],
      summary: "Cancel a running task",
      responses: { 200: z.object({ cancelled: z.literal(true) }) },
    });

    this.post("/api/tasks/:id/retry", (ctx) => taskController.retry(ctx), {
      operationId: "retryTask",
      tags: ["Tasks"],
      summary: "Retry a failed or paused task",
      responses: {
        200: z.object({
          taskId: z.string(),
          status: z.string(),
          retryCount: z.number(),
        }),
      },
    });

    this.post("/api/tasks/cleanup", (ctx) => taskController.cleanup(ctx), {
      operationId: "cleanupTasks",
      tags: ["Tasks"],
      summary: "Cleanup completed tasks",
      responses: { 200: z.object({ cleaned: z.boolean() }) },
    });

    // =====================================================================
    // Providers
    // =====================================================================
    this.get("/api/providers", (ctx) => providerController.list(ctx), {
      operationId: "listProviders",
      tags: ["Providers"],
      summary: "List all AI providers",
      responses: { 200: ProviderListResponseSchema },
    });

    this.get("/api/providers/:id", (ctx) => providerController.get(ctx), {
      operationId: "getProvider",
      tags: ["Providers"],
      summary: "Get provider with models",
      responses: { 200: ProviderResponseSchema },
    });

    this.get(
      "/api/providers/:id/health",
      (ctx) => providerController.health(ctx),
      {
        operationId: "getProviderHealth",
        tags: ["Providers"],
        summary: "Check provider health/availability",
        responses: {
          200: z.object({
            provider: z.string(),
            available: z.boolean(),
            error: z.string().optional(),
          }),
        },
      },
    );

    this.get(
      "/api/providers/:id/loaded",
      (ctx) => providerController.loaded(ctx),
      {
        operationId: "getProviderLoadedModels",
        tags: ["Providers"],
        summary: "List loaded models for a provider",
        responses: {
          200: z.object({ provider: z.string(), models: z.array(z.any()) }),
        },
      },
    );

    this.get(
      "/api/favorites/status",
      (ctx) => favoriteController.checkStatus(ctx),
      {
        operationId: "checkFavoriteStatus",
        tags: ["Favorites"],
        summary: "Check if chat is favorited",
        description: "Query params: workspaceId, chatId (both required)",
        responses: {
          200: z.object({ isFavorite: z.boolean() }),
        },
      },
    );

    this.post(
      "/api/providers/:id/api-key",
      (ctx) => providerController.setApiKey(ctx),
      {
        operationId: "setProviderApiKey",
        tags: ["Providers"],
        summary: "Set provider API key",
        requestBody: z.object({ apiKey: z.string().min(1) }),
        responses: {
          200: z.object({ provider: z.string(), updated: z.boolean() }),
        },
      },
    );

    this.get(
      "/api/providers/:id/api-key",
      (ctx) => providerController.getApiKeyStatus(ctx),
      {
        operationId: "getProviderApiKeyStatus",
        tags: ["Providers"],
        summary: "Check if provider API key is stored",
        responses: {
          200: z.object({ provider: z.string(), stored: z.boolean() }),
        },
      },
    );

    this.delete(
      "/api/providers/:id/api-key",
      (ctx) => providerController.removeApiKey(ctx),
      {
        operationId: "removeProviderApiKey",
        tags: ["Providers"],
        summary: "Remove provider API key",
        responses: {
          200: z.object({ provider: z.string(), removed: z.boolean() }),
        },
      },
    );

    this.get("/api/mcp/servers", (ctx) => mcpController.listServers(ctx), {
      operationId: "listMcpServers",
      tags: ["MCP"],
      summary: "List MCP servers",
      responses: { 200: z.object({ servers: z.array(z.any()) }) },
    });

    this.post("/api/mcp/servers", (ctx) => mcpController.createServer(ctx), {
      operationId: "createMcpServer",
      tags: ["MCP"],
      summary: "Create MCP server",
      requestBody: z.object({
        alias: z.string(),
        displayName: z.string().nullable().optional(),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().optional(),
        headers: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().optional(),
      }),
      responses: { 201: z.object({ server: z.any() }) },
    });

    this.get("/api/mcp/servers/:id", (ctx) => mcpController.getServer(ctx), {
      operationId: "getMcpServer",
      tags: ["MCP"],
      summary: "Get MCP server",
      responses: { 200: z.object({ server: z.any() }) },
    });

    this.patch(
      "/api/mcp/servers/:id",
      (ctx) => mcpController.updateServer(ctx),
      {
        operationId: "updateMcpServer",
        tags: ["MCP"],
        summary: "Update MCP server",
        requestBody: z.object({
          alias: z.string().optional(),
          displayName: z.string().nullable().optional(),
          transport: z.enum(["stdio", "http"]).optional(),
          command: z.string().nullable().optional(),
          args: z.array(z.string()).nullable().optional(),
          env: z.record(z.string(), z.string()).nullable().optional(),
          url: z.string().nullable().optional(),
          headers: z.record(z.string(), z.string()).nullable().optional(),
          enabled: z.boolean().optional(),
        }),
        responses: { 200: z.object({ server: z.any() }) },
      },
    );

    this.delete(
      "/api/mcp/servers/:id",
      (ctx) => mcpController.deleteServer(ctx),
      {
        operationId: "deleteMcpServer",
        tags: ["MCP"],
        summary: "Delete MCP server",
        responses: { 200: z.object({ deleted: z.boolean() }) },
      },
    );

    this.post(
      "/api/mcp/servers/:id/connect",
      (ctx) => mcpController.connectServer(ctx),
      {
        operationId: "connectMcpServer",
        tags: ["MCP"],
        summary: "Connect MCP server",
        responses: {
          200: z.object({
            serverId: z.string(),
            connected: z.literal(true),
            toolCount: z.number(),
          }),
        },
      },
    );

    this.post(
      "/api/mcp/servers/:id/disconnect",
      (ctx) => mcpController.disconnectServer(ctx),
      {
        operationId: "disconnectMcpServer",
        tags: ["MCP"],
        summary: "Disconnect MCP server",
        responses: {
          200: z.object({
            serverId: z.string(),
            disconnected: z.literal(true),
          }),
        },
      },
    );

    this.get(
      "/api/mcp/servers/:id/tools",
      (ctx) => mcpController.listTools(ctx),
      {
        operationId: "listMcpServerTools",
        tags: ["MCP"],
        summary: "List MCP server tools",
        responses: { 200: z.object({ tools: z.array(z.any()) }) },
      },
    );

    this.post(
      "/api/mcp/servers/:id/test-call",
      (ctx) => mcpController.testCall(ctx),
      {
        operationId: "testMcpToolCall",
        tags: ["MCP"],
        summary: "Test-call an MCP tool",
        requestBody: z.object({
          toolName: z.string(),
          args: z.record(z.string(), z.unknown()).optional(),
        }),
        responses: { 200: z.object({ result: z.any() }) },
      },
    );

    // OAuth routes
    this.post(
      "/api/oauth/:provider/start",
      async (ctx) => {
        const { OAuthController } = await import(
          "../controllers/oauth-controller"
        );
        const { OAuthService } = await import(
          "../../infrastructure/oauth/oauth-service"
        );
        const { ProviderOAuthRepository } = await import(
          "../../db/repositories/provider-oauth"
        );
        const { QueryLogger } = await import("../../db/query-logger");
        const { getDb } = await import("../../db");
        const oauthRepository = new ProviderOAuthRepository(
          getDb(),
          new QueryLogger(),
        );
        const oauthService = new OAuthService(oauthRepository);
        const oauthController = new OAuthController(oauthService);
        return oauthController.start(ctx);
      },
      {
        operationId: "startOAuthFlow",
        tags: ["OAuth"],
        summary: "Start OAuth flow for provider",
        description:
          "Initiates OAuth flow (PKCE for Codex, Device Code for GitHub Copilot)",
        requestBody: z.object({ projectId: z.string().optional() }).optional(),
        responses: {
          200: z.object({
            success: z.boolean(),
            provider: z.string(),
            url: z.string().optional(),
            verifier: z.string().optional(),
            state: z.string().optional(),
            redirectUri: z.string().optional(),
            deviceCode: z.string().optional(),
            userCode: z.string().optional(),
            verificationUri: z.string().optional(),
            interval: z.number().optional(),
            expiresIn: z.number().optional(),
          }),
        },
      },
    );

    this.get(
      "/api/oauth/:provider/callback",
      async (ctx) => {
        const { OAuthController } = await import(
          "../controllers/oauth-controller"
        );
        const { OAuthService } = await import(
          "../../infrastructure/oauth/oauth-service"
        );
        const { ProviderOAuthRepository } = await import(
          "../../db/repositories/provider-oauth"
        );
        const { QueryLogger } = await import("../../db/query-logger");
        const { getDb } = await import("../../db");
        const oauthRepository = new ProviderOAuthRepository(
          getDb(),
          new QueryLogger(),
        );
        const oauthService = new OAuthService(oauthRepository);
        const oauthController = new OAuthController(oauthService);
        return oauthController.callback(ctx);
      },
      {
        operationId: "oauthCallback",
        tags: ["OAuth"],
        summary: "OAuth callback endpoint (Codex)",
        description:
          "Public callback for Codex PKCE flow - use /complete endpoint instead",
        responses: {
          200: z.object({
            message: z.string(),
            code: z.string(),
            state: z.string(),
            nextStep: z.string(),
          }),
        },
      },
    );

    this.post(
      "/api/oauth/:provider/complete",
      async (ctx) => {
        const { OAuthController } = await import(
          "../controllers/oauth-controller"
        );
        const { OAuthService } = await import(
          "../../infrastructure/oauth/oauth-service"
        );
        const { ProviderOAuthRepository } = await import(
          "../../db/repositories/provider-oauth"
        );
        const { QueryLogger } = await import("../../db/query-logger");
        const { getDb } = await import("../../db");
        const oauthRepository = new ProviderOAuthRepository(
          getDb(),
          new QueryLogger(),
        );
        const oauthService = new OAuthService(oauthRepository);
        const oauthController = new OAuthController(oauthService);
        return oauthController.complete(ctx);
      },
      {
        operationId: "completeOAuthFlow",
        tags: ["OAuth"],
        summary: "Complete OAuth flow",
        description:
          "Finalize OAuth (Codex: PKCE token exchange, GitHub: Device code polling)",
        requestBody: z.union([
          z.object({
            code: z.string(),
            state: z.string(),
            verifier: z.string(),
            redirectUri: z.string(),
          }),
          z.object({
            deviceCode: z.string(),
            interval: z.number(),
          }),
        ]),
        responses: {
          200: z.object({
            provider: z.string(),
            success: z.boolean(),
          }),
        },
      },
    );

    this.get(
      "/api/oauth/:provider/status",
      async (ctx) => {
        const { OAuthController } = await import(
          "../controllers/oauth-controller"
        );
        const { OAuthService } = await import(
          "../../infrastructure/oauth/oauth-service"
        );
        const { ProviderOAuthRepository } = await import(
          "../../db/repositories/provider-oauth"
        );
        const { QueryLogger } = await import("../../db/query-logger");
        const { getDb } = await import("../../db");
        const oauthRepository = new ProviderOAuthRepository(
          getDb(),
          new QueryLogger(),
        );
        const oauthService = new OAuthService(oauthRepository);
        const oauthController = new OAuthController(oauthService);
        return oauthController.status(ctx);
      },
      {
        operationId: "getOAuthStatus",
        tags: ["OAuth"],
        summary: "Get OAuth status for provider",
        description:
          "Check if provider has OAuth credentials and expiry status (read-only, no refresh)",
        responses: {
          200: z.object({
            provider: z.string(),
            hasCredentials: z.boolean(),
            isExpired: z.boolean(),
          }),
        },
      },
    );

    this.delete(
      "/api/oauth/:provider",
      async (ctx) => {
        const { OAuthController } = await import(
          "../controllers/oauth-controller"
        );
        const { OAuthService } = await import(
          "../../infrastructure/oauth/oauth-service"
        );
        const { ProviderOAuthRepository } = await import(
          "../../db/repositories/provider-oauth"
        );
        const { QueryLogger } = await import("../../db/query-logger");
        const { getDb } = await import("../../db");
        const oauthRepository = new ProviderOAuthRepository(
          getDb(),
          new QueryLogger(),
        );
        const oauthService = new OAuthService(oauthRepository);
        const oauthController = new OAuthController(oauthService);
        return oauthController.revoke(ctx);
      },
      {
        operationId: "revokeOAuth",
        tags: ["OAuth"],
        summary: "Revoke OAuth credentials",
        description: "Delete stored OAuth credentials for provider",
        responses: {
          200: z.object({
            provider: z.string(),
            success: z.boolean(),
          }),
        },
      },
    );

    // =====================================================================
    // Stream
    // =====================================================================
    this.post("/api/stream/chat", (ctx) => streamController.chat(ctx), {
      operationId: "streamChat",
      tags: ["Stream"],
      summary: "Start a chat stream",
      requestBody: StreamChatRequestSchema,
      responses: { 200: StreamStartResponseSchema },
    });

    this.post(
      "/api/stream/abort/:taskId",
      (ctx) => streamController.abort(ctx),
      {
        operationId: "abortStream",
        tags: ["Stream"],
        summary: "Abort a running stream",
        responses: { 200: StreamAbortResponseSchema },
      },
    );

    this.get(
      "/api/stream/replay/:taskId",
      (ctx) => streamController.replay(ctx),
      {
        operationId: "replayStream",
        tags: ["Stream"],
        summary: "Replay task progress for reconnection",
        responses: { 200: z.object({ stream: z.any() }) },
      },
    );

    this.get(
      "/api/chats/:id/active-task",
      (ctx) => streamController.getActiveTask(ctx),
      {
        operationId: "getChatActiveTask",
        tags: ["Chats", "Stream"],
        summary: "Check if chat has active (running) task",
        description:
          "Returns active task info if chat has a running/queued task, 204 if no active task",
        responses: {
          200: z.object({
            taskId: z.string(),
            status: z.string(),
            provider: z.string(),
            model: z.string(),
            createdAt: z.string(),
            assistantMessageId: z.string().nullable().optional(),
            waitReason: z.string().nullable().optional(),
            resumeEligible: z.boolean(),
          }),
          204: z.null(),
        },
      },
    );

    // =====================================================================
    // Usage & Budgets
    // =====================================================================
    this.get("/api/usage", (ctx) => usageController.list(ctx), {
      operationId: "listUsageRecords",
      tags: ["Usage"],
      summary: "List usage records",
      description:
        "Query params: workspaceId (required), projectId, chatId, provider, model, startDate, endDate, limit, offset",
      responses: { 200: z.object({ records: z.array(z.any()) }) },
    });

    this.get("/api/usage/summary", (ctx) => usageController.getSummary(ctx), {
      operationId: "getUsageSummary",
      tags: ["Usage"],
      summary: "Get usage summary for workspace",
      description:
        "Query params: workspaceId (required), period (day|week|month|all)",
      responses: { 200: z.object({ summary: z.any() }) },
    });

    this.get("/api/budgets", (ctx) => usageController.listBudgets(ctx), {
      operationId: "listBudgets",
      tags: ["Budgets"],
      summary: "Get active budget for workspace",
      description: "Query params: workspaceId (required)",
      responses: { 200: z.object({ budget: z.any().nullable() }) },
    });

    this.post("/api/budgets", (ctx) => usageController.createBudget(ctx), {
      operationId: "createBudget",
      tags: ["Budgets"],
      summary: "Create a new budget",
      requestBody: z.object({
        workspaceId: z.string(),
        projectId: z.string().optional(),
        limitCents: z.number().positive(),
        warnAtPercent: z.number().min(0).max(100).optional(),
        period: z.enum(["daily", "weekly", "monthly"]).optional(),
        actionOnLimit: z.enum(["warn", "block", "notify"]).optional(),
      }),
      responses: { 201: z.object({ budget: z.any() }) },
    });

    this.patch("/api/budgets/:id", (ctx) => usageController.updateBudget(ctx), {
      operationId: "updateBudget",
      tags: ["Budgets"],
      summary: "Update budget",
      requestBody: z.object({
        limitCents: z.number().positive().optional(),
        warnAtPercent: z.number().min(0).max(100).optional(),
        period: z.enum(["daily", "weekly", "monthly"]).optional(),
        actionOnLimit: z.enum(["warn", "block", "notify"]).optional(),
        isActive: z.boolean().optional(),
      }),
      responses: { 200: z.object({ budget: z.any() }) },
    });

    this.delete(
      "/api/budgets/:id",
      (ctx) => usageController.deleteBudget(ctx),
      {
        operationId: "deleteBudget",
        tags: ["Budgets"],
        summary: "Delete budget",
        responses: { 200: DeletedResponseSchema },
      },
    );

    this.get(
      "/api/budgets/status",
      (ctx) => usageController.getBudgetStatus(ctx),
      {
        operationId: "getBudgetStatus",
        tags: ["Budgets"],
        summary: "Get current budget status with usage percentage",
        description: "Query params: workspaceId (required)",
        responses: { 200: z.object({ status: z.any().nullable() }) },
      },
    );

    // =====================================================================
    // Mentions
    // =====================================================================
    this.post("/api/mentions/search", (ctx) => mentionController.search(ctx), {
      operationId: "searchMentions",
      tags: ["Mentions"],
      summary: "Search for mentionable entities",
      requestBody: z.object({
        query: z.string(),
        workspaceId: z.string(),
        chatId: z.string(),
        limit: z.number().optional(),
        entityTypes: z.array(z.string()).optional(),
        filters: z.record(z.string(), z.unknown()).optional(),
      }),
      responses: {
        200: z.object({
          results: z.array(z.any()),
          hasMore: z.boolean(),
        }),
      },
    });

    this.get(
      "/api/mentions/resolve/:entityType/:entityId",
      (ctx) => mentionController.resolve(ctx),
      {
        operationId: "resolveMention",
        tags: ["Mentions"],
        summary: "Resolve a single mention entity",
        description: "Query param: workspaceId (required)",
        responses: { 200: z.object({ entity: z.any() }) },
      },
    );

    this.post(
      "/api/mentions/staleness",
      (ctx) => mentionController.checkStaleness(ctx),
      {
        operationId: "checkMentionStaleness",
        tags: ["Mentions"],
        summary: "Batch check staleness of mentions",
        requestBody: z.object({
          mentions: z.array(
            z.object({
              entityType: z.string(),
              entityId: z.string(),
              snapshotCreatedAt: z.string(),
            }),
          ),
        }),
        responses: {
          200: z.object({ results: z.record(z.string(), z.any()) }),
        },
      },
    );

    this.get("/api/mentions/types", (ctx) => mentionController.getTypes(ctx), {
      operationId: "getMentionTypes",
      tags: ["Mentions"],
      summary: "Get available mention entity types",
      responses: { 200: z.object({ types: z.array(z.string()) }) },
    });

    this.get(
      "/api/mentions/navigate/:entityType/:entityId",
      (ctx) => mentionController.getNavigationPath(ctx),
      {
        operationId: "getMentionNavigationPath",
        tags: ["Mentions"],
        summary: "Get navigation path for a mention entity",
        responses: { 200: z.object({ path: z.string().nullable() }) },
      },
    );

    // =====================================================================
    // Content Editor
    // =====================================================================
    this.post(
      "/api/content-editor/stream",
      (ctx) => contentEditorController.stream(ctx),
      {
        operationId: "streamContentEdit",
        tags: ["ContentEditor"],
        summary: "Start streaming content edit",
        description: "AI-powered content editing with SSE streaming",
        requestBody: z.object({
          target: z.object({
            targetType: z.string(),
            targetId: z.string(),
          }),
          mode: z.enum(["replace", "append", "selection", "generate"]),
          instruction: z.string(),
          selection: z
            .object({
              type: z.literal("tiptap"),
              from: z.number(),
              to: z.number(),
              selectedText: z.string().optional(),
            })
            .optional(),
          provider: z.string(),
          model: z.string(),
          workspaceId: z.string(),
          projectId: z.string().optional(),
          systemPrompt: z.string().optional(),
          temperature: z.number().optional(),
          maxTokens: z.number().optional(),
        }),
        responses: {
          200: z.any(), // SSE stream
        },
      },
    );

    this.post(
      "/api/content-editor/rollback/:editId",
      (ctx) => contentEditorController.rollback(ctx),
      {
        operationId: "rollbackContentEdit",
        tags: ["ContentEditor"],
        summary: "Rollback an edit to its snapshot",
        responses: {
          200: z.object({
            editId: z.string(),
            rolledBack: z.boolean(),
          }),
        },
      },
    );

    this.post(
      "/api/content-editor/cancel/:editId",
      (ctx) => contentEditorController.cancel(ctx),
      {
        operationId: "cancelContentEdit",
        tags: ["ContentEditor"],
        summary: "Cancel an in-progress edit",
        responses: {
          200: z.object({
            editId: z.string(),
            rolledBack: z.boolean(),
            partialContent: z.string().optional(),
          }),
        },
      },
    );

    this.post(
      "/api/content-editor/tool-call",
      (ctx) => contentEditorController.toolCall(ctx),
      {
        operationId: "handleContentEditorToolCall",
        tags: ["ContentEditor"],
        summary: "Handle a content editor tool call",
        requestBody: z.object({
          toolCall: z.any(),
          activeContext: z.any(),
          provider: z.string(),
          model: z.string(),
        }),
        responses: {
          200: z.any(),
        },
      },
    );

    this.get(
      "/api/content-editor/targets",
      (ctx) => contentEditorController.getTargets(ctx),
      {
        operationId: "getContentEditorTargets",
        tags: ["ContentEditor"],
        summary: "List registered content targets",
        responses: {
          200: z.object({
            targets: z.array(
              z.object({
                targetType: z.string(),
                label: z.string(),
                description: z.string().optional(),
                supportedModes: z.array(
                  z.enum(["replace", "append", "selection", "generate"]),
                ),
              }),
            ),
          }),
        },
      },
    );

    this.get(
      "/api/content-editor/history",
      (ctx) => contentEditorController.getHistory(ctx),
      {
        operationId: "getContentEditHistory",
        tags: ["ContentEditor"],
        summary: "Get edit history for a target",
        description: "Query params: targetType, targetId, limit",
        responses: {
          200: z.object({
            history: z.array(
              z.object({
                editId: z.string(),
                mode: z.string(),
                instruction: z.string(),
                status: z.string(),
                createdAt: z.date(),
              }),
            ),
          }),
        },
      },
    );

    // =====================================================================
    // Component Library
    // =====================================================================
    const componentFamilyController =
      this.container.resolve<ComponentFamilyController>(
        TOKENS.ComponentFamilyController,
      );
    const componentController = this.container.resolve<ComponentController>(
      TOKENS.ComponentController,
    );
    const componentImportController =
      this.container.resolve<ComponentImportController>(
        TOKENS.ComponentImportController,
      );
    const componentPresetController =
      this.container.resolve<ComponentPresetController>(
        TOKENS.ComponentPresetController,
      );

    this.get(
      "/api/components/families",
      (ctx) => componentFamilyController.list(ctx),
      {
        operationId: "listComponentFamilies",
        tags: ["Components"],
        summary: "List component families",
        queryParams: z.object({
          scope: z.string().optional(),
          categoryPath: z.string().optional(),
          tags: z.string().optional(),
          mountType: z.string().optional(),
          search: z.string().optional(),
        }),
        responses: { 200: z.object({ families: z.array(z.any()) }) },
      },
    );

    this.get(
      "/api/components/families/:id",
      (ctx) => componentFamilyController.get(ctx),
      {
        operationId: "getComponentFamily",
        tags: ["Components"],
        summary: "Get component family by ID with variants",
        responses: { 200: z.object({ family: z.any() }) },
      },
    );

    this.get(
      "/api/components/families/:id/full",
      (ctx) => componentFamilyController.getFull(ctx),
      {
        operationId: "getComponentFamilyFull",
        tags: ["Components"],
        summary: "Get complete component family aggregate with all nested data",
        responses: {
          200: z.object({
            family: z.any(),
            variants: z.array(z.any()),
            footprints: z.array(z.any()),
            models: z.array(z.any()),
            offerings: z.array(z.any()),
          }),
        },
      },
    );

    this.get(
      "/api/components/categories",
      (ctx) => componentFamilyController.getCategories(ctx),
      {
        operationId: "getComponentCategories",
        tags: ["Components"],
        summary:
          "Get category tree derived from component family category paths",
        responses: {
          200: z.object({
            categories: z.array(
              z.object({
                path: z.string(),
                label: z.string(),
                count: z.number(),
                children: z.array(z.any()),
              }),
            ),
          }),
        },
      },
    );

    this.patch(
      "/api/components/families/:id",
      (ctx) => componentFamilyController.update(ctx),
      {
        operationId: "updateComponentFamily",
        tags: ["Components"],
        summary: "Update component family metadata",
        requestBody: z.object({
          displayLabel: z.string().optional(),
          description: z.string().optional(),
          categoryPath: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
        responses: {
          200: z.object({ family: z.any() }),
          403: z.object({
            code: z.string(),
            message: z.string(),
          }),
        },
      },
    );

    this.delete(
      "/api/components/families/:id",
      (ctx) => componentFamilyController.delete(ctx),
      {
        operationId: "deleteComponentFamily",
        tags: ["Components"],
        summary: "Delete component family (soft delete)",
        responses: {
          200: z.object({ deleted: z.boolean() }),
          403: z.object({
            code: z.string(),
            message: z.string(),
          }),
        },
      },
    );

    this.post(
      "/api/components/families/bulk-delete",
      (ctx) => componentFamilyController.bulkDelete(ctx),
      {
        operationId: "bulkDeleteComponentFamilies",
        tags: ["Components"],
        summary: "Bulk delete component families",
        requestBody: z.object({
          ids: z.array(z.string()),
        }),
        responses: {
          200: z.object({
            deleted: z.boolean(),
            deletedCount: z.number(),
            skippedCount: z.number(),
          }),
        },
      },
    );

    this.post(
      "/api/components",
      (ctx) => componentController.createComponent(ctx),
      {
        operationId: "createComponent",
        tags: ["Components"],
        summary: "Create a component",
        requestBody: z.any(),
        responses: { 201: z.object({ component: z.any() }) },
      },
    );

    this.get(
      "/api/components",
      (ctx) => componentController.listComponents(ctx),
      {
        operationId: "listComponents",
        tags: ["Components"],
        summary: "List workspace components",
        responses: { 200: z.object({ components: z.array(z.any()) }) },
      },
    );

    this.get(
      "/api/components/:id",
      (ctx) => componentController.getComponent(ctx),
      {
        operationId: "getComponent",
        tags: ["Components"],
        summary: "Get component with variants",
        responses: { 200: z.object({ component: z.any() }) },
      },
    );

    this.patch(
      "/api/components/:id",
      (ctx) => componentController.updateComponent(ctx),
      {
        operationId: "updateComponent",
        tags: ["Components"],
        summary: "Update component metadata",
        requestBody: z.any(),
        responses: {
          200: z.object({ component: z.any() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.delete(
      "/api/components/:id",
      (ctx) => componentController.deleteComponent(ctx),
      {
        operationId: "deleteComponent",
        tags: ["Components"],
        summary: "Delete component if unused",
        responses: {
          200: z.object({ deleted: z.boolean() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.post(
      "/api/components/:id/variants",
      (ctx) => componentController.addVariant(ctx),
      {
        operationId: "addComponentVariant",
        tags: ["Components"],
        summary: "Add variant to component",
        requestBody: z.any(),
        responses: {
          201: z.object({ variant: z.any() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.patch(
      "/api/components/:id/variants/:variantId",
      (ctx) => componentController.updateVariant(ctx),
      {
        operationId: "updateComponentVariant",
        tags: ["Components"],
        summary: "Update component variant",
        requestBody: z.any(),
        responses: {
          200: z.object({ variant: z.any() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.delete(
      "/api/components/:id/variants/:variantId",
      (ctx) => componentController.removeVariant(ctx),
      {
        operationId: "removeComponentVariant",
        tags: ["Components"],
        summary: "Remove component variant",
        responses: {
          200: z.object({ deleted: z.boolean() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.patch(
      "/api/components/:id/default-variant",
      (ctx) => componentController.setDefaultVariant(ctx),
      {
        operationId: "setDefaultComponentVariant",
        tags: ["Components"],
        summary: "Set default component variant",
        requestBody: z.object({ variantId: z.string() }),
        responses: {
          200: z.object({ component: z.any() }),
          400: z.object({ code: z.string(), message: z.string() }),
          404: z.object({ code: z.string(), message: z.string() }),
          409: z.object({ code: z.string(), message: z.string(), details: z.any() }),
        },
      },
    );

    this.post(
      "/api/components/import/parse-symbol",
      (ctx) => componentImportController.parseSymbol(ctx),
      {
        operationId: "parseKicadSymbol",
        tags: ["Components"],
        summary: "Parse KiCAD symbol file for wizard import",
        requestBody: z.object({
          content: z.string(),
          fileName: z.string().optional(),
        }),
        responses: {
          200: z.object({
            symbol: z.any(),
            availableSymbols: z.array(z.string()),
            fileName: z.string().nullable(),
          }),
          400: z.object({ code: z.string(), message: z.string() }),
        },
      },
    );

    this.post(
      "/api/components/import/parse-footprint",
      (ctx) => componentImportController.parseFootprint(ctx),
      {
        operationId: "parseKicadFootprint",
        tags: ["Components"],
        summary: "Parse KiCAD footprint file for wizard import",
        requestBody: z.object({
          content: z.string(),
          fileName: z.string().optional(),
        }),
        responses: {
          200: z.object({
            footprint: z.any(),
            fileName: z.string().nullable(),
          }),
          400: z.object({ code: z.string(), message: z.string() }),
        },
      },
    );

    this.post(
      "/api/components/import",
      (ctx) => componentImportController.importComponents(ctx),
      {
        operationId: "importComponents",
        tags: ["Components"],
        summary: "Import KiCad components into the canonical library",
        requestBody: z.any(),
        responses: {
          201: z.object({
            import: z.any(),
            message: z.string(),
          }),
          400: z.object({ code: z.string(), message: z.string() }),
          500: z.object({ code: z.string(), message: z.string() }),
        },
      },
    );

    this.get(
      "/api/components/presets",
      (ctx) => componentPresetController.list(ctx),
      {
        operationId: "listComponentPresets",
        tags: ["Components"],
        summary: "List preset catalogs with variants",
        queryParams: z.object({ scope: z.string().optional() }),
        responses: { 200: z.object({ presets: z.array(z.any()) }) },
      },
    );

    this.post(
      "/api/components/presets/:id/duplicate",
      (ctx) => componentPresetController.duplicate(ctx),
      {
        operationId: "duplicateComponentPreset",
        tags: ["Components"],
        summary: "Duplicate a preset catalog to workspace scope",
        requestBody: z.object({ name: z.string().optional() }),
        responses: { 201: z.object({ catalog: z.any() }) },
      },
    );

    this.post(
      "/api/components/instances/switch-preview",
      async (_ctx) => {
        return ResponseBuilder.error(
          "NOT_IMPLEMENTED",
          "Switch preview not yet wired",
          501,
        );
      },
      {
        operationId: "previewComponentSwitch",
        tags: ["Components"],
        summary: "Preview package variant switch (stub)",
        responses: { 501: z.object({ code: z.string(), message: z.string() }) },
      },
    );

    // =====================================================================
    // Diagnostics & Logs (for debugging and feedback)
    // =====================================================================
    const diagnosticsController = new DiagnosticsController();

    this.get(
      "/api/logs",
      async (ctx) => {
        const query = ctx.query as {
          minutes?: string;
          count?: string;
          level?: string | string[];
        };
        const result = await diagnosticsController.getLogs({
          minutes: query.minutes ? parseInt(query.minutes, 10) : undefined,
          count: query.count ? parseInt(query.count, 10) : undefined,
          level: query.level,
        });
        return ResponseBuilder.success(result);
      },
      {
        operationId: "getLogs",
        tags: ["Diagnostics"],
        summary: "Get recent backend logs",
        description:
          "Query params: minutes (default 5), count, level (log|info|warn|error|debug)",
        responses: {
          200: z.object({
            logs: z.array(z.any()),
            count: z.number(),
            timeRange: z.object({ from: z.string(), to: z.string() }),
          }),
        },
      },
    );

    this.get(
      "/api/diagnostics",
      async () => {
        const result = await diagnosticsController.getDiagnostics();
        return ResponseBuilder.success(result);
      },
      {
        operationId: "getDiagnostics",
        tags: ["Diagnostics"],
        summary: "Get system diagnostics snapshot",
        description: "Returns logs, database metrics, and telemetry",
        responses: {
          200: z.object({
            logs: z.any(),
            database: z.any(),
            metrics: z.any(),
            timestamp: z.string(),
          }),
        },
      },
    );

    this.get(
      "/api/logs/text",
      async (ctx) => {
        const query = ctx.query as { minutes?: string };
        const text = await diagnosticsController.getLogsAsText({
          minutes: query.minutes ? parseInt(query.minutes, 10) : undefined,
        });
        return new Response(text, {
          headers: { "Content-Type": "text/plain" },
        });
      },
      {
        operationId: "getLogsAsText",
        tags: ["Diagnostics"],
        summary: "Get logs as plain text",
        description: "Query params: minutes (default 5)",
        responses: { 200: z.string() },
      },
    );
  }

  /**
   * Handle HTTP request
   * Overrides base class to add error handling middleware
   */
  async handle(req: Request): Promise<Response> {
    const ctx = this.buildContext(req);
    const collapsedPath = ctx.url.pathname.replace(/\/{2,}/g, "/");
    const normalizedPath =
      collapsedPath.length > 1 && collapsedPath.endsWith("/")
        ? collapsedPath.slice(0, -1)
        : collapsedPath;
    const method = req.method.toUpperCase();
    let handler = this.match(method, normalizedPath);
    if (!handler && method === "POST" && normalizedPath === "/api/projects") {
      const projectController = this.container.resolve<ProjectController>(
        TOKENS.ProjectController,
      );
      handler = (context) => projectController.create(context);
    }

    if (!handler) {
      return ResponseBuilder.notFound("Endpoint");
    }

    // Wrap with error handler middleware
    try {
      return await errorHandlerMiddleware(ctx, () => handler(ctx));
    } catch (error) {
      // Fallback if middleware fails (should be caught inside middleware)
      console.error("CoreRouter fatal error", error);
      return ResponseBuilder.internalError();
    }
  }
}
