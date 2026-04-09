import type { Revision } from "../revision";
import type { CommandId, DesignId, SessionId } from "../ids";
import type { CreateWireCommand } from "./create-wire.command";
import type { DeleteEntitiesCommand } from "./delete-entities.command";
import type { MoveEntitiesCommand } from "./move-entities.command";
import type { PlacePartCommand } from "./place-part.command";
import type { SetPartValueCommand } from "./set-part-value.command";

export type DesignerCommand =
  | PlacePartCommand
  | MoveEntitiesCommand
  | DeleteEntitiesCommand
  | SetPartValueCommand
  | CreateWireCommand;

export interface CreateDesignIfMissing {
  workspaceId: string;
  projectId?: string | null;
  name?: string;
}

export interface CommandEnvelope<TCommand extends DesignerCommand = DesignerCommand> {
  commandId: CommandId;
  sessionId: SessionId;
  designId?: DesignId;
  baseRevision: Revision | null;
  createDesignIfMissing?: CreateDesignIfMissing;
  command: TCommand;
  issuedAt: number;
}
