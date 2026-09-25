/// <reference types="vite/client" />

declare global {
  interface ElectronBackendPayload {
    url: string;
    port: number;
    startupContractVersion?: number;
    startupLicenseState?: string;
    startupLicenseCode?: string;
  }

  interface ElectronSecureStorage {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  }

  interface ElectronPreferences {
    getTelemetryOptIn(): Promise<boolean>;
    setTelemetryOptIn(value: boolean): Promise<void>;
  }

  interface AppVersions {
    app: string;
    electron: string;
    chromium: string;
    node: string;
    v8: string;
    platform: string;
    arch: string;
    osRelease: string;
  }

  interface FolderOpenResult {
    dir: string;
    error: string | null;
  }

  interface ElectronAPI {
    /** Dev-only marketing-capture flag (OPENPCB_CAPTURE=1); absent in normal runs. */
    captureMode?: boolean;
    onBackendReady: (
      callback: (payload: ElectronBackendPayload) => void,
    ) => void;
    getBackendUrl: () => Promise<ElectronBackendPayload | null>;
    getDiagnosticsPaths?: () => Promise<{
      logs: string;
      crashDumps: string;
      userData: string;
      appVersion: string;
    }>;
    getAppVersions?: () => Promise<AppVersions>;
    getMcpConfig?: () => Promise<McpConfig>;
    claudeCode?: ElectronClaudeCode;
    openLogsFolder?: () => Promise<FolderOpenResult>;
    openCrashDumpsFolder?: () => Promise<FolderOpenResult>;
    openUserDataFolder?: () => Promise<FolderOpenResult>;
    secureStorage?: ElectronSecureStorage;
    preferences?: ElectronPreferences;
    openExternal?: (url: string) => Promise<void>;
    window?: {
      setOverlayTheme: (theme: {
        color: string;
        symbolColor: string;
      }) => Promise<void>;
    };
  }

  /** Mirrors the `mcp:config` IPC payload in electron/src/main/diagnostics-ipc.ts. */
  interface McpConfig {
    /** Stable launcher in the user-data dir; null if it could not be installed. */
    launcherPath: string | null;
    /** Set when the app runs from a temporary location (macOS translocation). */
    launcherWarning: string | null;
    /** Local Claude Code plugin marketplace; null if not written. */
    marketplaceDir: string | null;
    snippets: Array<{ id: string; label: string; hint: string; value: string }>;
    portfilePath: string;
    /** Streamable HTTP endpoint; null until the backend is listening. */
    url: string | null;
    token: string;
  }

  /** Mirrors ClaudeCodeStatus in electron/src/main/claude-code-cli.ts. */
  interface ClaudeCodeStatus {
    cliPath: string | null;
    cliVersion: string | null;
    plugin: { installed: boolean; version: string | null; enabled: boolean };
    marketplace: { registered: boolean; path: string | null };
    server: { registered: boolean; ownedByOpenPcb: boolean };
    updateAvailable: boolean;
  }

  /** Mirrors ActionResult in electron/src/main/claude-code-cli.ts. */
  interface ClaudeCodeActionResult {
    ok: boolean;
    message: string;
    log: Array<{ args: string[]; code: number; output: string }>;
  }

  interface ElectronClaudeCode {
    status(): Promise<ClaudeCodeStatus>;
    connect(mode: "plugin" | "server"): Promise<ClaudeCodeActionResult>;
    disconnect(): Promise<ClaudeCodeActionResult>;
  }

  // Mirrors UpdaterState in electron/src/main/updater.ts.
  type UpdaterStatus =
    | { state: "checking" }
    | { state: "current" }
    | { state: "available"; version: string; notes: string | null }
    | { state: "available-manual"; version: string; url: string }
    | { state: "downloaded"; version: string }
    | { state: "error"; message: string };

  interface UpdaterProgress {
    percent: number;
    transferred: number;
    total: number;
  }

  interface ElectronUpdater {
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    openReleases(): Promise<void>;
    onStatus(callback: (status: UpdaterStatus) => void): void;
    onProgress(callback: (progress: UpdaterProgress) => void): void;
  }

  interface Window {
    electronAPI?: ElectronAPI;
    updater?: ElectronUpdater;
  }
}

export {};
