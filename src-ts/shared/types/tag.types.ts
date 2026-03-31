export interface TagRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  color: string | null;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTagInput {
  workspaceId: string;
  projectId?: string | null;
  name: string;
  color?: string | null;
  sortOrder?: number;
}

export interface UpdateTagInput {
  name?: string;
  color?: string | null;
  sortOrder?: number | null;
}

export interface ChatTagRecord {
  id: string;
  chatId: string;
  tagId: string;
  createdAt: string;
}

export interface ProjectTagRecord {
  id: string;
  projectId: string;
  tagId: string;
  createdAt: string;
}

export interface TagWithChats extends TagRecord {
  chatIds: string[];
}

export interface TagWithProjects extends TagRecord {
  projectIds: string[];
}

export interface ChatWithTags {
  chatId: string;
  tags: TagRecord[];
}

export interface ProjectWithTags {
  projectId: string;
  tags: TagRecord[];
}
