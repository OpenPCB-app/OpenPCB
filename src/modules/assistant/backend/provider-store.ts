import { ValidationError } from "../../../core/contracts/errors";
import { AgentKitHostError } from "agentkit/host";
import { providerSnapshotIdentity } from "./providers/provider-snapshot";
import { ProviderCredentials } from "./providers/provider-credentials";
import { CredentialError } from "../../../core/contracts/credentials/secret-store";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AssistantProviderConfig,
  AssistantProviderConfigInput,
  AssistantProviderModel,
  AiProviderCapabilities,
  AiProviderKind,
} from "../../../sdks/assistant";
import { AI_PROVIDER_PRESETS, getPresetByKind } from "agentkit/core";

export interface InternalProviderConfig extends AssistantProviderConfig {
  secretRef?: string | null;
  /** Manual tool-calling override: null = auto (probe), true = on, false = off. */
  toolCallingOverride: boolean | null;
}

export type ToolCallingMode = "auto" | "on" | "off";

function overrideToMode(override: boolean | null): ToolCallingMode {
  return override === null ? "auto" : override ? "on" : "off";
}
function modeToOverride(mode: ToolCallingMode): boolean | null {
  return mode === "auto" ? null : mode === "on";
}

/**
 * Apply a manual override on top of probed capabilities. In auto mode the probe
 * result is used verbatim. When forced on/off the `toolCalling` flag is overridden,
 * synthesizing a minimal capabilities object when the provider was never probed.
 */
