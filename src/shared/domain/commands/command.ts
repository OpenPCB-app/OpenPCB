import type { AnyEcsComponent } from "../ecs/component";
import type { Revision } from "../revision/revision";
import type { CommandEnvelope } from "./command-envelope";
import type { EcsPatch } from "./patch";

export interface DomainCommand {
  type: string;
}

export interface CommandExecutionContext {
  aggregateId: string;
  baseRevision: Revision;
  now: number;
}

export interface CommandExecutionResult<
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  patches: EcsPatch<TComponent>[];
  createdEntityId: string | null;
  topologyChanged: boolean;
}

export interface CommandHandler<
  TCommand extends DomainCommand,
  TComponent extends AnyEcsComponent = AnyEcsComponent,
> {
  type: TCommand["type"];
  execute(
    envelope: CommandEnvelope<TCommand>,
    context: CommandExecutionContext,
  ): CommandExecutionResult<TComponent>;
}
