import { ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AiContextSizePreference,
  AssistantPromptPresetId,
  AssistantSettings,
  AssistantToolExecutionPolicy,
} from "../../../sdks/assistant";
import type { ProviderStore } from "./provider-store";
import { retiredProviderError } from "./providers/provider-selection";

type RawSqlFn = (q: string, p?: unknown[]) => Record<string, unknown>[];

function rawSqlFrom(ctx: CoreBackendModuleContext): RawSqlFn {
  return (
    ctx.db as { rawSql<T = unknown>(q: string, p?: unknown[]): T[] }
  ).rawSql.bind(ctx.db);
}
function now(): string {
  return new Date().toISOString();
}

function rowToSettings(row: Record<string, unknown>): AssistantSettings {
  return {
    defaultProviderId: String(row.default_provider_id),
    defaultPromptPresetId: String(
      row.default_prompt_preset_id,
    ) as AssistantPromptPresetId,
    contextSizePreference: String(
      row.context_size_preference,
    ) as AiContextSizePreference,
    allowRawToolData: Number(row.allow_raw_tool_data) === 1,
    toolExecutionPolicy: String(
      row.tool_execution_policy,
    ) as AssistantToolExecutionPolicy,
    mcpEnabled: Number(row.mcp_enabled) === 1,
    mcpAllowWrites: Number(row.mcp_allow_writes) === 1,
  };
}

const VALID_PRESETS: AssistantPromptPresetId[] = [
  "strict-grounded",
  "friendly-tutorial",
  "minimal-concise",
];
const VALID_SIZES: AiContextSizePreference[] = ["small", "medium", "large"];
const VALID_POLICIES: AssistantToolExecutionPolicy[] = [
  "auto_readonly_confirm_writes",
  "confirm_all_writes",
  "auto_all",
];

export class SettingsStore {
  private readonly rawSql: RawSqlFn;

  constructor(
    ctx: CoreBackendModuleContext,
    private readonly providerStore: ProviderStore,
  ) {
    this.rawSql = rawSqlFrom(ctx);
  }

  ensureDefaults(): void {
    this.providerStore.ensureDefaults();
    const settings = this.rawSql(
      "SELECT id FROM assistant_settings WHERE id='default'",
    )[0];
    if (!settings) {
      const timestamp = now();
      this.rawSql(
        "INSERT INTO assistant_settings (id,default_provider_id,default_prompt_preset_id,context_size_preference,allow_raw_tool_data,tool_execution_policy,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
          "default",
          "openai",
          "strict-grounded",
          "medium",
          0,
          "auto_readonly_confirm_writes",
          timestamp,
          timestamp,
        ],
      );
    }
  }

  /** A default that points at a retired provider reads as cleared, never as a fallback. */
  getSettings(): AssistantSettings {
    const settings = this.storedSettings();
    return this.providerStore.retiredProvider(settings.defaultProviderId)
      ? { ...settings, defaultProviderId: "" } : settings;
  }

  retiredDefaultProvider(): { id: string; label: string } | null {
    return this.providerStore.retiredProvider(this.storedSettings().defaultProviderId);
  }

  private storedSettings(): AssistantSettings {
    this.ensureDefaults();
    const row = this.rawSql(
      "SELECT * FROM assistant_settings WHERE id='default'",
    )[0];
    if (!row) throw new Error("Assistant settings not initialized");
    return rowToSettings(row);
  }

  updateSettings(input: Partial<AssistantSettings>): AssistantSettings {
    const current = this.storedSettings();
    const requested = input.defaultProviderId || undefined;
    const defaultProviderId = requested ?? current.defaultProviderId;
    const retired = this.providerStore.retiredProvider(defaultProviderId);
    // Unrelated edits keep the stored (retired) default rather than inventing a new one.
    if (retired && requested !== undefined) {
      throw retiredProviderError(retired.label);
    }
    if (!retired && !this.providerStore.getProviderInternal(defaultProviderId)) {
      throw new ValidationError(`Provider not found: ${defaultProviderId}`);
    }
    const promptPreset =
      input.defaultPromptPresetId ?? current.defaultPromptPresetId;
    if (!VALID_PRESETS.includes(promptPreset)) {
      throw new ValidationError(`Invalid prompt preset: ${promptPreset}`);
    }
    const contextSize =
      input.contextSizePreference ?? current.contextSizePreference;
    if (!VALID_SIZES.includes(contextSize)) {
      throw new ValidationError(`Invalid context size: ${contextSize}`);
    }
    const policy = input.toolExecutionPolicy ?? current.toolExecutionPolicy;
    if (!VALID_POLICIES.includes(policy)) {
      throw new ValidationError(`Invalid tool execution policy: ${policy}`);
    }
    const allowRaw = input.allowRawToolData ?? current.allowRawToolData;
    const mcpEnabled = input.mcpEnabled ?? current.mcpEnabled;
    // Writes stay off whenever the server is off, so re-enabling the server
    // never silently restores a write grant the user last set months ago.
    const mcpAllowWrites =
      mcpEnabled && (input.mcpAllowWrites ?? current.mcpAllowWrites);
    this.rawSql(
      "UPDATE assistant_settings SET default_provider_id=?, default_prompt_preset_id=?, context_size_preference=?, allow_raw_tool_data=?, tool_execution_policy=?, mcp_enabled=?, mcp_allow_writes=?, updated_at=? WHERE id='default'",
      [
        defaultProviderId,
        promptPreset,
        contextSize,
        allowRaw ? 1 : 0,
        policy,
        mcpEnabled ? 1 : 0,
        mcpAllowWrites ? 1 : 0,
        now(),
      ],
    );
    return this.getSettings();
  }
}
