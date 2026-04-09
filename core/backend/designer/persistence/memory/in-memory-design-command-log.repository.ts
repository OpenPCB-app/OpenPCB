import type { DesignCommandLogRepository } from "../ports/design-command-log.repository";
import type { DesignCommandLogRecord } from "../records/design-command-log.record";

export class InMemoryDesignCommandLogRepository
  implements DesignCommandLogRepository
{
  private byCommandId = new Map<string, DesignCommandLogRecord>();
  private byDesignId = new Map<string, DesignCommandLogRecord[]>();

  async findByCommandId(commandId: string): Promise<DesignCommandLogRecord | null> {
    const row = this.byCommandId.get(commandId);
    return row ? structuredClone(row) : null;
  }

  async getLatestForDesign(designId: string): Promise<DesignCommandLogRecord | null> {
    const rows = this.byDesignId.get(designId) ?? [];
    const row = rows[rows.length - 1] ?? null;
    return row ? structuredClone(row) : null;
  }

  async append(entry: DesignCommandLogRecord): Promise<void> {
    const cloned = structuredClone(entry);
    this.byCommandId.set(entry.commandId, cloned);
    const rows = this.byDesignId.get(entry.designId) ?? [];
    rows.push(cloned);
    this.byDesignId.set(entry.designId, rows);
  }
}
