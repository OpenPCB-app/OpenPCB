import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Plug, RefreshCw } from "lucide-react";
import type { AssistantSettings } from "../../../../../sdks/assistant";

/**
 * MCP server controls — how the user connects Claude Code (their own Claude
 * subscription) to OpenPCB.
 *
 * Two independent switches, both default off: the server itself, and whether
 * write tools are advertised to it. Enabling the server is about reachability
 * (read your designs from Claude Code); enabling writes hands an external
 * process a scripted path to change them, with deletions and rule changes
 * still waiting for approval in the assistant panel. `settings-store.ts`
 * forces writes off whenever the server is off.
 *
 * Connecting: the one-click button drives the user's `claude` CLI to install
 * OpenPCB's local plugin (tools + workflow skills) or just the MCP server;
 * the manual commands below do the same by hand. Both point at the stable
 * launcher Electron main keeps in the user-data dir, so they survive app
 * updates and restarts.
 */

interface Props {
  settings: AssistantSettings | null;
  onSave: (patch: Partial<AssistantSettings>) => void;
  /** `${backendURL}/api/modules/assistant`, for the connected-clients list. */
  assistantBase: string | null;
}

interface McpClient {
  instanceId: string;
  clientName: string;
  lastSeen: string;
  callCount: number;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
      className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-control border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" /> Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" /> Copy
        </>
      )}
    </button>
  );
}

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

export function describeClaudeCodeStatus(status: ClaudeCodeStatus | null): string {
  if (!status) return "Checking Claude Code…";
  if (!status.cliPath) return "Claude Code is not installed (the `claude` command was not found).";
  if (status.plugin.installed) {
    return status.updateAvailable
      ? `Connected with the OpenPCB plugin ${status.plugin.version ?? ""} — an update is available.`
      : `Connected with the OpenPCB plugin ${status.plugin.version ?? ""}.`;
  }
  if (status.server.registered) {
    if (!status.server.ownedByOpenPcb) return "Claude Code has a different server named “openpcb”.";
    return status.server.outdated
      ? "Connected (MCP server only), but Claude Code still points at an old OpenPCB location — update the connection."
      : "Connected (MCP server only, no skills).";
  }
  return `Claude Code ${status.cliVersion ?? ""} found — not connected yet.`;
}

/** The primary button: connect, or update whatever this installation registered. */
export function connectLabel(status: ClaudeCodeStatus | null): string {
  if (!status?.updateAvailable) return "Connect Claude Code";
  return status.registeredMode === "server" ? "Update connection" : "Update plugin";
}

