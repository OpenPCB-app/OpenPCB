import type { DatabaseAccess } from "../../db";
import type { Folder } from "../../db/schema/folder";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateFolderInput,
  UpdateFolderInput,
  FolderDeleteAction,
  FolderWithChatCount,
} from "@shared/types/folder.types";

export interface IFolderService {
  listByWorkspace(workspaceId: string): Promise<FolderWithChatCount[]>;
  listByProject(projectId: string): Promise<FolderWithChatCount[]>;
  get(id: string): Promise<Folder>;
  create(input: CreateFolderInput): Promise<Folder>;
  update(id: string, input: UpdateFolderInput): Promise<Folder>;
  delete(
    id: string,
    action?: FolderDeleteAction,
  ): Promise<{ deleted: boolean; chatsAffected: number }>;
  validateChatFolderAssignment(
    chatWorkspaceId: string,
    chatProjectId: string | null,
    folderId: string | null,
  ): Promise<void>;
  autoFixChatFolderAssignment(
    chatWorkspaceId: string,
    chatProjectId: string | null,
    folderId: string | null,
  ): Promise<string | null>;
}

export class FolderService implements IFolderService {
  constructor(private db: DatabaseAccess) {}

  async listByWorkspace(workspaceId: string): Promise<FolderWithChatCount[]> {
    return this.db.folders.findByWorkspaceWithChatCount(workspaceId);
  }

  async listByProject(projectId: string): Promise<FolderWithChatCount[]> {
    return this.db.folders.findByProjectWithChatCount(projectId);
  }

  async get(id: string): Promise<Folder> {
    const folder = await this.db.folders.findById(id);
    if (!folder) {
      throw new NotFoundError("Folder", id);
    }
    return folder;
  }

  async create(input: CreateFolderInput): Promise<Folder> {
    if (!input.name || input.name.trim() === "") {
      throw new ValidationError("Folder name is required");
    }

    const hasWorkspace =
      input.workspaceId !== undefined && input.workspaceId !== null;
    const hasProject =
      input.projectId !== undefined && input.projectId !== null;

    if (hasWorkspace === hasProject) {
      throw new ValidationError(
        "Folder must belong to exactly one of: workspace or project",
      );
    }

    if (hasWorkspace) {
      const workspace = await this.db.workspaces.findById(input.workspaceId!);
      if (!workspace) {
        throw new NotFoundError("Workspace", input.workspaceId!);
      }
    }

    if (hasProject) {
      const project = await this.db.projects.findById(input.projectId!);
      if (!project) {
        throw new NotFoundError("Project", input.projectId!);
      }
    }

    return this.db.folders.create({
      workspaceId: hasWorkspace ? input.workspaceId! : null,
      projectId: hasProject ? input.projectId! : null,
      name: input.name.trim(),
      icon: input.icon,
      color: input.color,
      sortOrder: input.sortOrder,
      isExpanded: input.isExpanded ?? true,
    });
  }

  async update(id: string, input: UpdateFolderInput): Promise<Folder> {
    await this.get(id);

    if (input.name !== undefined && input.name.trim() === "") {
      throw new ValidationError("Folder name cannot be empty");
    }

    const updateData: Partial<UpdateFolderInput> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.icon !== undefined) updateData.icon = input.icon;
    if (input.color !== undefined) updateData.color = input.color;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
    if (input.isExpanded !== undefined)
      updateData.isExpanded = input.isExpanded;

    return this.db.folders.update(id, updateData);
  }

  async delete(
    id: string,
    action?: FolderDeleteAction,
  ): Promise<{ deleted: boolean; chatsAffected: number }> {
    await this.get(id);
    const chatCount = await this.db.folders.countChatsInFolder(id);

    if (chatCount > 0 && !action) {
      throw new ValidationError(
        `Folder contains ${chatCount} chats. Specify action: move_to_root or delete_chats`,
        { code: "FOLDER_NOT_EMPTY", chatCount },
      );
    }

    let chatsAffected = 0;

    if (chatCount > 0) {
      if (action === "move_to_root") {
        chatsAffected = await this.db.folders.moveChatsFolderToRoot(id);
      } else if (action === "delete_chats") {
        chatsAffected = await this.db.folders.deleteChatsInFolder(id);
      } else {
        throw new ValidationError(
          `Invalid delete action: ${action}. Must be "move_to_root" or "delete_chats"`,
          { code: "INVALID_FOLDER_DELETE_ACTION", action },
        );
      }
    }

    await this.db.folders.delete(id);

    return { deleted: true, chatsAffected };
  }

  async validateChatFolderAssignment(
    chatWorkspaceId: string,
    chatProjectId: string | null,
    folderId: string | null,
  ): Promise<void> {
    if (!folderId) return;

    const folder = await this.get(folderId);

    if (chatProjectId) {
      // Chat belongs to a project - folder must belong to same project
      if (folder.projectId !== chatProjectId) {
        throw new ValidationError(
          "Chat in a project can only be assigned to folders within the same project",
        );
      }
    } else {
      // Chat is workspace-level - folder must be workspace-level AND same workspace
      if (folder.projectId !== null) {
        throw new ValidationError(
          "Workspace-level chat cannot be assigned to a project folder",
        );
      }
      if (folder.workspaceId !== chatWorkspaceId) {
        throw new ValidationError(
          "Chat can only be assigned to folders within the same workspace",
        );
      }
    }
  }

  async autoFixChatFolderAssignment(
    chatWorkspaceId: string,
    chatProjectId: string | null,
    folderId: string | null,
  ): Promise<string | null> {
    if (!folderId) return null;

    try {
      await this.validateChatFolderAssignment(
        chatWorkspaceId,
        chatProjectId,
        folderId,
      );
      return folderId;
    } catch {
      return null;
    }
  }
}
