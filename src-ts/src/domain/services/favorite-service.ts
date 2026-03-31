import type { DatabaseAccess } from "../../db";
import type { Favorite } from "../../db/schema/favorite";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateFavoriteInput,
  UpdateFavoriteInput,
  FavoriteWithChat,
} from "@shared/types/favorite.types";

export interface IFavoriteService {
  listByWorkspace(workspaceId: string): Promise<FavoriteWithChat[]>;
  get(id: string): Promise<Favorite>;
  add(input: CreateFavoriteInput): Promise<Favorite>;
  update(id: string, input: UpdateFavoriteInput): Promise<Favorite>;
  remove(id: string): Promise<{ deleted: boolean }>;
  removeByChat(chatId: string): Promise<{ deleted: boolean }>;
  isFavorite(workspaceId: string, chatId: string): Promise<boolean>;
}

export class FavoriteService implements IFavoriteService {
  constructor(private db: DatabaseAccess) {}

  async listByWorkspace(workspaceId: string): Promise<FavoriteWithChat[]> {
    return this.db.favorites.findByWorkspace(workspaceId);
  }

  async get(id: string): Promise<Favorite> {
    const favorite = await this.db.favorites.findById(id);
    if (!favorite) {
      throw new NotFoundError("Favorite", id);
    }
    return favorite;
  }

  async add(input: CreateFavoriteInput): Promise<Favorite> {
    if (!input.workspaceId) {
      throw new ValidationError("Workspace ID is required");
    }
    if (!input.chatId) {
      throw new ValidationError("Chat ID is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    const chat = await this.db.chats.findById(input.chatId);
    if (!chat) {
      throw new NotFoundError("Chat", input.chatId);
    }

    const exists = await this.db.favorites.existsForChat(
      input.workspaceId,
      input.chatId,
    );
    if (exists) {
      throw new ValidationError("Chat is already a favorite");
    }

    const sortOrder =
      input.sortOrder ??
      (await this.db.favorites.getMaxSortOrder(input.workspaceId)) + 1;

    return this.db.favorites.create({
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      sortOrder,
    });
  }

  async update(id: string, input: UpdateFavoriteInput): Promise<Favorite> {
    await this.get(id);

    const updateData: Partial<UpdateFavoriteInput> = {};
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

    return this.db.favorites.update(id, updateData);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.get(id);
    await this.db.favorites.delete(id);
    return { deleted: true };
  }

  async removeByChat(chatId: string): Promise<{ deleted: boolean }> {
    await this.db.favorites.deleteByChatId(chatId);
    return { deleted: true };
  }

  async isFavorite(workspaceId: string, chatId: string): Promise<boolean> {
    return this.db.favorites.existsForChat(workspaceId, chatId);
  }
}
