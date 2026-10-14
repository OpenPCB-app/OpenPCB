export type AssistantUnavailableCode =
  | "ASSISTANT_DATABASE_CORRUPT"
  | "ASSISTANT_DATABASE_UNREADABLE"
  | "ASSISTANT_DATABASE_UNSUPPORTED"
  | "ASSISTANT_RUNTIME_FAILED";

export interface AssistantUnavailable {
  available: false;
  code: AssistantUnavailableCode;
  /** Actionable, user-facing explanation; never contains credentials. */
  message: string;
  databasePath?: string;
}

/** `GET /api/modules/assistant/availability`: the assistant degrades alone, designs stay usable. */
export type AssistantAvailability = { available: true } | AssistantUnavailable;
