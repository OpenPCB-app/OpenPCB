import { createContext, useContext, type ReactNode } from "react";
export interface ProposalActions {
  busy: boolean;
  apply(proposalId: string): Promise<void>;
  reject(proposalId: string): Promise<void>;
  allow(proposalId: string): Promise<void>;
  revoke(proposalId: string): Promise<void>;
  isAllowed(proposalId: string): boolean;
}
const Context = createContext<ProposalActions | null>(null);
export function ProposalActionsProvider({ value, children }: { value: ProposalActions; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useProposalActions() { return useContext(Context); }
