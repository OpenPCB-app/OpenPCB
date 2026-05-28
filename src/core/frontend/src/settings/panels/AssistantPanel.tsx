import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  CircleCheck,
  Cpu,
  Eye,
  EyeOff,
  KeyRound,
  List as ListIcon,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";
import { useRuntime } from "../../providers/RuntimeProvider";
import { cn } from "@/lib/utils";
import { Pill } from "@shared/frontend/ui/pill";
import { StackedCard } from "@shared/frontend/ui/stacked-card";
import type {
  AiProviderKind,
  AssistantProviderConfig,
  AssistantProviderModel,
  AssistantSettings,
} from "../../../../../sdks/assistant";

type ProviderInput = {
  label: string;
  kind: AiProviderKind;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  enabled: boolean;
};

const emptyProvider: ProviderInput = {
  label: "Custom provider",
  kind: "openai-compatible",
  baseUrl: "http://127.0.0.1:1234/v1",
  apiKey: "",
  defaultModel: "local-model",
  enabled: true,
};

const LOCAL_KINDS: AiProviderKind[] = ["lmstudio", "omlx"];

function isLocal(kind: AiProviderKind): boolean {
  return LOCAL_KINDS.includes(kind);
}

function needsKey(provider: AssistantProviderConfig): boolean {
  return provider.kind === "openai" && !provider.hasApiKey;
}

