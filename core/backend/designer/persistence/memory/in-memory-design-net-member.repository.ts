import type { DesignNetMemberRepository } from "../ports/design-net-member.repository";
import type { DesignNetMemberRecord } from "../records/design-net-member.record";

export class InMemoryDesignNetMemberRepository
  implements DesignNetMemberRepository
{
  private map = new Map<string, DesignNetMemberRecord[]>();

  async listByDesign(designId: string): Promise<DesignNetMemberRecord[]> {
    return structuredClone(this.map.get(designId) ?? []);
  }

  async replaceForDesign(
    designId: string,
    members: DesignNetMemberRecord[],
  ): Promise<void> {
    this.map.set(designId, structuredClone(members));
  }
}
