import type { DesignEntityRepository } from "../ports/design-entity.repository";
import type { DesignEntityRecord } from "../records/design-entity.record";

export class InMemoryDesignEntityRepository implements DesignEntityRepository {
  private map = new Map<string, DesignEntityRecord[]>();

  async listByDesign(designId: string): Promise<DesignEntityRecord[]> {
    return structuredClone(this.map.get(designId) ?? []);
  }

  async replaceForDesign(
    designId: string,
    entities: DesignEntityRecord[],
  ): Promise<void> {
    this.map.set(designId, structuredClone(entities));
  }
}
