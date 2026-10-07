import type { DesignerCommandEnvelope, DesignerCommandOkResult, DesignerOperationIdentity } from "../../../../sdks/designer";

export interface DomainRecoveryCheckpoint {
  directory: string;
  designId: string;
  chatId: string;
  runId: string;
  proposalId: string;
  operationId: string;
  envelope: DesignerCommandEnvelope;
  identity: DesignerOperationIdentity;
  result: DesignerCommandOkResult;
  modelRequests: number;
  proposalStatusBeforeExit: string;
  outcomeBeforeExit: unknown;
}
