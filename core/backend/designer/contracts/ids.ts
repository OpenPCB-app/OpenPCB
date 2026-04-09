export type DesignId = string;
export type SheetId = string;
export type EntityId = string;
export type CommandId = string;
export type SessionId = string;
export type ActorId = string;

export interface IdGenerator {
  uuidv7(): string;
}
