import { ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantProviderConfig,
  AssistantProviderConfigInput,
  AssistantProviderKind,
  AssistantProviderModel,
  AssistantSettings,
} from "../../../sdks/assistant";

export interface InternalProviderConfig extends AssistantProviderConfig {
  apiKey: string | null;
}

function rawSqlFrom(ctx: CoreBackendModuleContext): (query: string, params?: unknown[]) => Record<string, unknown>[] {
  return (ctx.db as { rawSql<T = unknown>(query: string, params?: unknown[]): T[] }).rawSql.bind(ctx.db);
}

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return crypto.randomUUID();
}

function bool(value: unknown): boolean {
  return Number(value) === 1 || value === true;
}

function apiKeyPreview(apiKey: string | null): string | null {
  if (!apiKey) return null;
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function rowToProvider(row: Record<string, unknown>): InternalProviderConfig {
  const apiKey = row.api_key ? String(row.api_key) : null;
  return {
    id: String(row.id),
    label: String(row.label),
    kind: String(row.kind) as AssistantProviderKind,
    baseUrl: String(row.base_url),
    apiKey,
    defaultModel: String(row.default_model),
    enabled: bool(row.enabled),
    isBuiltin: bool(row.is_builtin),
    hasApiKey: Boolean(apiKey),
    apiKeyPreview: apiKeyPreview(apiKey),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function publicProvider(provider: InternalProviderConfig): AssistantProviderConfig {
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    enabled: provider.enabled,
    isBuiltin: provider.isBuiltin,
    hasApiKey: provider.hasApiKey,
    apiKeyPreview: provider.apiKeyPreview,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function rowToSettings(row: Record<string, unknown>): AssistantSettings {
  return {
    defaultProviderId: String(row.default_provider_id),
    toolExecutionPolicy: String(row.tool_execution_policy) as AssistantSettings["toolExecutionPolicy"],
  };
}

function rowToModel(row: Record<string, unknown>): AssistantProviderModel {
  return {
    providerId: String(row.provider_id),
    modelId: String(row.model_id),
    displayName: row.display_name ? String(row.display_name) : null,
    fetchedAt: String(row.fetched_at),
  };
}

export class AssistantSettingsStore {
  private readonly rawSql: (query: string, params?: unknown[]) => Record<string, unknown>[];

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
  }

  ensureDefaults(): void {
    const timestamp = now();
    const existing = this.rawSql("SELECT id FROM assistant_provider_config WHERE id='openai'")[0];
    if (!existing) {
      this.rawSql(
        "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ["openai", "OpenAI", "openai", process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1", process.env.OPENAI_API_KEY ?? null, process.env.OPENAI_MODEL ?? "gpt-4o-mini", 1, 1, timestamp, timestamp],
      );
    }
    const settings = this.rawSql("SELECT id FROM assistant_settings WHERE id='default'")[0];
    if (!settings) {
      this.rawSql(
        "INSERT INTO assistant_settings (id,default_provider_id,tool_execution_policy,created_at,updated_at) VALUES (?, ?, ?, ?, ?)",
        ["default", "openai", "auto_readonly_confirm_writes", timestamp, timestamp],
      );
    }
  }

  getSettings(): AssistantSettings {
    this.ensureDefaults();
    const row = this.rawSql("SELECT * FROM assistant_settings WHERE id='default'")[0];
    if (!row) throw new Error("Assistant settings not initialized");
    return rowToSettings(row);
  }

  updateSettings(input: Partial<AssistantSettings>): AssistantSettings {
    this.ensureDefaults();
    const current = this.getSettings();
    const defaultProviderId = input.defaultProviderId ?? current.defaultProviderId;
    if (!this.getProviderInternal(defaultProviderId)) throw new ValidationError(`Provider not found: ${defaultProviderId}`);
    const policy = input.toolExecutionPolicy ?? current.toolExecutionPolicy;
    this.rawSql("UPDATE assistant_settings SET default_provider_id=?, tool_execution_policy=?, updated_at=? WHERE id='default'", [defaultProviderId, policy, now()]);
    return this.getSettings();
  }

  listProviders(): AssistantProviderConfig[] {
    this.ensureDefaults();
    return this.rawSql("SELECT * FROM assistant_provider_config ORDER BY is_builtin DESC, label ASC").map(rowToProvider).map(publicProvider);
  }

  getProvider(idValue: string): AssistantProviderConfig | null {
    const provider = this.getProviderInternal(idValue);
    return provider ? publicProvider(provider) : null;
  }

  getProviderInternal(idValue: string): InternalProviderConfig | null {
    this.ensureDefaults();
    const row = this.rawSql("SELECT * FROM assistant_provider_config WHERE id=?", [idValue])[0];
    return row ? rowToProvider(row) : null;
  }

  createProvider(input: AssistantProviderConfigInput): AssistantProviderConfig {
    const timestamp = now();
    const providerId = id();
    this.assertProviderInput(input, true);
    this.rawSql(
      "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [providerId, input.label, input.kind ?? "openai-compatible", input.baseUrl, input.apiKey?.trim() || null, input.defaultModel, input.enabled === false ? 0 : 1, 0, timestamp, timestamp],
    );
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error("Provider insert failed");
    return provider;
  }

  updateProvider(idValue: string, input: AssistantProviderConfigInput): AssistantProviderConfig {
    const current = this.getProviderInternal(idValue);
    if (!current) throw new ValidationError(`Provider not found: ${idValue}`);
    const next = {
      label: input.label ?? current.label,
      kind: input.kind ?? current.kind,
      baseUrl: input.baseUrl ?? current.baseUrl,
      apiKey: input.clearApiKey ? null : input.apiKey && input.apiKey.trim().length > 0 ? input.apiKey.trim() : current.apiKey,
      defaultModel: input.defaultModel ?? current.defaultModel,
      enabled: input.enabled ?? current.enabled,
    };
    this.assertProviderInput(next, true);
    this.rawSql(
      "UPDATE assistant_provider_config SET label=?, kind=?, base_url=?, api_key=?, default_model=?, enabled=?, updated_at=? WHERE id=?",
      [next.label, next.kind, next.baseUrl, next.apiKey, next.defaultModel, next.enabled ? 1 : 0, now(), idValue],
    );
    const provider = this.getProvider(idValue);
    if (!provider) throw new Error("Provider update failed");
    return provider;
  }

  deleteProvider(idValue: string): void {
    const provider = this.getProviderInternal(idValue);
    if (!provider) throw new ValidationError(`Provider not found: ${idValue}`);
    if (provider.isBuiltin) throw new ValidationError("Builtin providers cannot be deleted");
    this.rawSql("DELETE FROM assistant_provider_config WHERE id=?", [idValue]);
  }

  listModels(providerId: string): AssistantProviderModel[] {
    return this.rawSql("SELECT * FROM assistant_provider_model_cache WHERE provider_id=? ORDER BY model_id ASC", [providerId]).map(rowToModel);
  }

  replaceModels(providerId: string, modelIds: string[]): AssistantProviderModel[] {
    const timestamp = now();
    this.rawSql("DELETE FROM assistant_provider_model_cache WHERE provider_id=?", [providerId]);
    for (const modelId of [...new Set(modelIds)].sort()) {
      this.rawSql("INSERT INTO assistant_provider_model_cache (provider_id,model_id,display_name,fetched_at) VALUES (?, ?, ?, ?)", [providerId, modelId, modelId, timestamp]);
    }
    return this.listModels(providerId);
  }

  private assertProviderInput(input: AssistantProviderConfigInput, requireAll: boolean): void {
    if (requireAll && !input.label?.trim()) throw new ValidationError("Provider label is required");
    if (input.kind && !["openai", "openai-compatible"].includes(input.kind)) throw new ValidationError("Invalid provider type");
    if (requireAll && !input.baseUrl?.trim()) throw new ValidationError("Provider base URL is required");
    if (input.baseUrl) {
      try { new URL(input.baseUrl); } catch { throw new ValidationError("Provider base URL must be a valid URL"); }
    }
    if (requireAll && !input.defaultModel?.trim()) throw new ValidationError("Default model is required");
  }
}
