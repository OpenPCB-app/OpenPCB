export interface FavoriteRecord {
  id: string;
  workspaceId: string;
  chatId: string | null;
  sortOrder: number | null;
  createdAt: string;
}

export interface CreateFavoriteInput {
  workspaceId: string;
  chatId: string;
  sortOrder?: number;
}

export interface UpdateFavoriteInput {
  sortOrder?: number | null;
}

export interface FavoriteWithChat extends FavoriteRecord {
  chat: {
    id: string;
    title: string;
    updatedAt: string;
  } | null;
}
