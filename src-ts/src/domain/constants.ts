/**
 * Application Constants
 * Eliminates hardcoded values across controllers
 */

/**
 * Default workspace ID (until auth implemented)
 */
export const DEFAULT_WORKSPACE_ID = '019b1a34-d0a5-708d-9e88-aeb536f03a46'; // Using existing workspace: "How are you?"

/**
 * Default AI provider
 */
export const DEFAULT_PROVIDER = 'openai' as const;

/**
 * Default AI model
 */
export const DEFAULT_MODEL = 'gpt-4o-mini-2024-07-18';

/**
 * Default chat list limit
 */
export const DEFAULT_CHAT_LIMIT = 50;

/**
 * Default task list limit
 */
export const DEFAULT_TASK_LIMIT = 100;
