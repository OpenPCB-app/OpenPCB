import { ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantProviderConfig,
  AssistantProviderConfigInput,
  AssistantProviderModel,
  AiProviderCapabilities,
  AiProviderKind,
} from "../../../sdks/assistant";
import { AI_PROVIDER_PRESETS, getPresetByKind } from "@openpcb/ai-core";

export interface InternalProviderConfig extends AssistantProviderConfig {
  apiKey: string | null;
}

type RawSqlFn = (q: string, p?: unknown[]) => Record<string, unknown>[];

function rawSqlFrom(ctx: CoreBackendModuleContext): RawSqlFn {
  return (
    ctx.db as { rawSql<T = unknown>(q: string, p?: unknown[]): T[] }
  ).rawSql.bind(ctx.db);
}
function now(): string {
  return new Date().toISOString();
}
function id(): string {
  return crypto.randomUUID();
}
function bool(v: unknown): boolean {
  return Number(v) === 1 || v === true;
}
function apiKeyPreview(apiKey: string | null): string | null {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function rowToCapabilities(
  row: Record<string, unknown> | undefined,
): AiProviderCapabilities | null {
  if (!row) return null;
  return {
    streaming: bool(row.streaming),
    toolCalling: bool(row.tool_calling),
    modelList: bool(row.model_list),
    vision: row.vision === null ? undefined : bool(row.vision),
    jsonMode: row.json_mode === null ? undefined : bool(row.json_mode),
    maxContextTokens:
      row.max_context_tokens === null
        ? undefined
        : Number(row.max_context_tokens),
    checkedAt: row.checked_at ? String(row.checked_at) : undefined,
    warning: row.warning ? String(row.warning) : undefined,
  };
}

const VALID_KINDS: AiProviderKind[] = [
  "openai",
  "openrouter",
  "openai-compatible",
  "lmstudio",
  "omlx",
];

// Curated built-ins seeded on first run. `openai-compatible` is intentionally
// excluded — it stays a valid kind so users can add their own custom endpoint
// via "Add provider", but we don't ship it as a default preset.
const SEEDED_BUILTIN_KINDS: AiProviderKind[] = [
  "openai",
  "openrouter",
  "lmstudio",
  "omlx",
];

// Cloud providers seeded from env: paste-key flow, enabled only once a key exists.
const CLOUD_ENV: Partial<
  Record<AiProviderKind, { key: string; base: string; model: string }>
> = {
  openai: {
    key: "OPENAI_API_KEY",
    base: "OPENAI_BASE_URL",
    model: "OPENAI_MODEL",
  },
  openrouter: {
    key: "OPENROUTER_API_KEY",
    base: "OPENROUTER_BASE_URL",
    model: "OPENROUTER_MODEL",
  },
};

export class ProviderStore {
  private readonly rawSql: RawSqlFn;

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
  }

  ensureDefaults(): void {
    const timestamp = now();
    // Seed curated presets as builtins (disabled by default for those that need user setup).
    for (const preset of AI_PROVIDER_PRESETS) {
      if (!SEEDED_BUILTIN_KINDS.includes(preset.kind)) continue;
      const presetId = preset.kind; // stable id == kind for builtins
      const existing = this.rawSql(
        "SELECT id FROM assistant_provider_config WHERE id=?",
        [presetId],
      )[0];
      if (existing) continue;
      const env = CLOUD_ENV[preset.kind];
      const apiKey = env ? (process.env[env.key] ?? null) : null;
      const baseUrl = env
        ? (process.env[env.base] ?? preset.defaultBaseUrl)
        : preset.defaultBaseUrl;
      const defaultModel = env
        ? (process.env[env.model] ?? preset.defaultModel)
        : preset.defaultModel;
      // Cloud providers activate once a key exists; local providers stay disabled until configured.
      const enabled = env ? (apiKey ? 1 : 0) : 0;
      this.rawSql(
        "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          presetId,
          preset.label,
          preset.kind,
          baseUrl,
          apiKey,
          defaultModel,
          enabled,
          1,
          timestamp,
          timestamp,
        ],
      );
    }
  }

  listProviders(): AssistantProviderConfig[] {
    this.ensureDefaults();
    return this.rawSql(
      "SELECT * FROM assistant_provider_config ORDER BY is_builtin DESC, label ASC",
    ).map((row) => this.rowToPublic(row));
  }

  getProvider(idValue: string): AssistantProviderConfig | null {
    const internal = this.getProviderInternal(idValue);
    return internal ? this.publicView(internal) : null;
  }

  getProviderInternal(idValue: string): InternalProviderConfig | null {
    this.ensureDefaults();
    const row = this.rawSql(
      "SELECT * FROM assistant_provider_config WHERE id=?",
      [idValue],
    )[0];
    return row ? this.rowToInternal(row) : null;
  }

  createProvider(input: AssistantProviderConfigInput): AssistantProviderConfig {
    const timestamp = now();
    const providerId = id();
    this.assertProviderInput(input, true);
    this.rawSql(
      "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        providerId,
        input.label,
        input.kind ?? "openai-compatible",
        input.baseUrl,
        input.apiKey?.trim() || null,
        input.defaultModel,
        input.enabled === false ? 0 : 1,
        0,
        timestamp,
        timestamp,
      ],
    );
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error("Provider insert failed");
    return provider;
  }

  updateProvider(
    idValue: string,
    input: AssistantProviderConfigInput,
  ): AssistantProviderConfig {
    const current = this.getProviderInternal(idValue);
    if (!current) throw new ValidationError(`Provider not found: ${idValue}`);
    const next = {
      label: input.label ?? current.label,
      kind: input.kind ?? current.kind,
      baseUrl: input.baseUrl ?? current.baseUrl,
      apiKey: input.clearApiKey
        ? null
        : input.apiKey && input.apiKey.trim().length > 0
          ? input.apiKey.trim()
          : current.apiKey,
      defaultModel: input.defaultModel ?? current.defaultModel,
      enabled: input.enabled ?? current.enabled,
    };
    this.assertProviderInput(
      { ...next, apiKey: next.apiKey ?? undefined },
      true,
    );
    this.rawSql(
      "UPDATE assistant_provider_config SET label=?, kind=?, base_url=?, api_key=?, default_model=?, enabled=?, updated_at=? WHERE id=?",
      [
        next.label,
        next.kind,
        next.baseUrl,
        next.apiKey,
        next.defaultModel,
        next.enabled ? 1 : 0,
        now(),
        idValue,
      ],
    );
    const provider = this.getProvider(idValue);
    if (!provider) throw new Error("Provider update failed");
    return provider;
  }

  deleteProvider(idValue: string): void {
    const provider = this.getProviderInternal(idValue);
    if (!provider) throw new ValidationError(`Provider not found: ${idValue}`);
    if (provider.isBuiltin)
      throw new ValidationError("Builtin providers cannot be deleted");
    this.rawSql("DELETE FROM assistant_provider_config WHERE id=?", [idValue]);
  }

  listModels(providerId: string): AssistantProviderModel[] {
    return this.rawSql(
      "SELECT * FROM assistant_provider_model_cache WHERE provider_id=? ORDER BY model_id ASC",
      [providerId],
    ).map((row) => ({
      providerId: String(row.provider_id),
      modelId: String(row.model_id),
      displayName: row.display_name ? String(row.display_name) : null,
      fetchedAt: String(row.fetched_at),
    }));
  }

  replaceModels(
    providerId: string,
    modelIds: string[],
  ): AssistantProviderModel[] {
    const timestamp = now();
    this.rawSql(
      "DELETE FROM assistant_provider_model_cache WHERE provider_id=?",
      [providerId],
    );
    for (const modelId of [...new Set(modelIds)].sort()) {
      this.rawSql(
        "INSERT INTO assistant_provider_model_cache (provider_id,model_id,display_name,fetched_at) VALUES (?, ?, ?, ?)",
        [providerId, modelId, modelId, timestamp],
      );
    }
    return this.listModels(providerId);
  }

  getCapabilities(providerId: string): AiProviderCapabilities | null {
    const row = this.rawSql(
      "SELECT * FROM assistant_provider_capability WHERE provider_id=?",
      [providerId],
    )[0];
    return rowToCapabilities(row);
  }

  saveCapabilities(
    providerId: string,
    capabilities: AiProviderCapabilities,
  ): void {
    const timestamp = now();
    const existing = this.rawSql(
      "SELECT provider_id FROM assistant_provider_capability WHERE provider_id=?",
      [providerId],
    )[0];
    const params = [
      capabilities.streaming ? 1 : 0,
      capabilities.toolCalling ? 1 : 0,
      capabilities.modelList ? 1 : 0,
      capabilities.vision === undefined ? null : capabilities.vision ? 1 : 0,
      capabilities.jsonMode === undefined
        ? null
        : capabilities.jsonMode
          ? 1
          : 0,
      capabilities.maxContextTokens ?? null,
      capabilities.checkedAt ?? timestamp,
      capabilities.warning ?? null,
      timestamp,
    ];
    if (existing) {
      this.rawSql(
        "UPDATE assistant_provider_capability SET streaming=?, tool_calling=?, model_list=?, vision=?, json_mode=?, max_context_tokens=?, checked_at=?, warning=?, updated_at=? WHERE provider_id=?",
        [...params, providerId],
      );
    } else {
      this.rawSql(
        "INSERT INTO assistant_provider_capability (provider_id,streaming,tool_calling,model_list,vision,json_mode,max_context_tokens,checked_at,warning,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [providerId, ...params],
      );
    }
  }

  private rowToInternal(row: Record<string, unknown>): InternalProviderConfig {
    const apiKey = row.api_key ? String(row.api_key) : null;
    const caps = this.getCapabilities(String(row.id));
    return {
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind) as AiProviderKind,
      baseUrl: String(row.base_url),
      apiKey,
      defaultModel: String(row.default_model),
      enabled: bool(row.enabled),
      isBuiltin: bool(row.is_builtin),
      hasApiKey: Boolean(apiKey),
      apiKeyPreview: apiKeyPreview(apiKey),
      capabilities: caps,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToPublic(row: Record<string, unknown>): AssistantProviderConfig {
    return this.publicView(this.rowToInternal(row));
  }

  private publicView(
    internal: InternalProviderConfig,
  ): AssistantProviderConfig {
    return {
      id: internal.id,
      label: internal.label,
      kind: internal.kind,
      baseUrl: internal.baseUrl,
      defaultModel: internal.defaultModel,
      enabled: internal.enabled,
      isBuiltin: internal.isBuiltin,
      hasApiKey: internal.hasApiKey,
      apiKeyPreview: internal.apiKeyPreview,
      capabilities: internal.capabilities,
      createdAt: internal.createdAt,
      updatedAt: internal.updatedAt,
    };
  }

  private assertProviderInput(
    input: AssistantProviderConfigInput,
    requireAll: boolean,
  ): void {
    if (requireAll && !input.label?.trim())
      throw new ValidationError("Provider label is required");
    if (input.kind && !VALID_KINDS.includes(input.kind))
      throw new ValidationError(`Invalid provider type: ${input.kind}`);
    if (requireAll && !input.baseUrl?.trim())
      throw new ValidationError("Provider base URL is required");
    if (input.baseUrl) {
      try {
        new URL(input.baseUrl);
      } catch {
        throw new ValidationError("Provider base URL must be a valid URL");
      }
    }
    if (requireAll && !input.defaultModel?.trim()) {
      // Allow empty default model for omlx preset (user fills in later).
      const preset = input.kind ? getPresetByKind(input.kind) : undefined;
      if (preset?.kind !== "omlx") {
        throw new ValidationError("Default model is required");
      }
    }
  }
}
