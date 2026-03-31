export interface DesignRecord {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateDesignInput {
  workspaceId: string;
  projectId?: string | null;
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface UpdateDesignInput {
  name?: string;
  description?: string | null;
  sortOrder?: number | null;
}
