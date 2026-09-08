/**
 * Feature-flag registry — single source of truth for build-target gating of
 * individual features (finer-grained than the whole-module `availability` gate
 * in `../modules/manifest`).
 *
 * This file is intentionally pure: it declares the flags and the evaluation
 * rule, but never touches `import.meta.env` / `process.env`. Runtime adapters
 * supply the environment primitive:
 *   - frontend: `src/core/frontend/src/feature-flags`  (import.meta.env.DEV)
 *   - backend:  `src/core/backend/feature-flags`       (process.env.NODE_ENV)
 *
 * To graduate a feature to production, flip its `availability` from "dev" to
 * "all". To add a new (non-cloud) gated feature, add one entry here and check it
 * at the surface with `isFeatureEnabled(...)` / `useFeatureFlag(...)`.
 */

import type { ModuleAvailability } from "../modules/manifest";

/**
 * Reuses the module-manifest vocabulary, plus one flag-only value:
 * - "all": shipped to production (always enabled).
 * - "dev": dev-only (enabled when the runtime is not a production build).
 * - "prod": production-only (enabled ONLY in packaged builds; dev/test default off).
 */
export type FeatureAvailability = ModuleAvailability | "prod";

export interface FeatureFlagDef {
  /** Human-readable description of what the flag gates. */
  description: string;
  /** Build-target gate. "dev" = hidden from release builds. */
  availability: FeatureAvailability;
}

/**
 * All declared feature flags. Cloud features are dev-only until their backing
 * services + UX are production-ready.
 */
export const FEATURE_FLAGS = {
  "cloud.auth": {
    // Graduated to prod for the Cloud Copilot pro-tier beta: login + session are the
    // prerequisite for tier gating (the desktop reads app_metadata.tier from the session).
    availability: "all",
    description: "Cloud sign-in/session + invite acceptance (cloud foundation)",
  },
  "cloud.sync": {
    // Graduated to prod: Copilot requires a cloud-linked design (link/sync routes live
    // behind this flag). Copilot/auto-layout access itself is gated at runtime by tier=pro.
    availability: "all",
    description:
      "Project cloud sync (command mirroring, sync badge, prefs toggle)",
  },
  "cloud.designBrowser": {
    availability: "dev",
    description: "Browse and import designs from the cloud workspace",
  },
  "cloud.presence": {
    availability: "dev",
    description: "Realtime collaborator presence avatars",
  },
  "cloud.comments": {
    availability: "dev",
    description: "Comment cloud sync (local comments are unaffected)",
  },
  "cloud.autolayout": {
    // Graduated to prod for the pro-tier beta. The button/modal are additionally gated
    // at runtime on tier=pro (UI), and cloud-auto-layout enforces pro server-side.
    availability: "all",
    description:
      "Cloud Auto-Layout (unified auto-place + auto-route: BoardSnapshot → placement/trace/via proposals)",
  },
  "cloud.library": {
    availability: "dev",
    description: "Custom library cloud push/pull + core-lib update check",
  },
  "cloud.componentSearch": {
    availability: "dev",
    description: "AI-powered cloud component search",
  },
  "cloud.assistantProviders": {
    availability: "dev",
    description: "Cloud assistant provider presets (OpenAI / OpenRouter)",
  },
  "cloud.copilot": {
    // Graduated to prod for the pro-tier beta. Visible only when a copilot URL is
    // configured AND the signed-in user is tier=pro (UI); cloud-copilot enforces pro
    // server-side on every route (the real boundary).
    availability: "all",
    description:
      "Cloud Copilot chat mode (agent runs on the cloud-copilot service; proposals mirrored locally)",
  },
  "pcb.advancedVias": {
    availability: "dev",
    description:
      "Accept blind/buried/micro via spans in via commands (data + DRC only; no picker UI). Through vias stay the only kind the route tool emits.",
  },
  "pcb.routeAutoFinish": {
    availability: "dev",
    description:
      "Route tool: Tab / Ctrl+Click proposes an A*-completed path to the target pad as an explicit-accept preview (never auto-commits).",
  },
  "pcb.routeWalkaround": {
    availability: "dev",
    description:
      "Route tool: pending ghost segment locally bends around obstacles (walkaround-lite; no push-and-shove).",
  },
  "pcb.lengthTuning": {
    availability: "dev",
    description:
      "Length matching: match-group rules + routed-length gauges + DRC length check + meander Tune tool.",
  },
  "pcb.bundleRouting": {
    availability: "dev",
    description:
      "Bundle routing: collect same-side pads, route one centerline, commit N parallel lanes atomically (diff pairs auto-detected by _P/_N and +/- net-name suffixes).",
  },
  "mcp.server": {
    availability: "dev",
    description:
      "MCP server (Streamable HTTP at /api/modules/assistant/mcp + bundled stdio shim) exposing the assistant tool registry to external agents. Graduate to 'all' after a bake cycle — it opens a scripted write path into designs.",
  },
  "dataset.capture": {
    availability: "prod",
    description:
      "Full command-log session capture + dataset upload (internal training data; default OFF in dev/test builds, ON in packaged builds)",
  },
} satisfies Record<string, FeatureFlagDef>;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

/**
 * Pure evaluation of a single flag.
 *
 * Precedence: an explicit `override` (from an env var) always wins, so a flag
 * can be force-enabled (QA in a release build) or force-disabled in any build.
 * Otherwise "all" flags are always on, "dev" flags follow `isDev`, and "prod"
 * flags are the inverse (packaged builds only).
 */
export function evaluateFeatureFlag(
  def: FeatureFlagDef,
  ctx: { isDev: boolean; override?: boolean },
): boolean {
  if (ctx.override !== undefined) return ctx.override;
  if (def.availability === "all") return true;
  if (def.availability === "prod") return !ctx.isDev;
  return ctx.isDev;
}

/**
 * Env-var key for a flag's override, shared by both runtime adapters (only the
 * prefix differs): "cloud.autolayout" → "CLOUD_AUTOLAYOUT".
 */
export function featureFlagEnvSuffix(name: FeatureFlagName): string {
  return name.toUpperCase().replace(/[.-]/g, "_");
}

/** Parse an override env value. Returns undefined when unset/blank. */
export function parseOverride(
  raw: string | undefined | null,
): boolean | undefined {
  if (raw == null) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "") return undefined;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  return undefined;
}
