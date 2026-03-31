export interface FolderRecord {
  id: string;
  workspaceId: string | null;
  projectId: string | null;
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number | null;
  isExpanded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderInput {
  workspaceId?: string;
  projectId?: string;
  name: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
  isExpanded?: boolean;
}

export interface UpdateFolderInput {
  name?: string;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number | null;
  isExpanded?: boolean;
}

export type FolderDeleteAction = "move_to_root" | "delete_chats";

export interface FolderNotEmptyError {
  error: "FOLDER_NOT_EMPTY";
  chatCount: number;
  message: string;
}

export interface FolderWithChatCount extends FolderRecord {
  chatCount: number;
}
