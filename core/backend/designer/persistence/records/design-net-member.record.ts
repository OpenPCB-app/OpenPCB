export interface DesignNetMemberRecord {
  netId: string;
  memberEntityId: string;
  memberKind: "wire" | "part_pin";
  pinKey?: string;
}
