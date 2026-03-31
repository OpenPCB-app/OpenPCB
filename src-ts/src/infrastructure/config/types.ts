/**
 * Configuration Types - V2 Kernel
 *
 * Type definitions for kernel configuration.
 */

import type { ProviderId } from "@shared/types";

/** Log levels */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/** Provider-specific configuration */
export interface ProviderRuntimeConfig {
  /** Whether provider is enabled */
  enabled: boolean;
  /** API key (if required) */
  apiKey?: string;
  /** Custom base URL */
  baseURL?: string;
  /** OpenRouter attribution URL (HTTP-Referer header) */
  appUrl?: string;
  /** OpenRouter attribution title (X-Title header) */
  appTitle?: string;
  /** Default model for this provider */
  defaultModel?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Max retries on failure */
  maxRetries?: number;
}

/** All provider configurations (map of provider ID to config) */
export type ProviderConfigMap = Partial<Record<ProviderId, ProviderRuntimeConfig>>;

/** Server configuration */
export interface ServerRuntimeConfig {
  /** Port to listen on (0 = dynamic) */
  port: number;
  /** Hostname to bind to */
  hostname: string;
  /** Enable request logging */
  logging: boolean;
  /** Log level */
  logLevel: LogLevel;
  /** Enable CORS */
  cors: boolean;
  /** Request timeout in ms */
  requestTimeout: number;
}

/** Storage configuration */
export interface StorageRuntimeConfig {
  /** Base path for data storage */
  dataPath: string;
  /** Database filename */
  dbFilename: string;
  /** Enable WAL mode */
  walMode: boolean;
  /** Busy timeout in ms */
  busyTimeout: number;
}

/** Telemetry configuration */
export interface TelemetryRuntimeConfig {
  /** Enable telemetry collection */
  enabled: boolean;
  /** Track token usage */
  trackUsage: boolean;
  /** Track request timing */
  trackTiming: boolean;
  /** Track errors */
  trackErrors: boolean;
  /** Usage data retention period in days */
  retentionDays: number;
  /** Flush interval in ms */
  flushIntervalMs: number;
}

/** Task manager configuration */
export interface TaskRuntimeConfig {
  /** Max tasks to keep in memory */
  maxTasks: number;
  /** Auto-cleanup completed tasks after ms */
  cleanupAfterMs: number;
  /** Enable auto-cleanup */
  autoCleanup: boolean;
}

/** Full kernel runtime configuration */
export interface KernelRuntimeConfig {
  /** Kernel version */
  version: string;
  /** Workspace ID */
  workspaceId: string;
  /** Environment (development, production) */
  environment: "development" | "production" | "test";
  /** Provider configurations */
  providers: ProviderConfigMap;
  /** Server configuration */
  server: ServerRuntimeConfig;
  /** Storage configuration */
  storage: StorageRuntimeConfig;
  /** Telemetry configuration */
  telemetry: TelemetryRuntimeConfig;
  /** Task manager configuration */
  tasks: TaskRuntimeConfig;
}

/** Default server config */
export const DEFAULT_SERVER_CONFIG: ServerRuntimeConfig = {
  port: 0,
  hostname: "127.0.0.1",
  logging: true,
  logLevel: "info",
  cors: true,
  requestTimeout: 120000,
};

/** Default storage config */
export const DEFAULT_STORAGE_CONFIG: StorageRuntimeConfig = {
  dataPath: "./data",
  dbFilename: "chat.db",
  walMode: true,
  busyTimeout: 5000,
};

/** Default telemetry config */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryRuntimeConfig = {
  enabled: true,
  trackUsage: true,
  trackTiming: true,
  trackErrors: true,
  retentionDays: 30,
  flushIntervalMs: 60000,
};

/** Default task config */
export const DEFAULT_TASK_CONFIG: TaskRuntimeConfig = {
  maxTasks: 1000,
  cleanupAfterMs: 300000, // 5 minutes
  autoCleanup: true,
};

/** Default provider configs */
export const DEFAULT_PROVIDER_CONFIGS: ProviderConfigMap = {
  openai: {
    enabled: true,
    timeout: 120000,
    maxRetries: 2,
  },
  openrouter: {
    enabled: true,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 120000,
    maxRetries: 2,
  },
  ollama: {
    enabled: true,
    baseURL: "http://localhost:11434",
    timeout: 300000,
    maxRetries: 1,
  },
  anthropic: {
    enabled: true,
    timeout: 120000,
    maxRetries: 2,
  },
  groq: {
    enabled: true,
    timeout: 30000, // Fast inference
    maxRetries: 2,
  },
  local: {
    enabled: true,
    timeout: 300000,
    maxRetries: 0,
  },
};

/** Create default kernel config */
export function createDefaultConfig(overrides?: Partial<KernelRuntimeConfig>): KernelRuntimeConfig {
  return {
    version: "2.0.0",
    workspaceId: "01945678-0000-7000-8000-000000000000",
    environment: "development",
    providers: { ...DEFAULT_PROVIDER_CONFIGS, ...overrides?.providers },
    server: { ...DEFAULT_SERVER_CONFIG, ...overrides?.server },
    storage: { ...DEFAULT_STORAGE_CONFIG, ...overrides?.storage },
    telemetry: { ...DEFAULT_TELEMETRY_CONFIG, ...overrides?.telemetry },
    tasks: { ...DEFAULT_TASK_CONFIG, ...overrides?.tasks },
    ...overrides,
  };
}
