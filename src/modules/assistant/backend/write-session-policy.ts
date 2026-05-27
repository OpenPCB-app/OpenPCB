export interface AssistantSessionWriteAllowance {
  key: string;
  chatId: string;
  toolName: string;
  proposalKind: string;
  riskLevel: string | null;
  createdAt: string;
}

export class AssistantWriteSessionPolicy {
  private readonly allowances = new Map<string, AssistantSessionWriteAllowance>();

  allow(input: {
    chatId: string;
    toolName: string;
    proposalKind: string;
    riskLevel?: string | null;
  }): AssistantSessionWriteAllowance {
    const key = this.key(input.chatId, input.toolName, input.proposalKind);
    const allowance: AssistantSessionWriteAllowance = {
      key,
      chatId: input.chatId,
      toolName: input.toolName,
      proposalKind: input.proposalKind,
      riskLevel: input.riskLevel ?? null,
      createdAt: new Date().toISOString(),
    };
    this.allowances.set(key, allowance);
    return allowance;
  }

  list(chatId: string): AssistantSessionWriteAllowance[] {
    return [...this.allowances.values()].filter((item) => item.chatId === chatId);
  }

  revoke(chatId: string, key: string): void {
    const allowance = this.allowances.get(key);
    if (allowance?.chatId === chatId) this.allowances.delete(key);
  }

  isAllowed(input: {
    chatId: string;
    toolName: string;
    proposalKind: string;
    riskLevel?: string | null;
  }): boolean {
    const allowance = this.allowances.get(
      this.key(input.chatId, input.toolName, input.proposalKind),
    );
    if (!allowance) return false;
    const allowedRank = riskRank(allowance.riskLevel);
    const requestedRank = riskRank(input.riskLevel ?? null);
    if (allowedRank === null || requestedRank === null) {
      return (allowance.riskLevel ?? null) === (input.riskLevel ?? null);
    }
    return requestedRank <= allowedRank;
  }

  private key(chatId: string, toolName: string, proposalKind: string): string {
    return `${chatId}:${toolName}:${proposalKind}`;
  }
}

function riskRank(risk: string | null): number | null {
  switch (risk) {
    case "low":
      return 0;
    case "medium":
      return 1;
    case "high":
      return 2;
    case "destructive":
      return 3;
    default:
      return null;
  }
}
