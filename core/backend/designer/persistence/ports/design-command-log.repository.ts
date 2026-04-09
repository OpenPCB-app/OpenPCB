import type { DesignCommandLogRecord } from "../records/design-command-log.record";

export interface DesignCommandLogRepository {
  findByCommandId(commandId: string): Promise<DesignCommandLogRecord | null>;
  getLatestForDesign(designId: string): Promise<DesignCommandLogRecord | null>;
  append(entry: DesignCommandLogRecord): Promise<void>;
}
