/**
 * Configuration Loader - V2 Kernel
 *
 * Load configuration from environment variables and files.
 */

import type { ProviderId } from "@shared/types";
import {
  type KernelRuntimeConfig,
  type ProviderRuntimeConfig,
  type LogLevel,
  createDefaultConfig,
} from "./types.ts";

/** Environment variable prefix */
const ENV_PREFIX = "OpenPCB_";

/** Provider-specific env prefixes */
const PROVIDER_ENV_PREFIXES: Record<ProviderId, string> = {
  openai: "OPENAI_",
  openrouter: "OPENROUTER_",
  ollama: "OLLAMA_",
  anthropic: "ANTHROPIC_",
  groq: "GROQ_",
  local: "LOCAL_",
};

/**
 * Load configuration from environment variables.
 *
 * Environment variables:
 * - OpenPCB_ENV: Environment (development, production, test)
 * - OpenPCB_DATA_PATH: Data storage path
 * - OpenPCB_LOG_LEVEL: Log level
 * - OpenPCB_PORT: Server port
 * - OpenPCB_HOST: Server hostname
 * - OPENAI_API_KEY: OpenAI API key
 * - OPENAI_BASE_URL: OpenAI base URL
 * - OLLAMA_BASE_URL: Ollama base URL
 */
export function loadConfigFromEnv(baseConfig?: Partial<KernelRuntimeConfig>): KernelRuntimeConfig {
  const config = createDefaultConfig(baseConfig);

  // Load general config
  const env = process.env[`${ENV_PREFIX}ENV`];
  if (env === "production" || env === "development" || env === "test") {
    config.environment = env;
  }

  const dataPath = process.env[`${ENV_PREFIX}DATA_PATH`];
  if (dataPath) {
    config.storage.dataPath = dataPath;
  }

  const logLevel = process.env[`${ENV_PREFIX}LOG_LEVEL`];
  if (isValidLogLevel(logLevel)) {
    config.server.logLevel = logLevel;
  }

  const port = process.env[`${ENV_PREFIX}PORT`];
  if (port) {
    const parsed = parseInt(port, 10);
    if (!isNaN(parsed)) {
      config.server.port = parsed;
    }
  }

  const host = process.env[`${ENV_PREFIX}HOST`];
  if (host) {
    config.server.hostname = host;
  }

  // Load provider configs
  config.providers.openai = loadProviderFromEnv("openai", config.providers.openai);
  config.providers.openrouter = loadProviderFromEnv("openrouter", config.providers.openrouter);
  config.providers.ollama = loadProviderFromEnv("ollama", config.providers.ollama);
  config.providers.anthropic = loadProviderFromEnv("anthropic", config.providers.anthropic);
  config.providers.groq = loadProviderFromEnv("groq", config.providers.groq);
  config.providers.local = loadProviderFromEnv("local", config.providers.local);

  // Production defaults
  if (config.environment === "production") {
    config.server.logLevel = "warn";
    config.telemetry.enabled = true;
  }

  return config;
}

/** Load provider config from environment */
function loadProviderFromEnv(
  providerId: ProviderId,
  base?: ProviderRuntimeConfig,
): ProviderRuntimeConfig {
  const prefix = PROVIDER_ENV_PREFIXES[providerId];
  const config: ProviderRuntimeConfig = {
    enabled: base?.enabled ?? true,
    ...base,
  };

  // API key
  const apiKey = process.env[`${prefix}API_KEY`];
  if (apiKey) {
    config.apiKey = apiKey;
  }

  // Base URL
  const baseURL = process.env[`${prefix}BASE_URL`];
  if (baseURL) {
    config.baseURL = baseURL;
  }

  // OpenRouter attribution headers
  const appUrl = process.env[`${prefix}APP_URL`];
  if (appUrl) {
    config.appUrl = appUrl;
  }

  const appTitle = process.env[`${prefix}APP_TITLE`];
  if (appTitle) {
    config.appTitle = appTitle;
  }

  // Default model
  const defaultModel = process.env[`${prefix}DEFAULT_MODEL`];
  if (defaultModel) {
    config.defaultModel = defaultModel;
  }

  // Timeout
  const timeout = process.env[`${prefix}TIMEOUT`];
  if (timeout) {
    const parsed = parseInt(timeout, 10);
    if (!isNaN(parsed)) {
      config.timeout = parsed;
    }
  }

  // Enabled/disabled
  const enabled = process.env[`${prefix}ENABLED`];
  if (enabled === "false" || enabled === "0") {
    config.enabled = false;
  } else if (enabled === "true" || enabled === "1") {
    config.enabled = true;
  }

  return config;
}

/** Validate log level */
function isValidLogLevel(level: string | undefined): level is LogLevel {
  return level === "debug" || level === "info" || level === "warn" || level === "error" || level === "silent";
}

/**
 * Load configuration from a JSON file.
 */
export async function loadConfigFromFile(
  filePath: string,
  baseConfig?: Partial<KernelRuntimeConfig>,
): Promise<KernelRuntimeConfig> {
  try {
    const file = Bun.file(filePath);
    if (!await file.exists()) throw new Error("File not found"); // Bun.file doesn't throw on read if not exists immediately? check docs
    const content = await file.text();
    const fileConfig = JSON.parse(content) as Partial<KernelRuntimeConfig>;
    return createDefaultConfig({ ...baseConfig, ...fileConfig });
  } catch (error) {
    // Treat any error as not found for simplicity or check error type
    console.log(`[Config] Config file not found: ${filePath}, using defaults`);
    return createDefaultConfig(baseConfig);
  }
}

/**
 * Load configuration with priority: env > file > defaults.
 */
export async function loadConfig(options?: {
  configFile?: string;
  baseConfig?: Partial<KernelRuntimeConfig>;
}): Promise<KernelRuntimeConfig> {
  let config = createDefaultConfig(options?.baseConfig);

  // Load from file if specified
  if (options?.configFile) {
    config = await loadConfigFromFile(options.configFile, config);
  }

  // Override with environment variables
  config = loadConfigFromEnv(config);

  return config;
}

/**
 * Get a summary of the current configuration (for logging).
 * Masks sensitive values like API keys.
 */
export function getConfigSummary(config: KernelRuntimeConfig): Record<string, unknown> {
  return {
    version: config.version,
    environment: config.environment,
    workspaceId: config.workspaceId,
    server: {
      port: config.server.port,
      hostname: config.server.hostname,
      logLevel: config.server.logLevel,
    },
    storage: {
      dataPath: config.storage.dataPath,
      dbFilename: config.storage.dbFilename,
    },
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, cfg]) => [
        id,
        {
          enabled: cfg?.enabled,
          hasApiKey: !!cfg?.apiKey,
          baseURL: cfg?.baseURL,
          defaultModel: cfg?.defaultModel,
        },
      ]),
    ),
    telemetry: {
      enabled: config.telemetry.enabled,
      trackUsage: config.telemetry.trackUsage,
    },
  };
}
