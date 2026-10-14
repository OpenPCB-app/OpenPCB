import type { DesignerCommand, DesignerDispatchResult } from "../../../../sdks";
import {
  CommandDeclinedError,
  RevisionCommandQueue,
  RevisionConflictError,
} from "../../../../shared/frontend/commands/revision-command-queue";
import type { createDesignerApi } from "../api";
import { dispatchFailureMessage } from "../pcb/dispatch-failure";

export type DesignerAction =
  | { kind: "command"; command: DesignerCommand; sessionId: string }
  | { kind: "undo" | "redo"; sessionId: string };
type Api = Pick<
  ReturnType<typeof createDesignerApi>,
  "dispatch" | "getSchematicProjection" | "undo" | "redo"
>;
export const SCHEMATIC_SESSION = "designer-ui-session";
export const PCB_SESSION = "designer-pcb-session";

export function commandSession(command: DesignerCommand): string {
  if (command.type === "batch_commands") {
    const sessions = new Set(command.commands.map(commandSession));
    if (sessions.size > 1)
      throw new Error("A logical batch must belong to one editor history");
    return [...sessions][0] ?? SCHEMATIC_SESSION;
  }
  return command.type.startsWith("pcb_") ? PCB_SESSION : SCHEMATIC_SESSION;
}

export type NetMergeRefusal = Extract<
  DesignerDispatchResult,
  { code: "NET_MERGE_REQUIRES_CONFIRM" }
>;

/** The user declined the net-merge confirm; nothing was written. */
export class NetMergeDeclinedError extends CommandDeclinedError {
  constructor(readonly refusal: NetMergeRefusal) {
    super("Net merge cancelled");
  }
}

export class DesignerCommandCoordinator {
  readonly queue = new RevisionCommandQueue<DesignerAction>();
  private historyPending = new Map<string, Promise<void>>();
  lastConflictAt: number | null = null;
  /** Asked once per refused merge, while the lane is held. */
  confirmNetMerge: ((refusal: NetMergeRefusal) => Promise<boolean>) | null =
    null;
  constructor(private api: Api) {}
  setApi(api: Api): void {
    this.api = api;
  }

  dispatch(
    designId: string,
    command: DesignerCommand,
  ): Promise<DesignerDispatchResult> {
    const input: DesignerAction = {
      kind: "command",
      command,
      sessionId: commandSession(command),
    };
    return this.queue.submit(designId, input, this.sender(designId));
  }

  reapply(
    designId: string,
    retainedId: string,
  ): Promise<DesignerDispatchResult> {
    return this.queue.reapply(designId, retainedId, this.sender(designId));
  }

  private sender(designId: string) {
    return async (
      action: DesignerAction,
      revision: number | null,
      commandId: string,
    ) => {
      if (action.kind !== "command") throw new Error("Expected design command");
      const baseRevision =
        revision ?? (await this.api.getSchematicProjection(designId)).revision;
      const send = (command: DesignerCommand, id: string) =>
        this.api.dispatch(designId, {
          aggregateId: designId,
          commandId: id,
          sessionId: action.sessionId,
          baseRevision,
          issuedAt: Date.now(),
          command,
        });
      let result = await send(action.command, commandId);
      // A refused merge wrote nothing; re-send once with consent under a fresh id.
      if (!result.ok && result.code === "NET_MERGE_REQUIRES_CONFIRM") {
        const confirmed = (await this.confirmNetMerge?.(result)) ?? false;
        if (!confirmed) throw new NetMergeDeclinedError(result);
        result = await send(
          { ...action.command, confirmMerge: true } as DesignerCommand,
          crypto.randomUUID(),
        );
      }
      if (!result.ok) this.reject(result);
      return result;
    };
  }

  private reject(result: DesignerDispatchResult & { ok: false }): never {
    const conflict =
      result.code === "REVISION_CONFLICT" && result.conflict.actual >= 0;
    if (conflict) this.lastConflictAt = Date.now();
    const message = conflict
      ? "Design changed elsewhere. This command was not applied; your edit is retained for review."
      : dispatchFailureMessage("Edit", result);
    const error = conflict
      ? new RevisionConflictError(message)
      : new Error(message);
    throw Object.assign(error, { dispatchResult: result });
  }

  history(
    designId: string,
    sessionId: string,
    kind: "undo" | "redo",
    refresh: () => Promise<void>,
  ): Promise<void> {
    // Repeated activation during the same history operation must not consume another entry.
    const key = JSON.stringify([designId, sessionId]);
    const existing = this.historyPending.get(key);
    if (existing) return existing;
    const task = this.queue
      .submit(designId, { kind, sessionId }, async (_input, revision) => {
        const expectedRevision =
          revision ??
          (await this.api.getSchematicProjection(designId)).revision;
        const result = await this.api[kind](
          designId,
          sessionId,
          expectedRevision,
        );
        if (!result.ok) {
          if (result.code === "REVISION_CONFLICT") {
            this.lastConflictAt = Date.now();
            throw new RevisionConflictError(
              "Design changed before history could be applied. Refresh and review; no history was consumed.",
            );
          }
          throw new Error(`Nothing to ${kind}`);
        }
        return result;
      })
      .then(refresh)
      .finally(() => this.historyPending.delete(key));
    this.historyPending.set(key, task);
    return task;
  }
}

const coordinators = new Map<string, DesignerCommandCoordinator>();
/** Keep rejected edits available when the module unmounts; each backend has a separate scope. */
export function getDesignerCommandCoordinator(
  api: Api,
  scope?: string,
): DesignerCommandCoordinator {
  const existing = scope ? coordinators.get(scope) : undefined;
  if (existing) {
    existing.setApi(api);
    return existing;
  }
  const coordinator = new DesignerCommandCoordinator(api);
  if (scope) {
    coordinators.set(scope, coordinator);
    if (typeof window !== "undefined")
      window.addEventListener("beforeunload", (event) => {
        if (coordinator.queue.hasUnsettledEdits()) {
          event.preventDefault();
          event.returnValue = "";
        }
      });
  }
  return coordinator;
}
