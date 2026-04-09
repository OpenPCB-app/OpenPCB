import { CommandBus } from "../domain/commands/command-bus";
import { createDefaultCommandRegistry } from "../domain/commands/create-default-command-registry";
import { UndoSessionRegistry } from "../domain/history/undo-session-registry";
import { InMemoryDesignCommandLogRepository } from "../persistence/memory/in-memory-design-command-log.repository";
import { InMemoryDesignEntityRepository } from "../persistence/memory/in-memory-design-entity.repository";
import { InMemoryDesignHeadRepository } from "../persistence/memory/in-memory-design-head.repository";
import { InMemoryDesignNetMemberRepository } from "../persistence/memory/in-memory-design-net-member.repository";
import { InMemoryEventPublisher } from "../persistence/memory/in-memory-event-publisher";
import { InMemoryTransactionRunner } from "../persistence/memory/in-memory-transaction-runner";
import type { Clock } from "../persistence/ports/clock";
import type { IdGeneratorPort } from "../persistence/ports/id-generator";
import { DispatchCommandUsecase } from "./dispatch-command.usecase";
import { GetSchematicProjectionUsecase } from "./get-schematic-projection.usecase";
import { RedoUsecase } from "./redo.usecase";
import { UndoUsecase } from "./undo.usecase";

class SystemClock implements Clock {
  nowIso(): string {
    return new Date().toISOString();
  }
}

class SimpleIdGenerator implements IdGeneratorPort {
  uuidv7(): string {
    return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}`;
  }
}

export function createInMemoryDesignerFoundation() {
  const commandBus = new CommandBus(createDefaultCommandRegistry());
  const transactionRunner = new InMemoryTransactionRunner();
  const headRepository = new InMemoryDesignHeadRepository();
  const entityRepository = new InMemoryDesignEntityRepository();
  const netMemberRepository = new InMemoryDesignNetMemberRepository();
  const commandLogRepository = new InMemoryDesignCommandLogRepository();
  const undoRegistry = new UndoSessionRegistry();
  const eventPublisher = new InMemoryEventPublisher();
  const idGenerator = new SimpleIdGenerator();
  const clock = new SystemClock();

  const dispatchCommand = new DispatchCommandUsecase({
    commandBus,
    transactionRunner,
    headRepository,
    entityRepository,
    netMemberRepository,
    commandLogRepository,
    undoRegistry,
    eventPublisher,
    idGenerator,
    clock,
  });

  const undo = new UndoUsecase({
    transactionRunner,
    headRepository,
    entityRepository,
    netMemberRepository,
    commandLogRepository,
    undoRegistry,
    eventPublisher,
    idGenerator,
    clock,
  });

  const redo = new RedoUsecase({
    transactionRunner,
    headRepository,
    entityRepository,
    netMemberRepository,
    commandLogRepository,
    undoRegistry,
    eventPublisher,
    idGenerator,
    clock,
  });

  const getSchematicProjection = new GetSchematicProjectionUsecase({
    headRepository,
    entityRepository,
    netMemberRepository,
  });

  return {
    dispatchCommand,
    undo,
    redo,
    getSchematicProjection,
    eventPublisher,
    internals: {
      headRepository,
      entityRepository,
      netMemberRepository,
      commandLogRepository,
      undoRegistry,
    },
  };
}
