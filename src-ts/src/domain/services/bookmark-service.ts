import type { DatabaseAccess } from "../../db";
import type { Bookmark } from "../../db/schema/bookmark";
import { NotFoundError, ValidationError } from "../../core/errors";
import type {
  CreateBookmarkInput,
  UpdateBookmarkInput,
  BookmarkWithMessage,
} from "@shared/types/bookmark.types";

export interface IBookmarkService {
  listByWorkspace(workspaceId: string): Promise<BookmarkWithMessage[]>;
  listByChat(chatId: string): Promise<BookmarkWithMessage[]>;
  get(id: string): Promise<Bookmark>;
  create(input: CreateBookmarkInput): Promise<Bookmark>;
  update(id: string, input: UpdateBookmarkInput): Promise<Bookmark>;
  remove(id: string): Promise<{ deleted: boolean }>;
  removeByMessage(messageId: string): Promise<{ deleted: boolean }>;
  isBookmarked(workspaceId: string, messageId: string): Promise<boolean>;
}

export class BookmarkService implements IBookmarkService {
  constructor(private db: DatabaseAccess) {}

  async listByWorkspace(workspaceId: string): Promise<BookmarkWithMessage[]> {
    return this.db.bookmarks.findByWorkspace(workspaceId);
  }

  async listByChat(chatId: string): Promise<BookmarkWithMessage[]> {
    return this.db.bookmarks.findByChat(chatId);
  }

  async get(id: string): Promise<Bookmark> {
    const bookmarkRecord = await this.db.bookmarks.findById(id);
    if (!bookmarkRecord) {
      throw new NotFoundError("Bookmark", id);
    }
    return bookmarkRecord;
  }

  async create(input: CreateBookmarkInput): Promise<Bookmark> {
    if (!input.workspaceId) {
      throw new ValidationError("Workspace ID is required");
    }
    if (!input.messageId) {
      throw new ValidationError("Message ID is required");
    }

    const workspace = await this.db.workspaces.findById(input.workspaceId);
    if (!workspace) {
      throw new NotFoundError("Workspace", input.workspaceId);
    }

    const messageRecord = await this.db.messages.findById(input.messageId);
    if (!messageRecord) {
      throw new NotFoundError("Message", input.messageId);
    }

    const exists = await this.db.bookmarks.existsForMessage(
      input.workspaceId,
      input.messageId,
    );
    if (exists) {
      throw new ValidationError("Message is already bookmarked");
    }

    return this.db.bookmarks.create({
      workspaceId: input.workspaceId,
      chatId: messageRecord.chatId,
      messageId: input.messageId,
      note: input.note ?? null,
    });
  }

  async update(id: string, input: UpdateBookmarkInput): Promise<Bookmark> {
    await this.get(id);

    const updateData: Partial<{ note: string | null }> = {};
    if (input.note !== undefined) updateData.note = input.note;

    return this.db.bookmarks.update(id, updateData);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.get(id);
    await this.db.bookmarks.delete(id);
    return { deleted: true };
  }

  async removeByMessage(messageId: string): Promise<{ deleted: boolean }> {
    await this.db.bookmarks.deleteByMessageId(messageId);
    return { deleted: true };
  }

  async isBookmarked(workspaceId: string, messageId: string): Promise<boolean> {
    return this.db.bookmarks.existsForMessage(workspaceId, messageId);
  }
}
