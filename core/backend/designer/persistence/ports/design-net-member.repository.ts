import type { DesignNetMemberRecord } from "../records/design-net-member.record";

export interface DesignNetMemberRepository {
  listByDesign(designId: string): Promise<DesignNetMemberRecord[]>;
  replaceForDesign(designId: string, members: DesignNetMemberRecord[]): Promise<void>;
}