function maskedKey(provider: AssistantProviderConfig): {
  dots: string;
  hint: string;
} {
  const preview = provider.apiKeyPreview ?? "";
  // Show trailing chars as the recognizable hint.
  const hint = preview.length > 4 ? preview.slice(-4) : preview;
  return { dots: "••••••••••••••••", hint };
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => ({ detail: response.statusText }))) as {
      detail?: string;
      error?: string;
      title?: string;
    };
    throw new Error(
      body.detail ?? body.error ?? body.title ?? `HTTP ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export function AssistantPanel() {
  const { backendURL } = useRuntime();
  const base = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/assistant` : null),
    [backendURL],
  );
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [providers, setProviders] = useState<AssistantProviderConfig[]>([]);
  const [models, setModels] = useState<AssistantProviderModel[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderInput>(emptyProvider);
  const [includeCompletion, setIncludeCompletion] = useState(false);
  const [replacingKey, setReplacingKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [lastTest, setLastTest] = useState<{
    providerId: string;
    ok: boolean;
    text: string;
  } | null>(null);
  const [showCloud, setShowCloud] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expanded =
    providers.find((provider) => provider.id === expandedId) ?? null;
  const modelIds = models.map((entry) => entry.modelId);

  const load = async () => {
    if (!base) return;
    const [nextSettings, nextProviders] = await Promise.all([
      readJson<AssistantSettings>(`${base}/settings`),
      readJson<AssistantProviderConfig[]>(`${base}/providers`),
    ]);
    setSettings(nextSettings);
    setProviders(nextProviders);
  };

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [base]);

  // Load draft + models whenever a different card expands.
  useEffect(() => {
    if (!expanded || !base) return;
    setDraft({
      label: expanded.label,
      kind: expanded.kind,
      baseUrl: expanded.baseUrl,
      apiKey: "",
      defaultModel: expanded.defaultModel,
      enabled: expanded.enabled,
    });
    setReplacingKey(!expanded.hasApiKey);
    setShowKey(false);
    void readJson<AssistantProviderModel[]>(
      `${base}/providers/${expanded.id}/models`,
    )
      .then(setModels)
      .catch(() => setModels([]));
  }, [base, expanded?.id, expanded?.updatedAt]);

  const reportError = (err: unknown) =>
    setError(err instanceof Error ? err.message : String(err));

  const saveSettings = async (patch: Partial<AssistantSettings>) => {
    if (!base || !settings) return;
    setError(null);
    const next = await readJson<AssistantSettings>(`${base}/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...settings, ...patch }),
    });
    setSettings(next);
    setMessage("Assistant defaults saved.");
  };

  const saveProviderDraft =
    async (): Promise<AssistantProviderConfig | null> => {
      if (!base || !expanded) return null;
      setError(null);
      const payload = {
        ...draft,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      };
      const updated = await readJson<AssistantProviderConfig>(
        `${base}/providers/${expanded.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setProviders((current) =>
        current.map((provider) =>
          provider.id === updated.id ? updated : provider,
        ),
      );
      setDraft((current) => ({ ...current, apiKey: "" }));
      return updated;
    };

  const saveProvider = async () => {
    await saveProviderDraft();
    setReplacingKey(false);
    setMessage("Provider saved.");
  };

  const addProvider = async () => {
    if (!base) return;
    setError(null);
    const created = await readJson<AssistantProviderConfig>(
      `${base}/providers`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(emptyProvider),
      },
    );
    setProviders((current) => [...current, created]);
    setExpandedId(created.id);
  };

  const deleteProvider = async (provider: AssistantProviderConfig) => {
    if (!base || provider.isBuiltin) return;
    setError(null);
    await readJson<{ ok: true }>(`${base}/providers/${provider.id}`, {
      method: "DELETE",
    });
    setExpandedId(null);
    await load();
    setMessage("Provider deleted.");
  };

  const refreshModels = async () => {
    if (!base || !expanded) return;
    setError(null);
    await saveProviderDraft();
    const nextModels = await readJson<AssistantProviderModel[]>(
      `${base}/providers/${expanded.id}/models/refresh`,
      { method: "POST" },
    );
    setModels(nextModels);
    const nextModelIds = nextModels.map((entry) => entry.modelId);
    if (nextModelIds.length > 0 && !nextModelIds.includes(draft.defaultModel)) {
      setDraft((current) => ({ ...current, defaultModel: nextModelIds[0]! }));
    }
    setMessage("Model list refreshed.");
    await load();
  };

  const testProvider = async (provider: AssistantProviderConfig) => {
    if (!base) return;
    setError(null);
    if (provider.id === expanded?.id) await saveProviderDraft();
    try {
      const result = await readJson<{ message: string }>(
        `${base}/providers/${provider.id}/test`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ includeCompletion }),
        },
      );
      setLastTest({ providerId: provider.id, ok: true, text: result.message });
    } catch (err) {
      setLastTest({
        providerId: provider.id,
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    }
    await load();
  };

  const defaultProviderId = settings?.defaultProviderId;

  return (
    <div className="space-y-5 pb-24 text-slate-900 dark:text-slate-100">
      <div>
        <h2 className="text-lg font-semibold">Assistant</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Bring your own key. Free on desktop — keys stored encrypted locally.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {message}
        </div>
      ) : null}

      {/* OpenPCB AI Cloud upsell banner (UI stub). */}
      <div className="flex items-center gap-3 rounded-xl border border-violet-300/60 bg-accent-soft p-3 dark:border-violet-800/60">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20">
          <Sparkles className="h-4 w-4 text-accent-text" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">OpenPCB AI Cloud</span>
            <Pill tone="accent" className="text-[9px] tracking-wide">
              PAID
            </Pill>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Skip setup. Tuned models for schematic generation, BOM auto-source,
            and ERC fixes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCloud((v) => !v)}
          className="inline-flex shrink-0 items-center gap-1 rounded-control border border-violet-400/40 px-2.5 py-1.5 text-xs text-accent-text hover:bg-violet-500/10"
        >
          Learn more
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
      {showCloud ? (
        <div className="rounded-xl border border-violet-300/50 bg-white p-4 text-sm dark:border-violet-800/50 dark:bg-slate-900">
          <h4 className="mb-2 font-medium">OpenPCB AI Cloud — coming soon</h4>
          <p className="text-slate-500 dark:text-slate-400">
            A managed, optimized assistant. Today OpenPCB is{" "}
            <strong>free</strong> with your own provider key (BYOK). Cloud will
            add zero-setup tuned models, direct JLCPCB BOM sourcing, and
            EDA-trained ERC/DRC suggestions on a subscription.
          </p>
        </div>
      ) : null}

      {/* Default assistant defaults */}
      <section>
        <div className="mb-2.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          Default assistant
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Default provider">
            <Select
              value={defaultProviderId ?? ""}
              onChange={(v) =>
                void saveSettings({ defaultProviderId: v }).catch(reportError)
              }
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prompt preset">
            <Select
              value={settings?.defaultPromptPresetId ?? "strict-grounded"}
              onChange={(v) =>
                void saveSettings({
                  defaultPromptPresetId:
                    v as AssistantSettings["defaultPromptPresetId"],
                }).catch(reportError)
              }
            >
              <option value="strict-grounded">Strict grounded</option>
              <option value="friendly-tutorial">Friendly tutorial</option>
              <option value="minimal-concise">Minimal concise</option>
            </Select>
          </Field>
          <Field label="Context per tool">
            <Select
              value={settings?.contextSizePreference ?? "medium"}
              onChange={(v) =>
                void saveSettings({
                  contextSizePreference:
                    v as AssistantSettings["contextSizePreference"],
                }).catch(reportError)
              }
            >
              <option value="small">Small · ~16 KB</option>
              <option value="medium">Medium · ~64 KB</option>
              <option value="large">Large · ~128 KB</option>
            </Select>
          </Field>
          <Field label="Tool policy">
            <Select
              value={
                settings?.toolExecutionPolicy ?? "auto_readonly_confirm_writes"
              }
              onChange={(v) =>
                void saveSettings({
                  toolExecutionPolicy:
                    v as AssistantSettings["toolExecutionPolicy"],
                }).catch(reportError)
              }
            >
              <option value="auto_readonly_confirm_writes">
                Auto read · confirm writes
              </option>
              <option value="confirm_all_writes">Confirm all writes</option>
              <option value="auto_all">Auto all tools</option>
            </Select>
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={settings?.allowRawToolData ?? false}
            onChange={(e) =>
              void saveSettings({ allowRawToolData: e.target.checked }).catch(
                reportError,
              )
            }
            className="h-3.5 w-3.5"
          />
          Allow raw tool data
          <span className="rounded bg-slate-100 px-1.5 text-[9px] dark:bg-slate-800">
            Advanced
          </span>
        </label>
      </section>

      {/* Providers — stacked accordion */}
      <section>
        <div className="mb-2.5 flex items-center justify-between">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
            Providers · {providers.length}
          </div>
          <button
            type="button"
            onClick={() => void addProvider().catch(reportError)}
            className="inline-flex items-center gap-1 rounded-control border border-violet-400/40 bg-accent-soft px-2.5 py-1 text-xs text-accent-text hover:bg-violet-500/15"
          >
            <Plus className="h-3 w-3" /> Add provider
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          {providers.map((provider) => {
            const isOpen = provider.id === expandedId;
            const isDefault = provider.id === defaultProviderId;
            const warnKey = needsKey(provider);
            const tone = isOpen ? "accent" : warnKey ? "warning" : "default";
            return (
              <StackedCard
                key={provider.id}
                open={isOpen}
                onToggle={() =>
                  setExpandedId((cur) =>
                    cur === provider.id ? null : provider.id,
                  )
                }
                tone={tone}
                summary={
                  <ProviderSummary
                    provider={provider}
                    isDefault={isDefault}
                    warnKey={warnKey}
                    lastTest={
                      lastTest?.providerId === provider.id ? lastTest : null
                    }
                  />
                }
                actions={
                  isOpen ? (
                    <>
                      <HeaderButton
                        tone="success"
                        onClick={() =>
                          void testProvider(provider).catch(reportError)
                        }
                        icon={<Wifi className="h-3 w-3" />}
                      >
                        Re-test
                      </HeaderButton>
                      <HeaderButton
                        onClick={() => void refreshModels().catch(reportError)}
                        icon={<ListIcon className="h-3 w-3" />}
                      >
                        Models
                      </HeaderButton>
                      <button
                        type="button"
                        aria-label="Delete provider"
                        disabled={provider.isBuiltin || isDefault}
                        title={
                          isDefault
                            ? "Set another provider as default first."
                            : undefined
                        }
                        onClick={() =>
                          void deleteProvider(provider).catch(reportError)
                        }
                        className="rounded-control border border-slate-200 p-1.5 text-slate-400 hover:text-red-500 disabled:opacity-40 dark:border-slate-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <ChevronDown className="h-4 w-4 rotate-180 text-accent-text" />
                    </>
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400" />
                  )
                }
              >
                <ProviderForm
                  draft={draft}
                  setDraft={setDraft}
                  provider={provider}
                  models={models}
                  modelIds={modelIds}
                  replacingKey={replacingKey}
                  setReplacingKey={setReplacingKey}
                  showKey={showKey}
                  setShowKey={setShowKey}
                  includeCompletion={includeCompletion}
                  setIncludeCompletion={setIncludeCompletion}
                  onSave={() => void saveProvider().catch(reportError)}
                  onRefreshModels={() =>
                    void refreshModels().catch(reportError)
                  }
                />
              </StackedCard>
            );
          })}

          <button
            type="button"
            onClick={() => void addProvider().catch(reportError)}
            className="flex items-center justify-center gap-1.5 rounded-control border border-dashed border-slate-300 px-3.5 py-3 text-xs text-slate-400 hover:border-slate-400 hover:text-slate-500 dark:border-slate-700 dark:hover:border-slate-600"
          >
            <Plus className="h-3.5 w-3.5" /> Add another provider
          </button>
        </div>
      </section>
    </div>
  );
}

