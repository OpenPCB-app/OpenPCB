export interface BranchNode {
  messageId: string;
  depth: number;
  branchIndex: number;
  isActive: boolean;
  childCount: number;
  preview: string;
  role: string;
  createdAt: string;
  children?: BranchNode[];
}

export interface BranchTreeResponse {
  chatId: string;
  branches: BranchNode[];
  totalNodes: number;
}

export interface CreateBranchInput {
  content: unknown;
  role?: "user" | "assistant";
  provider?: string;
  model?: string;
}

export interface CreateBranchResponse {
  message: {
    id: string;
    chatId: string;
    branchIndex: number;
    depth: number;
    isActive: boolean;
  };
}

export interface ActivateBranchResponse {
  activated: boolean;
  affectedMessages: number;
}

export interface ArchiveBranchResponse {
  archived: boolean;
  archivedCount: number;
}

export interface AlternateBranchesResponse {
  parentMessageId: string | null;
  branches: Array<{
    messageId: string;
    branchIndex: number;
    isActive: boolean;
    preview: string;
    role: string;
    createdAt: string;
  }>;
}