function applyToolCallingOverride(
  caps: AiProviderCapabilities | null,
  override: boolean | null,
): AiProviderCapabilities | null {
  if (override === null) return caps;
  if (caps) return { ...caps, toolCalling: override };
  return { streaming: true, toolCalling: override, modelList: true };
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
  readonly credentials: ProviderCredentials;
  private readonly ctxTransaction: <T>(operation: () => T) => T;

  constructor(ctx: CoreBackendModuleContext) {
    this.rawSql = rawSqlFrom(ctx);
    this.ctxTransaction = (operation) => ctx.db.transaction(operation);
    this.credentials = new ProviderCredentials(ctx);
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
      const baseUrl = env
        ? (process.env[env.base] ?? preset.defaultBaseUrl)
        : preset.defaultBaseUrl;
      const defaultModel = env
        ? (process.env[env.model] ?? preset.defaultModel)
        : preset.defaultModel;
      // Keyed presets are enabled only after a durable vault acknowledgement.
      const enabled = 0;
      this.rawSql(
        "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          presetId,
          preset.label,
          preset.kind,
          baseUrl,
          null,
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

  async createProvider(
    input: AssistantProviderConfigInput,
  ): Promise<AssistantProviderConfig> {
    this.assertProviderInput(input, true);
    const providerId = id();
    const secretRef = input.apiKey?.trim()
      ? await this.credentials.write(input.apiKey.trim())
      : null;
    const timestamp = now();
    this.rawSql(
      "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,secret_ref,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?)",
      [
        providerId,
        input.label,
        input.kind ?? "openai-compatible",
        input.baseUrl,
        secretRef,
        input.defaultModel,
        input.enabled === false ? 0 : 1,
        timestamp,
        timestamp,
      ],
    );
    return this.requirePublic(providerId);
  }

  async updateProvider(
    idValue: string,
    input: AssistantProviderConfigInput,
    expectedSnapshot?: InternalProviderConfig,
    signal?: AbortSignal,
  ): Promise<AssistantProviderConfig> {
    return this.credentials.serialize(idValue, async () => {
      signal?.throwIfAborted();
      const current = this.getProviderInternal(idValue);
      if (expectedSnapshot && (!current || providerSnapshotIdentity(current) !== providerSnapshotIdentity(expectedSnapshot))) {
        throw new AgentKitHostError("revision_conflict", "Provider changed during the probe. Retry with its current settings.");
      }
      if (!current) throw new ValidationError(`Provider not found: ${idValue}`);
      const prior = this.credentials.row(idValue)!;
      const next = {
        label: input.label ?? current.label,
        kind: input.kind ?? current.kind,
        baseUrl: input.baseUrl ?? current.baseUrl,
        defaultModel: input.defaultModel ?? current.defaultModel,
        enabled: input.enabled ?? current.enabled,
      };
      this.assertProviderInput(next, true);
      const apiKey = input.apiKey?.trim() || null;
      const reference = input.clearApiKey
        ? null
        : apiKey
          ? await this.credentials.write(apiKey)
          : prior.api_key
            ? await this.credentials.write(prior.api_key)
            : prior.secret_ref;
      this.ctxTransaction(() => {
        this.credentials.associate(idValue, prior, reference);
        this.rawSql(
          "UPDATE assistant_provider_config SET label=?, kind=?, base_url=?, default_model=?, enabled=?, updated_at=? WHERE id=?",
          [
            next.label,
            next.kind,
            next.baseUrl,
            next.defaultModel,
            next.enabled ? 1 : 0,
            now(),
            idValue,
          ],
        );
      });
      return this.requirePublic(idValue);
    });
  }

  async deleteProvider(idValue: string): Promise<void> {
    await this.credentials.serialize(idValue, async () => {
      const provider = this.getProviderInternal(idValue);
      if (!provider)
        throw new ValidationError(`Provider not found: ${idValue}`);
      if (provider.isBuiltin)
        throw new ValidationError("Builtin providers cannot be deleted");
      this.rawSql("DELETE FROM assistant_provider_config WHERE id=?", [
        idValue,
      ]);
    });
  }

  async snapshotProvider(idValue: string): Promise<InternalProviderConfig> {
    await this.credentials.migrate(idValue);
    const provider = this.getProviderInternal(idValue);
    if (!provider) throw new ValidationError(`Provider not found: ${idValue}`);
    return {
      ...this.publicView(provider),
      secretRef: provider.secretRef,
      toolCallingOverride: provider.toolCallingOverride,
    };
  }

  async resolveApiKey(
    provider: InternalProviderConfig,
  ): Promise<string | undefined> {
    if (provider.secretRef) return this.credentials.resolve(provider.secretRef);
    if (provider.hasApiKey) throw new CredentialError("RECONNECT_REQUIRED");
    return undefined;
  }

  async migrateLegacyCredentials(): Promise<void> {
    this.ensureDefaults();
    const legacy = this.rawSql(
      "SELECT id FROM assistant_provider_config WHERE api_key IS NOT NULL",
    );
    for (const row of legacy) await this.credentials.migrate(String(row.id));
    for (const [kind, env] of Object.entries(CLOUD_ENV)) {
      const secret = env ? process.env[env.key]?.trim() : undefined;
      const provider = this.getProviderInternal(kind);
      if (secret && provider && !provider.hasApiKey) {
        await this.updateProvider(kind, { apiKey: secret, enabled: true });
      }
    }
  }

  credentialStatus(providerId: string): { configured: boolean } {
    const provider = this.getProviderInternal(providerId);
    if (!provider)
      throw new ValidationError(`Provider not found: ${providerId}`);
    return { configured: provider.hasApiKey };
  }

  private requirePublic(providerId: string): AssistantProviderConfig {
    const provider = this.getProvider(providerId);
    if (!provider) throw new Error("Provider write failed");
    return provider;
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

  /** Current manual tool-calling override mode for a provider. */
  getToolCallingMode(providerId: string): ToolCallingMode {
    const provider = this.getProviderInternal(providerId);
    if (!provider)
      throw new ValidationError(`Provider not found: ${providerId}`);
    return overrideToMode(provider.toolCallingOverride);
  }

  /** Set the manual tool-calling override. "auto" clears the override. */
  setToolCallingMode(providerId: string, mode: ToolCallingMode): void {
    const exists = this.rawSql(
      "SELECT id FROM assistant_provider_config WHERE id=?",
      [providerId],
    )[0];
    if (!exists) throw new ValidationError(`Provider not found: ${providerId}`);
    const override = modeToOverride(mode);
    this.rawSql(
      "UPDATE assistant_provider_config SET tool_calling_override=?, updated_at=? WHERE id=?",
      [override === null ? null : override ? 1 : 0, now(), providerId],
    );
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
    const secretRef = row.secret_ref ? String(row.secret_ref) : null;
    const hasApiKey = Boolean(secretRef || row.api_key);
    const override =
      row.tool_calling_override === null ||
      row.tool_calling_override === undefined
        ? null
        : Number(row.tool_calling_override) === 1;
    // Bake the override into `capabilities.toolCalling` so both the run service and
    // the frontend DTO see the effective value without touching the published contract.
    const caps = applyToolCallingOverride(
      this.getCapabilities(String(row.id)),
      override,
    );
    return {
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind) as AiProviderKind,
      baseUrl: String(row.base_url),
      secretRef,
      toolCallingOverride: override,
      defaultModel: String(row.default_model),
      enabled: bool(row.enabled),
      isBuiltin: bool(row.is_builtin),
      hasApiKey,
      apiKeyPreview: hasApiKey ? "••••" : null,
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
      // oMLX discovers a model after endpoint setup.
      const preset = input.kind ? getPresetByKind(input.kind) : undefined;
      if (preset?.kind !== "omlx") {
        throw new ValidationError("Default model is required");
      }
    }
  }
}
