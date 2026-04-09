import type { DesignHeadRepository } from "../ports/design-head.repository";
import type { DesignHeadRecord } from "../records/design-head.record";

export class InMemoryDesignHeadRepository implements DesignHeadRepository {
  private map = new Map<string, DesignHeadRecord>();

  async get(designId: string): Promise<DesignHeadRecord | null> {
    const row = this.map.get(designId);
    return row ? structuredClone(row) : null;
  }

  async upsert(head: DesignHeadRecord): Promise<void> {
    this.map.set(head.designId, structuredClone(head));
  }
}