export function McpSection({ settings, onSave, assistantBase }: Props) {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ClaudeCodeActionResult | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const enabled = settings?.mcpEnabled ?? false;
  const allowWrites = settings?.mcpAllowWrites ?? false;
  const claudeCode = window.electronAPI?.claudeCode;

  const refreshStatus = useCallback(async () => {
    if (!claudeCode) return;
    setStatus(null);
    setStatus(await claudeCode.status().catch(() => null));
  }, [claudeCode]);

  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI?.getMcpConfig;
    if (!api) return;
    void api()
      .then(setConfig)
      .catch(() => setConfig(null));
    void refreshStatus();
  }, [enabled, refreshStatus]);

  // Who is connected right now — the list the MCP endpoint keeps per client
  // session (idle ones drop out after 30 minutes).
  useEffect(() => {
    if (!enabled || !assistantBase) return;
    let cancelled = false;
    const load = () =>
      fetch(`${assistantBase}/mcp/clients`)
        .then((r) => (r.ok ? (r.json() as Promise<{ clients: McpClient[] }>) : null))
        .then((body) => {
          if (!cancelled && body) setClients(body.clients);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, assistantBase]);

  const run = async (label: string, action: () => Promise<ClaudeCodeActionResult>) => {
    setBusy(label);
    setResult(null);
    try {
      setResult(await action());
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        log: [],
      });
    } finally {
      setBusy(null);
      void refreshStatus();
    }
  };

  const connected =
    Boolean(status?.plugin.installed) ||
    Boolean(status?.server.registered && status.server.ownedByOpenPcb);

  return (
    <section>
      <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-text-caps">
        <Plug className="h-3 w-3" /> MCP server · Claude Code
      </div>

      <p className="mb-2 text-xs text-text-tertiary">
        Use Claude Code (or Claude Desktop, Codex) as the agent for OpenPCB with
        your own Claude subscription. It reads and edits the designs in this
        app while OpenPCB is running.
      </p>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onSave({ mcpEnabled: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        Enable MCP server
      </label>

      <label
        className={`mt-2 flex items-center gap-2 text-xs ${
          enabled ? "text-text-secondary" : "text-text-disabled"
        }`}
      >
        <input
          type="checkbox"
          disabled={!enabled}
          checked={allowWrites}
          onChange={(e) => onSave({ mcpAllowWrites: e.target.checked })}
          className="h-3.5 w-3.5"
        />
        Allow writes from MCP clients
        <span className="rounded bg-amber-100 px-1.5 text-[9px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          Caution
        </span>
      </label>

      {enabled && (
        <p className="mt-1.5 text-[11px] text-text-tertiary">
          {allowWrites
            ? "Schematic and PCB edits are allowed. Edits apply immediately and are undoable (Ctrl+Z); deletions and design-rule changes wait for your approval in the assistant panel."
            : "Read-only. Connected clients can inspect designs, run ERC/DRC and read the BOM and Docs, but cannot change anything."}
        </p>
      )}

      {enabled && config?.launcherWarning && (
        <p className="mt-2 flex items-start gap-1.5 rounded-card border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {config.launcherWarning}
        </p>
      )}

      {enabled && claudeCode && (
        <div className="mt-3 rounded-card border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-text-secondary">
              {describeClaudeCodeStatus(status)}
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus()}
              className="rounded-control border border-border p-1 text-text-tertiary hover:bg-surface-hover"
              title="Re-check"
              aria-label="Re-check Claude Code"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(!connected || status?.updateAvailable) && (
              <button
                type="button"
                disabled={busy !== null || !status?.cliPath}
                onClick={() => {
                  // An update refreshes whatever this installation registered.
                  const mode = status?.updateAvailable && status.registeredMode === "server" ? "server" : "plugin";
                  void run(mode, () => claudeCode.connect(mode));
                }}
                className="rounded-control border border-border bg-surface-panel px-2 py-1 text-[11px] font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
              >
                {busy === "plugin" || busy === "server"
                  ? "Connecting…"
                  : connectLabel(status)}
              </button>
            )}
            {!connected && (
              <button
                type="button"
                disabled={busy !== null || !status?.cliPath}
                onClick={() => void run("server", () => claudeCode.connect("server"))}
                className="rounded-control border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                {busy === "server" ? "Connecting…" : "MCP server only"}
              </button>
            )}
            {connected && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("disconnect", () => claudeCode.disconnect())}
                className="rounded-control border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
          {result && (
            <div
              className={`mt-2 text-[11px] ${result.ok ? "text-status-success" : "text-red-600 dark:text-red-400"}`}
            >
              {result.message}
              {result.log.length > 0 && (
                <details className="mt-1 text-text-tertiary">
                  <summary className="cursor-pointer">Details</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-surface-panel p-1.5 text-[10px]">
                    {result.log
                      .map((entry) => `$ claude ${entry.args.join(" ")}  (exit ${entry.code})\n${entry.output}`)
                      .join("\n\n")}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {enabled && clients.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] font-medium uppercase tracking-wide text-text-caps">
            Connected clients
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-text-secondary">
            {clients.map((client) => (
              <li key={client.instanceId} className="flex justify-between gap-2">
                <span className="truncate">{client.clientName}</span>
                <span className="shrink-0 text-text-tertiary">
                  {client.callCount} call{client.callCount === 1 ? "" : "s"} · {relative(client.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {enabled && config && config.snippets.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-text-secondary">
            Set up by hand
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {config.snippets.map((snippet) => (
              <div key={snippet.id} className="rounded-card border border-border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-text-secondary">
                      {snippet.label}
                    </div>
                    <div className="text-[10px] text-text-tertiary">{snippet.hint}</div>
                  </div>
                  <CopyButton value={snippet.value} />
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded bg-surface-panel p-1.5 text-[10px] text-text-secondary">
                  {snippet.value}
                </pre>
              </div>
            ))}
          </div>
        </details>
      )}

      {enabled && config?.url && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-text-tertiary">
            Advanced: direct HTTP endpoint
          </summary>
          <p className="mt-1 text-[10px] text-text-tertiary">
            The port and token change every time OpenPCB starts, so a client
            configured this way must be updated after each restart. Prefer the
            options above.
          </p>
          <div className="mt-1 flex items-start justify-between gap-2">
            <pre className="min-w-0 overflow-x-auto rounded bg-surface-panel p-1.5 text-[10px] text-text-secondary">
              {`claude mcp add --transport http openpcb ${config.url} --header "Authorization: Bearer ${config.token}"`}
            </pre>
            <CopyButton
              value={`claude mcp add --transport http openpcb ${config.url} --header "Authorization: Bearer ${config.token}"`}
            />
          </div>
        </details>
      )}

      {enabled && !window.electronAPI && (
        <p className="mt-2 text-[11px] text-text-tertiary">
          Connecting Claude Code is available in the OpenPCB desktop app.
        </p>
      )}
    </section>
  );
}
