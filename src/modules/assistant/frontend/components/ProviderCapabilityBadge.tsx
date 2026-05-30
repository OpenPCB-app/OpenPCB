import type { ReactElement } from "react";
import type { AssistantProviderConfig } from "../../../../sdks/assistant";

export function ProviderCapabilityBadge({
  provider,
}: {
  provider: AssistantProviderConfig | null;
}): ReactElement {
  if (!provider) return <Dot color="bg-slate-500" title="No provider" />;
  if (!provider.enabled)
    return <Dot color="bg-slate-500" title={`${provider.label} disabled`} />;
  const caps = provider.capabilities;
  // Heuristic: providers without API key requirement (lmstudio / omlx / openai-compatible) are OK without a key.
  const needsKey =
    (provider.kind === "openai" || provider.kind === "openrouter") &&
    !provider.hasApiKey;
  if (needsKey) return <Dot color="bg-red-500" title="API key required" />;
  if (caps) {
    if (caps.toolCalling && caps.streaming) {
      return (
        <Dot
          color="bg-emerald-500"
          title={`${provider.label}: tools + streaming OK`}
        />
      );
    }
    return (
      <Dot
        color="bg-amber-500"
        title={caps.warning ?? `${provider.label}: chat-only (no tool calling)`}
      />
    );
  }
  return (
    <Dot
      color="bg-slate-400"
      title="Capabilities not probed — click Test in Settings → Assistant"
    />
  );
}

function Dot({ color, title }: { color: string; title: string }): ReactElement {
  return (
    <div
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 shadow-sm"
      title={title}
    >
      <div
        className={`h-2 w-2 rounded-full ${color} shadow-[0_0_8px_currentColor]`}
      />
    </div>
  );
}
