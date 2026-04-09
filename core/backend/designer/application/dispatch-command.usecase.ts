import type {
  CommandEnvelope,
  DesignerCommand,
} from "../contracts/commands/command-envelope";
import type {
  CommandConflictResult,
  CommandSuccessResult,
} from "../contracts/commands/command-result";
import type { DesignInvalidatedEvent } from "../contracts/event";
import type { DesignEntity } from "../contracts/entity";
import { ValidationError } from "../contracts/errors";
import type { DesignPatch } from "../contracts/patch";
import { applyPatches } from "../domain/patches/apply-patches";
import { invertPatches } from "../domain/patches/invert-patches";
import { stampPatchesForRevision } from "../domain/patches/stamp-patches";
import type { DesignWorld } from "../domain/design-world";
import { assertEntityInvariant } from "../domain/invariants";
import { rebuildNets } from "../domain/systems/net-rebuild-system";
import { allocateReference } from "../domain/systems/reference-allocator";
import type { UndoSessionRegistry } from "../domain/history/undo-session-registry";
import type { CommandBus } from "../domain/commands/command-bus";
import type { Clock } from "../persistence/ports/clock";
import type { DesignCommandLogRepository } from "../persistence/ports/design-command-log.repository";
import type { DesignEntityRepository } from "../persistence/ports/design-entity.repository";
import type { DesignHeadRepository } from "../persistence/ports/design-head.repository";
import type { DesignNetMemberRepository } from "../persistence/ports/design-net-member.repository";
import type { EventPublisher } from "../persistence/ports/event-publisher";
import type { IdGeneratorPort } from "../persistence/ports/id-generator";
import type { TransactionRunner } from "../persistence/ports/transaction-runner";
import {
  entityRecordToEntity,
  entityToRecord,
  headRecordToState,
  headStateToRecord,
  logEntry,
  netMemberToRecord,
} from "./world-persistence.mapper";

const DEFAULT_SHEET_ID = "sheet-root";

function createDefaultSheetEntity(designId: string): DesignEntity {
  return {
    id: DEFAULT_SHEET_ID,
    designId,
    kind: "sheet",
    createdRevision: 0,
    updatedRevision: 0,
    components: {
      sheet_meta: {
        title: "Sheet 1",
        index: 0,
      },
    },
  };
}

interface DispatchCommandDeps {
  commandBus: CommandBus;
  transactionRunner: TransactionRunner;
  headRepository: DesignHeadRepository;
  entityRepository: DesignEntityRepository;
  netMemberRepository: DesignNetMemberRepository;
  commandLogRepository: DesignCommandLogRepository;
  undoRegistry: UndoSessionRegistry;
  eventPublisher: EventPublisher;
  idGenerator: IdGeneratorPort;
  clock: Clock;
}

function buildEmptyWorld(designId: string): DesignWorld {
  return {
      head: {
        designId,
        revision: 0,
        nextAutoNetOrdinals: { [DEFAULT_SHEET_ID]: 1 },
        referenceCounters: {},
      },
    entities: new Map([[DEFAULT_SHEET_ID, createDefaultSheetEntity(designId)]]),
    netMembers: [],
  };
}

function validateEnvelopeAgainstExistingLog(
  envelope: CommandEnvelope<DesignerCommand>,
  existingLog: NonNullable<Awaited<ReturnType<DesignCommandLogRepository["findByCommandId"]>>>,
): void {
  if (envelope.designId && existingLog.designId !== envelope.designId) {
    throw new ValidationError("commandId reuse with different designId");
  }

  if (existingLog.sessionId !== envelope.sessionId) {
    throw new ValidationError("commandId reuse with different sessionId");
  }

  if (existingLog.commandType !== envelope.command.type) {
    throw new ValidationError("commandId reuse with different command type");
  }

  if (JSON.stringify(existingLog.commandPayload) !== JSON.stringify(envelope.command)) {
    throw new ValidationError("commandId reuse with different command payload");
  }
}

function validateAffectedEntities(world: DesignWorld, entityIds: Iterable<string>): void {
  for (const entityId of entityIds) {
    const entity = world.entities.get(entityId);
    if (entity) {
      assertEntityInvariant(entity);
    }
  }
}

function collectAffected(patches: DesignPatch[]): string[] {
  const ids = new Set<string>();
  for (const patch of patches) {
    if (patch.op === "upsert_entity") ids.add(patch.entity.id);
    if (patch.op === "delete_entity") ids.add(patch.entityId);
    if (patch.op === "set_component" || patch.op === "remove_component") {
      ids.add(patch.entityId);
    }
  }
  return [...ids];
}

export class DispatchCommandUsecase {
  constructor(private deps: DispatchCommandDeps) {}

