import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
  Wifi,
} from "lucide-react";
import { useRuntime } from "../../providers/RuntimeProvider";
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

function previewKey(provider: AssistantProviderConfig): string {
  if (!provider.hasApiKey) return "No key saved";
  return provider.apiKeyPreview ?? "Saved";
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
  const [selectedId, setSelectedId] = useState("openai");
  const [draft, setDraft] = useState<ProviderInput>(emptyProvider);
  const [includeCompletion, setIncludeCompletion] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected =
    providers.find((provider) => provider.id === selectedId) ??
    providers[0] ??
    null;
  const modelIds = models.map((entry) => entry.modelId);

  const load = async () => {
    if (!base) return;
    const [nextSettings, nextProviders] = await Promise.all([
      readJson<AssistantSettings>(`${base}/settings`),
      readJson<AssistantProviderConfig[]>(`${base}/providers`),
    ]);
    setSettings(nextSettings);
    setProviders(nextProviders);
    setSelectedId((current) =>
      nextProviders.some((provider) => provider.id === current)
        ? current
        : nextSettings.defaultProviderId,
    );
  };

  useEffect(() => {
    void load().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [base]);

  useEffect(() => {
    if (!selected || !base) return;
    setDraft({
      label: selected.label,
      kind: selected.kind,
      baseUrl: selected.baseUrl,
      apiKey: "",
      defaultModel: selected.defaultModel,
      enabled: selected.enabled,
    });
    void readJson<AssistantProviderModel[]>(
      `${base}/providers/${selected.id}/models`,
    )
      .then(setModels)
      .catch(() => setModels([]));
  }, [base, selected?.id, selected?.updatedAt]);

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
      if (!base || !selected) return null;
      setError(null);
      const payload = {
        ...draft,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      };
      const updated = await readJson<AssistantProviderConfig>(
        `${base}/providers/${selected.id}`,
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
    setSelectedId(created.id);
  };

  const deleteProvider = async () => {
    if (!base || !selected || selected.isBuiltin) return;
    setError(null);
    await readJson<{ ok: true }>(`${base}/providers/${selected.id}`, {
      method: "DELETE",
    });
    await load();
    setMessage("Provider deleted.");
  };

  const refreshModels = async () => {
    if (!base || !selected) return;
    setError(null);
    await saveProviderDraft();
    const nextModels = await readJson<AssistantProviderModel[]>(
      `${base}/providers/${selected.id}/models/refresh`,
      { method: "POST" },
    );
    setModels(nextModels);
    const nextModelIds = nextModels.map((entry) => entry.modelId);
    if (nextModelIds.length > 0 && !nextModelIds.includes(draft.defaultModel)) {
      setDraft((current) => ({ ...current, defaultModel: nextModelIds[0]! }));
      setMessage(
        `Model list refreshed. Default model updated to ${nextModelIds[0]} because ${draft.defaultModel} is unavailable.`,
      );
    } else {
      setMessage("Model list refreshed.");
    }
    await load();
  };

  const testProvider = async () => {
    if (!base || !selected) return;
    setError(null);
    await saveProviderDraft();
    const result = await readJson<{ message: string }>(
      `${base}/providers/${selected.id}/test`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeCompletion }),
      },
    );
    await load();
    setMessage(result.message);
  };

  return (
    <div className="space-y-6 pb-24 text-slate-900 dark:text-slate-100">
      <div>
        <h2 className="text-lg font-semibold">Assistant</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure model providers, local API keys, and assistant defaults.
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

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-semibold">Default assistant</h3>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="text-slate-500">Default provider</span>
            <select
              value={settings?.defaultProviderId ?? ""}
              onChange={(event) =>
                void saveSettings({
                  defaultProviderId: event.target.value,
                }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-slate-500">Default prompt preset</span>
            <select
              value={settings?.defaultPromptPresetId ?? "strict-grounded"}
              onChange={(event) =>
                void saveSettings({
                  defaultPromptPresetId: event.target
                    .value as AssistantSettings["defaultPromptPresetId"],
                }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="strict-grounded">Strict Grounded (default)</option>
              <option value="friendly-tutorial">Friendly Tutorial</option>
              <option value="minimal-concise">Minimal Concise</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-slate-500">Context size preference</span>
            <select
              value={settings?.contextSizePreference ?? "medium"}
              onChange={(event) =>
                void saveSettings({
                  contextSizePreference: event.target
                    .value as AssistantSettings["contextSizePreference"],
                }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="small">Small (~16 KB/tool)</option>
              <option value="medium">Medium (~64 KB/tool)</option>
              <option value="large">Large (~128 KB/tool)</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-slate-500">Tool execution policy</span>
            <select
              value={
                settings?.toolExecutionPolicy ?? "auto_readonly_confirm_writes"
              }
              onChange={(event) =>
                void saveSettings({
                  toolExecutionPolicy: event.target
                    .value as AssistantSettings["toolExecutionPolicy"],
                }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="auto_readonly_confirm_writes">
                Auto read-only, confirm writes
              </option>
              <option value="confirm_all_writes">Confirm all writes</option>
              <option value="auto_all">Auto all tools</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings?.allowRawToolData ?? false}
              onChange={(event) =>
                void saveSettings({
                  allowRawToolData: event.target.checked,
                }).catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="h-4 w-4"
            />
            <span className="text-slate-500">
              Allow raw tool data (advanced debug)
            </span>
          </label>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between px-2 py-2">
            <h3 className="font-semibold">Providers</h3>
            <button
              type="button"
              onClick={() =>
                void addProvider().catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : String(err)),
                )
              }
              className="rounded-lg bg-violet-600 p-2 text-white"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                onClick={() => setSelectedId(provider.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left text-sm transition ${selectedId === provider.id ? "border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-100" : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{provider.label}</span>
                  {provider.enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-slate-400" />
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-slate-500">
                  {provider.defaultModel}
                </div>
              </button>
            ))}
          </div>
        </div>

        {selected ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold">{selected.label}</h3>
                <p className="text-sm text-slate-500">
                  {selected.kind} · {previewKey(selected)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void testProvider().catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <Wifi className="mr-1 inline h-4 w-4" /> Test
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void refreshModels().catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="mr-1 inline h-4 w-4" /> Models
                </button>
                <button
                  type="button"
                  disabled={selected.isBuiltin}
                  onClick={() =>
                    void deleteProvider().catch((err: unknown) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                  }
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Input
                label="Label"
                value={draft.label}
                onChange={(value) => setDraft({ ...draft, label: value })}
              />
              <label className="space-y-2 text-sm">
                <span className="text-slate-500">Type</span>
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      kind: event.target.value as ProviderInput["kind"],
                    })
                  }
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="openai">OpenAI official</option>
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="lmstudio">LM Studio (local)</option>
                  <option value="omlx">oMLX (local, Apple Silicon)</option>
                </select>
              </label>
              <Input
                label="Base URL"
                value={draft.baseUrl}
                onChange={(value) => setDraft({ ...draft, baseUrl: value })}
              />
              <Input
                label="API key"
                value={draft.apiKey}
                placeholder={previewKey(selected)}
                type="password"
                onChange={(value) => setDraft({ ...draft, apiKey: value })}
              />
              <label className="space-y-2 text-sm">
                <span className="text-slate-500">Default model</span>
                {models.length > 0 ? (
                  <select
                    value={
                      modelIds.includes(draft.defaultModel)
                        ? draft.defaultModel
                        : ""
                    }
                    onChange={(event) =>
                      setDraft({ ...draft, defaultModel: event.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="" disabled>
                      Select fetched model
                    </option>
                    {models.map((entry) => (
                      <option key={entry.modelId} value={entry.modelId}>
                        {entry.displayName ?? entry.modelId}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={draft.defaultModel}
                    onChange={(event) =>
                      setDraft({ ...draft, defaultModel: event.target.value })
                    }
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                )}
                <span className="block text-xs text-slate-500">
                  {models.length > 0
                    ? `${models.length} cached model${models.length === 1 ? "" : "s"}. Use Models to refetch.`
                    : "No cached models yet. Click Models to fetch."}
                </span>
              </label>
              <label className="flex items-center gap-2 pt-7 text-sm">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) =>
                    setDraft({ ...draft, enabled: event.target.checked })
                  }
                />{" "}
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeCompletion}
                  onChange={(event) =>
                    setIncludeCompletion(event.target.checked)
                  }
                />{" "}
                Include chat completion in test
              </label>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() =>
                  void saveProvider().catch((err: unknown) =>
                    setError(err instanceof Error ? err.message : String(err)),
                  )
                }
                className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                Save provider
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
  );
}
