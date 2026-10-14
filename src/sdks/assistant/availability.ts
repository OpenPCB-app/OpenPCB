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

/** Problem `type` the run monitor routes answer with (HTTP 503) while the assistant is unavailable. */
export const ASSISTANT_UNAVAILABLE_PROBLEM_TYPE = "https://openpcb.dev/problems/assistant-unavailable";

export interface AssistantUnavailableProblem {
  type: typeof ASSISTANT_UNAVAILABLE_PROBLEM_TYPE;
  title: string;
  status: 503;
  detail: string;
  instance?: string;
  code: AssistantUnavailableCode;
  databasePath?: string;
}