  async execute(
    envelope: CommandEnvelope<DesignerCommand>,
  ): Promise<CommandSuccessResult | CommandConflictResult> {
    return this.deps.transactionRunner.runInTransaction(async () => {
      const designId = envelope.designId ?? this.deps.idGenerator.uuidv7();
      const existingLog = await this.deps.commandLogRepository.findByCommandId(
        envelope.commandId,
      );
      if (existingLog) {
        validateEnvelopeAgainstExistingLog(envelope, existingLog);
        return {
          ok: true,
          commandId: envelope.commandId,
          designId: existingLog.designId,
          acceptedRevision:
            existingLog.baseRevision === null
              ? existingLog.nextRevision - 1
              : existingLog.baseRevision,
          nextRevision: existingLog.nextRevision,
          forwardPatches: existingLog.forwardPatches,
          affectedEntityIds: existingLog.affectedEntityIds,
          invalidated: ["schematic", "nets"],
        };
      }

      const headRow = await this.deps.headRepository.get(designId);
      const entityRows = headRow
        ? await this.deps.entityRepository.listByDesign(designId)
        : [];
      const world = headRow
        ? {
            head: headRecordToState(headRow),
            entities: new Map(
              entityRows.map((row) => [
                row.id,
                entityRecordToEntity(row),
              ]),
            ),
            netMembers: (await this.deps.netMemberRepository.listByDesign(designId)).map(
              (row) => ({
                netId: row.netId,
                memberEntityId: row.memberEntityId,
                memberKind: row.memberKind,
                pinKey: row.pinKey,
              }),
            ),
          }
        : buildEmptyWorld(designId);

      if (headRow && envelope.baseRevision === null) {
        return {
          ok: false,
          code: "REVISION_CONFLICT",
          designId,
          serverRevision: world.head.revision,
        };
      }

      if (
        envelope.baseRevision !== null &&
        envelope.baseRevision !== world.head.revision
      ) {
        return {
          ok: false,
          code: "REVISION_CONFLICT",
          designId,
          serverRevision: world.head.revision,
        };
      }

      const acceptedRevision = world.head.revision;
      const nextRevision = acceptedRevision + 1;

      const planned = this.deps.commandBus.execute(world, envelope, {
        allocateReference: (prefix) => allocateReference(world.head, prefix),
      });

      for (const patch of planned.patches) {
        if (patch.op === "upsert_entity") {
          assertEntityInvariant(patch.entity);
        }
      }

      stampPatchesForRevision(world, planned.patches, nextRevision);
      const inverseMain = invertPatches(world, planned.patches);
      world.head.revision = nextRevision;
      applyPatches(world, planned.patches);

      let forwardPatches = [...planned.patches];
      let inversePatches = [...inverseMain];
      const affectedEntityIds = new Set<string>(planned.affectedEntityIds);
      let invalidated: Array<"schematic" | "nets"> = ["schematic"];

      if (planned.topologyChanged) {
        const netRebuild = rebuildNets(world, () => this.deps.idGenerator.uuidv7());
        stampPatchesForRevision(world, netRebuild.patches, nextRevision);
        const inverseNet = invertPatches(world, netRebuild.patches);
        applyPatches(world, netRebuild.patches);
        forwardPatches = [...forwardPatches, ...netRebuild.patches];
        inversePatches = [...inverseNet, ...inversePatches];
        for (const id of netRebuild.affectedEntityIds) {
          affectedEntityIds.add(id);
        }
        invalidated = ["schematic", "nets"];
      }

      validateAffectedEntities(world, affectedEntityIds);

      const nowIso = this.deps.clock.nowIso();
      const existingCreatedAt = headRow?.createdAt ?? nowIso;
      const existingEntityMap = new Map(entityRows.map((row) => [row.id, row]));

      await this.deps.headRepository.upsert({
        ...headStateToRecord(world.head, existingCreatedAt),
        updatedAt: nowIso,
      });
      await this.deps.entityRepository.replaceForDesign(
        designId,
        [...world.entities.values()].map((entity) =>
          entityToRecord(entity, nowIso, existingEntityMap.get(entity.id)),
        ),
      );
      await this.deps.netMemberRepository.replaceForDesign(
        designId,
        world.netMembers.map(netMemberToRecord),
      );

      await this.deps.commandLogRepository.append(
        logEntry(
          {
            commandId: envelope.commandId,
            designId,
            sessionId: envelope.sessionId,
            baseRevision: envelope.baseRevision,
            nextRevision,
            commandType: envelope.command.type,
            commandPayload: envelope.command,
            forwardPatches,
            inversePatches,
            affectedEntityIds: collectAffected(forwardPatches),
          },
          nowIso,
        ),
      );

      this.deps.undoRegistry.pushUndo(designId, envelope.sessionId, envelope.commandId);

      const event: DesignInvalidatedEvent = {
        type: "design.invalidated",
        designId,
        revision: world.head.revision,
        sourceCommandId: envelope.commandId,
        affectedEntityIds: [...affectedEntityIds],
        invalidated,
      };
      await this.deps.eventPublisher.publish(event);

      return {
        ok: true,
        commandId: envelope.commandId,
        designId,
        acceptedRevision,
        nextRevision,
        forwardPatches,
        affectedEntityIds: [...affectedEntityIds],
        invalidated,
      };
    });
  }
}
