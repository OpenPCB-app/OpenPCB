import type { DesignEntity } from "../contracts/entity";
import type { NetMemberRef } from "../contracts/patch";
import type { DesignWorld } from "../domain/design-world";
import type { DesignCommandLogRecord } from "../persistence/records/design-command-log.record";
import type { DesignEntityRecord } from "../persistence/records/design-entity.record";
import type { DesignHeadRecord } from "../persistence/records/design-head.record";
import type { DesignNetMemberRecord } from "../persistence/records/design-net-member.record";

export function headRecordToState(row: DesignHeadRecord): DesignWorld["head"] {
  return {
    designId: row.designId,
    revision: row.revision,
    nextAutoNetOrdinals: structuredClone(row.nextAutoNetOrdinals),
    referenceCounters: structuredClone(row.referenceCounters),
  };
}

export function headStateToRecord(
  head: DesignWorld["head"],
  createdAtIso: string,
): DesignHeadRecord {
  return {
    designId: head.designId,
    revision: head.revision,
    nextAutoNetOrdinals: structuredClone(head.nextAutoNetOrdinals),
    referenceCounters: structuredClone(head.referenceCounters),
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
  };
}

export function entityRecordToEntity(row: DesignEntityRecord): DesignEntity {
  return {
    id: row.id,
    designId: row.designId,
    kind: row.kind,
    createdRevision: row.createdRevision,
    updatedRevision: row.updatedRevision,
    components: structuredClone(row.componentsJson) as DesignEntity["components"],
  };
}

export function entityToRecord(
  entity: DesignEntity,
  nowIso: string,
  existingRecord?: DesignEntityRecord,
): DesignEntityRecord {
  const sheetId = entity.components.sheet_ref?.sheetId;
  const reference = entity.components.instance_fields?.reference;
  const originComponentId = entity.components.part_origin_ref?.componentId;
  const originVariantId = entity.components.part_origin_ref?.variantId;

  return {
    id: entity.id,
    designId: entity.designId,
    kind: entity.kind,
    sheetId,
    reference,
    originComponentId,
    originVariantId,
    createdRevision: entity.createdRevision,
    updatedRevision: entity.updatedRevision,
    componentsJson: structuredClone(entity.components),
    createdAt: existingRecord?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

export function netMemberToRecord(member: NetMemberRef): DesignNetMemberRecord {
  return {
    netId: member.netId,
    memberEntityId: member.memberEntityId,
    memberKind: member.memberKind,
    pinKey: member.pinKey,
  };
}

export function logEntry(
  args: Omit<DesignCommandLogRecord, "createdAt">,
  nowIso: string,
): DesignCommandLogRecord {
  return {
    ...args,
    createdAt: nowIso,
  };
}
