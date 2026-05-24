import { ValidationError } from "../../../core/contracts/errors";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  AiContextSizePreference,
  AssistantPromptPresetId,
  AssistantSettings,
  AssistantToolExecutionPolicy,
} from "../../../sdks/assistant";
import type { ProviderStore } from "./provider-store";

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

  getSettings(): AssistantSettings {
    this.ensureDefaults();
    const row = this.rawSql(
      "SELECT * FROM assistant_settings WHERE id='default'",
    )[0];
    if (!row) throw new Error("Assistant settings not initialized");
    return rowToSettings(row);
  }

  updateSettings(input: Partial<AssistantSettings>): AssistantSettings {
    this.ensureDefaults();
    const current = this.getSettings();
    const defaultProviderId =
      input.defaultProviderId ?? current.defaultProviderId;
    if (!this.providerStore.getProviderInternal(defaultProviderId)) {
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
    this.rawSql(
      "UPDATE assistant_settings SET default_provider_id=?, default_prompt_preset_id=?, context_size_preference=?, allow_raw_tool_data=?, tool_execution_policy=?, updated_at=? WHERE id='default'",
      [
        defaultProviderId,
        promptPreset,
        contextSize,
        allowRaw ? 1 : 0,
        policy,
        now(),
      ],
    );
    return this.getSettings();
  }
}
