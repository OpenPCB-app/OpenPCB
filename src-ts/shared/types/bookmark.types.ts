export interface BookmarkRecord {
  id: string;
  workspaceId: string;
  chatId: string | null;
  messageId: string;
  note: string | null;
  createdAt: string;
}

export interface CreateBookmarkInput {
  workspaceId: string;
  chatId?: string | null;
  messageId: string;
  note?: string | null;
}

export interface UpdateBookmarkInput {
  note?: string | null;
}

export interface BookmarkWithMessage extends BookmarkRecord {
  message: {
    id: string;
    role: string;
    content: unknown;
    chatId: string;
  } | null;
}
