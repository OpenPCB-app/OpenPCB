import type { CommandSuccessResult } from "../contracts/commands/command-result";
import { NotFoundError, ValidationError } from "../contracts/errors";
import { assertEntityInvariant } from "../domain/invariants";
import { applyPatches } from "../domain/patches/apply-patches";
import { stampPatchesForRevision } from "../domain/patches/stamp-patches";
import type { UndoSessionRegistry } from "../domain/history/undo-session-registry";
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

interface UndoDeps {
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

export class UndoUsecase {
  constructor(private deps: UndoDeps) {}

  async execute(designId: string, sessionId: string): Promise<CommandSuccessResult | null> {
    return this.deps.transactionRunner.runInTransaction(async () => {
      const targetCommandId = this.deps.undoRegistry.peekUndo(designId, sessionId);
      if (!targetCommandId) {
        return null;
      }

      const target = await this.deps.commandLogRepository.findByCommandId(targetCommandId);
      if (!target) {
        throw new NotFoundError(`Command log not found: ${targetCommandId}`);
      }

      const latest = await this.deps.commandLogRepository.getLatestForDesign(designId);
      if (latest && latest.sessionId !== sessionId) {
        throw new ValidationError("Cannot undo after changes from another session");
      }

      const headRow = await this.deps.headRepository.get(designId);
      if (!headRow) {
        throw new NotFoundError(`Design head not found: ${designId}`);
      }

      const entityRows = await this.deps.entityRepository.listByDesign(designId);

      const world = {
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
      };

      const acceptedRevision = world.head.revision;
      const nextRevision = acceptedRevision + 1;
      const forwardPatches = structuredClone(target.inversePatches);
      stampPatchesForRevision(world, forwardPatches, nextRevision, {
        preserveCreatedRevisionForMissingEntity: true,
      });
      world.head.revision = nextRevision;
      applyPatches(world, forwardPatches);

      for (const entityId of target.affectedEntityIds) {
        const entity = world.entities.get(entityId);
        if (entity) {
          assertEntityInvariant(entity);
        }
      }

      const nowIso = this.deps.clock.nowIso();
      const existingEntityMap = new Map(entityRows.map((row) => [row.id, row]));
      await this.deps.headRepository.upsert({
        ...headStateToRecord(world.head, headRow.createdAt),
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

      const commandId = this.deps.idGenerator.uuidv7();
      await this.deps.commandLogRepository.append(
        logEntry(
          {
            commandId,
            designId,
            sessionId,
            baseRevision: acceptedRevision,
            nextRevision,
            commandType: "history.undo",
            commandPayload: { targetCommandId },
            forwardPatches,
            inversePatches: structuredClone(target.forwardPatches),
            affectedEntityIds: target.affectedEntityIds,
          },
          nowIso,
        ),
      );

      this.deps.undoRegistry.popUndo(designId, sessionId);
      this.deps.undoRegistry.pushRedo(designId, sessionId, targetCommandId);

      await this.deps.eventPublisher.publish({
        type: "design.invalidated",
        designId,
        revision: nextRevision,
        sourceCommandId: commandId,
        affectedEntityIds: target.affectedEntityIds,
        invalidated: ["schematic", "nets"],
      });

      return {
        ok: true,
        commandId,
        designId,
        acceptedRevision,
        nextRevision,
        forwardPatches,
        affectedEntityIds: target.affectedEntityIds,
        invalidated: ["schematic", "nets"],
      };
    });
  }
}
