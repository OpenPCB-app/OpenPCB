import type { DatabaseAccess } from "../../db";
import type { Tag } from "../../db/schema/tag";
import { NotFoundError, ValidationError } from "../../core/errors";
import type { CreateTagInput, UpdateTagInput } from "@shared/types/tag.types";

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export interface ITagService {
  listByWorkspace(
    workspaceId: string,
    projectId?: string | null,
  ): Promise<Tag[]>;
  get(id: string): Promise<Tag>;
  create(input: CreateTagInput): Promise<Tag>;
  update(id: string, input: UpdateTagInput): Promise<Tag>;
  remove(id: string): Promise<{ deleted: boolean }>;
  addTagToChat(chatId: string, tagId: string): Promise<void>;
  removeTagFromChat(chatId: string, tagId: string): Promise<void>;
  getTagsForChat(chatId: string): Promise<Tag[]>;
  addTagToProject(projectId: string, tagId: string): Promise<void>;
  removeTagFromProject(projectId: string, tagId: string): Promise<void>;
  getTagsForProject(projectId: string): Promise<Tag[]>;
}

export class TagService implements ITagService {
  constructor(private db: DatabaseAccess) {}

  async listByWorkspace(
    workspaceId: string,
    projectId?: string | null,
  ): Promise<Tag[]> {
    if (projectId) {
      return this.db.tags.findAvailableForProject(workspaceId, projectId);
    }
    return this.db.tags.findByWorkspace(workspaceId);
  }

  async get(id: string): Promise<Tag> {
    const tagRecord = await this.db.tags.findById(id);
    if (!tagRecord) {
      throw new NotFoundError("Tag", id);
    }
    return tagRecord;
  }

  async create(input: CreateTagInput): Promise<Tag> {
    if (!input.workspaceId) {
      throw new ValidationError("Workspace ID is required");
    }
    if (!input.name?.trim()) {
      throw new ValidationError("Tag name is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    if (input.projectId) {
      const project = await this.db.projects.findById(input.projectId);
      if (!project) {
        throw new NotFoundError("Project", input.projectId);
      }
      if (project.workspaceId !== input.workspaceId) {
        throw new ValidationError(
          "Project does not belong to the specified workspace",
        );
      }
    }

    if (input.color && !HEX_COLOR_REGEX.test(input.color)) {
      throw new ValidationError(
        "Color must be a valid hex color (e.g., #FF5733)",
      );
    }

    const exists = await this.db.tags.existsInScope(
      input.workspaceId,
      input.projectId ?? null,
      input.name.trim(),
    );
    if (exists) {
      throw new ValidationError(
        "Tag with this name already exists in this scope",
      );
    }

    const sortOrder =
      input.sortOrder ??
      (await this.db.tags.getMaxSortOrder(
        input.workspaceId,
        input.projectId ?? null,
      )) + 1;

    return this.db.tags.create({
      workspaceId: input.workspaceId,
      projectId: input.projectId ?? null,
      name: input.name.trim(),
      color: input.color ?? null,
      sortOrder,
    });
  }

  async update(id: string, input: UpdateTagInput): Promise<Tag> {
    const existing = await this.get(id);

    if (input.color !== undefined && input.color !== null) {
      if (!HEX_COLOR_REGEX.test(input.color)) {
        throw new ValidationError(
          "Color must be a valid hex color (e.g., #FF5733)",
        );
      }
    }

    if (input.name !== undefined) {
      const trimmedName = input.name.trim();
      if (!trimmedName) {
        throw new ValidationError("Tag name cannot be empty");
      }

      const exists = await this.db.tags.existsInScope(
        existing.workspaceId,
        existing.projectId,
        trimmedName,
        id,
      );
      if (exists) {
        throw new ValidationError(
          "Tag with this name already exists in this scope",
        );
      }
    }

    const updateData: Partial<{
      name: string;
      color: string | null;
      sortOrder: number | null;
    }> = {};
    if (input.name !== undefined) updateData.name = input.name.trim();
    if (input.color !== undefined) updateData.color = input.color;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

    return this.db.tags.update(id, updateData);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.get(id);
    await this.db.tags.delete(id);
    return { deleted: true };
  }

  async addTagToChat(chatId: string, tagId: string): Promise<void> {
    const chat = await this.db.chats.findById(chatId);
    if (!chat) {
      throw new NotFoundError("Chat", chatId);
    }

    const tagRecord = await this.get(tagId);

    if (tagRecord.workspaceId !== chat.workspaceId) {
      throw new ValidationError("Tag does not belong to chat's workspace");
    }

    const alreadyHas = await this.db.tags.chatHasTag(chatId, tagId);
    if (alreadyHas) {
      return;
    }

    await this.db.tags.addTagToChat(chatId, tagId);
  }

  async removeTagFromChat(chatId: string, tagId: string): Promise<void> {
    await this.db.tags.removeTagFromChat(chatId, tagId);
  }

  async getTagsForChat(chatId: string): Promise<Tag[]> {
    return this.db.tags.findTagsForChat(chatId);
  }

  async addTagToProject(projectId: string, tagId: string): Promise<void> {
    const project = await this.db.projects.findById(projectId);
    if (!project) {
      throw new NotFoundError("Project", projectId);
    }

    const tagRecord = await this.get(tagId);

    if (tagRecord.workspaceId !== project.workspaceId) {
      throw new ValidationError("Tag does not belong to project's workspace");
    }

    const alreadyHas = await this.db.tags.projectHasTag(projectId, tagId);
    if (alreadyHas) {
      return;
    }

    await this.db.tags.addTagToProject(projectId, tagId);
  }

  async removeTagFromProject(projectId: string, tagId: string): Promise<void> {
    await this.db.tags.removeTagFromProject(projectId, tagId);
  }

  async getTagsForProject(projectId: string): Promise<Tag[]> {
    return this.db.tags.findTagsForProject(projectId);
  }
}