function ProviderIcon({ kind }: { kind: AiProviderKind }) {
  const Icon = isLocal(kind) ? Cpu : Server;
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
      <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
    </div>
  );
}

function ProviderSummary({
  provider,
  isDefault,
  warnKey,
  lastTest,
}: {
  provider: AssistantProviderConfig;
  isDefault: boolean;
  warnKey: boolean;
  lastTest: { ok: boolean; text: string } | null;
}) {
  return (
    <>
      <ProviderIcon kind={provider.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{provider.label}</span>
          {isDefault ? (
            <Pill tone="accent" className="text-[9px] tracking-wide">
              DEFAULT
            </Pill>
          ) : null}
          {isLocal(provider.kind) ? (
            <Pill tone="neutral" className="text-[9px] tracking-wide">
              LOCAL
            </Pill>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[11px]">
          {lastTest ? (
            <span
              className={cn(
                "inline-flex items-center gap-1",
                lastTest.ok ? "text-status-success" : "text-status-danger",
              )}
            >
              {lastTest.ok ? (
                <CircleCheck className="h-3 w-3" />
              ) : (
                <AlertTriangle className="h-3 w-3" />
              )}
              {lastTest.text}
            </span>
          ) : warnKey ? (
            <span className="inline-flex items-center gap-1 text-status-warning">
              <AlertTriangle className="h-3 w-3" /> Needs API key to activate
            </span>
          ) : !provider.enabled ? (
            <span className="text-slate-400">Disabled</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-status-success">
              <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
              <span className="text-slate-500 dark:text-slate-400">
                Active ·{" "}
                <span className="font-mono">{provider.defaultModel}</span>
              </span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

function ProviderForm({
  draft,
  setDraft,
  provider,
  models,
  modelIds,
  replacingKey,
  setReplacingKey,
  showKey,
  setShowKey,
  includeCompletion,
  setIncludeCompletion,
  onSave,
  onRefreshModels,
}: {
  draft: ProviderInput;
  setDraft: React.Dispatch<React.SetStateAction<ProviderInput>>;
  provider: AssistantProviderConfig;
  models: AssistantProviderModel[];
  modelIds: string[];
  replacingKey: boolean;
  setReplacingKey: (v: boolean) => void;
  showKey: boolean;
  setShowKey: (v: boolean) => void;
  includeCompletion: boolean;
  setIncludeCompletion: (v: boolean) => void;
  onSave: () => void;
  onRefreshModels: () => void;
}) {
  const mask = maskedKey(provider);
  const showMasked = provider.hasApiKey && !replacingKey;
  return (
    <>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <Field label="Label">
          <TextInput
            value={draft.label}
            onChange={(v) => setDraft({ ...draft, label: v })}
          />
        </Field>
        <Field label="Type">
          <Select
            value={draft.kind}
            onChange={(v) =>
              setDraft({ ...draft, kind: v as ProviderInput["kind"] })
            }
          >
            <option value="openai">OpenAI official</option>
            <option value="openai-compatible">OpenAI-compatible</option>
            <option value="lmstudio">LM Studio (local)</option>
            <option value="omlx">oMLX (local, Apple Silicon)</option>
          </Select>
        </Field>
      </div>

      <Field label="Base URL" className="mb-3">
        <TextInput
          mono
          value={draft.baseUrl}
          onChange={(v) => setDraft({ ...draft, baseUrl: v })}
        />
      </Field>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">
            API key
          </label>
          {provider.hasApiKey ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-status-success">
              <Lock className="h-3 w-3" /> Saved · encrypted locally
            </span>
          ) : null}
        </div>
        {showMasked ? (
          <div className="flex items-center gap-2 rounded-control border border-slate-200 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-950">
            <KeyRound className="h-3 w-3 text-slate-400" />
            <span className="flex-1 truncate font-mono text-xs tracking-wider text-slate-400">
              {showKey ? `${mask.dots}${mask.hint}` : mask.dots}
            </span>
            {mask.hint ? (
              <span className="font-mono text-xs">{mask.hint}</span>
            ) : null}
            <button
              type="button"
              aria-label="Show key hint"
              onClick={() => setShowKey(!showKey)}
              className="px-1 text-slate-400 hover:text-slate-600"
            >
              {showKey ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="h-3.5 w-px bg-slate-200 dark:bg-slate-700" />
            <button
              type="button"
              onClick={() => setReplacingKey(true)}
              className="inline-flex items-center gap-1 px-1 text-xs text-accent-text"
            >
              <Pencil className="h-3 w-3" /> Replace
            </button>
          </div>
        ) : (
          <TextInput
            type="password"
            placeholder={provider.hasApiKey ? "Enter new key" : "Paste API key"}
            value={draft.apiKey}
            onChange={(v) => setDraft({ ...draft, apiKey: v })}
          />
        )}
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">
            Default model
          </label>
          <button
            type="button"
            onClick={onRefreshModels}
            className="inline-flex items-center gap-1 text-[11px] text-accent-text"
          >
            <RefreshCw className="h-3 w-3" /> Refresh models
          </button>
        </div>
        {models.length > 0 ? (
          <Select
            mono
            value={
              modelIds.includes(draft.defaultModel) ? draft.defaultModel : ""
            }
            onChange={(v) => setDraft({ ...draft, defaultModel: v })}
          >
            <option value="" disabled>
              Select fetched model
            </option>
            {models.map((entry) => (
              <option key={entry.modelId} value={entry.modelId}>
                {entry.displayName ?? entry.modelId}
              </option>
            ))}
          </Select>
        ) : (
          <TextInput
            mono
            value={draft.defaultModel}
            onChange={(v) => setDraft({ ...draft, defaultModel: v })}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) =>
                setDraft({ ...draft, enabled: e.target.checked })
              }
              className="h-3.5 w-3.5"
            />
            Enabled
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <input
              type="checkbox"
              checked={includeCompletion}
              onChange={(e) => setIncludeCompletion(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Include completion in test
          </label>
        </div>
        <button
          type="button"
          onClick={onSave}
          className="rounded-control bg-violet-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-violet-500"
        >
          Save provider
        </button>
      </div>

      {/* Usage tiles (layout now, data Phase 2). */}
      <div className="mt-4 border-t border-violet-300/30 pt-3 dark:border-violet-800/30">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            This month
          </span>
          <button
            type="button"
            disabled
            title="Usage tracking — coming soon"
            className="text-[10px] text-accent-text opacity-60"
          >
            View details →
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Tokens", value: "—" },
            { label: "Spend", value: "—" },
            { label: "Calls", value: "—" },
          ].map((tile) => (
            <div
              key={tile.label}
              className="rounded-control border border-slate-200 bg-white px-2.5 py-1.5 dark:border-slate-700 dark:bg-slate-950"
            >
              <div className="text-[10px] uppercase tracking-wide text-slate-400">
                {tile.label}
              </div>
              <div className="font-mono text-sm font-medium">{tile.value}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
  mono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-control border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-950",
        mono && "font-mono",
      )}
    />
  );
}

function Select({
  value,
  onChange,
  children,
  mono = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full rounded-control border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none dark:border-slate-700 dark:bg-slate-950",
        mono && "font-mono",
      )}
    >
      {children}
    </select>
  );
}

function HeaderButton({
  children,
  icon,
  onClick,
  tone = "neutral",
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: "neutral" | "success";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-control border px-2 py-1 text-[11px]",
        tone === "success"
          ? "border-emerald-400/30 bg-status-success-soft text-status-success"
          : "border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
