import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CoreBackendModuleContext } from "../../../../contracts/modules/backend-module";
import { createModuleDb } from "../../../db/module-db-factory";
import { resetSharedSqliteForTesting } from "../../../db/sqlite-client";
import { createLogger } from "../../../logging/logger";
import { MentionRegistry } from "../../../mentions";
import { applyModuleMigrations } from "../../../migrations/module-migrator";
import { RuntimeSdkRegistry } from "../../../modules/sdk-registry";
import { ProviderStore } from "../../../../../modules/assistant/backend/provider-store";
import { SettingsStore } from "../../../../../modules/assistant/backend/settings-store";
import { ContextResolver } from "../../../../../modules/assistant/backend/context-resolver";
import { NativeContextStore } from "../../../../../modules/assistant/backend/agentkit/native-context-store";
import { buildOpenpcbToolRegistry } from "../../../../../modules/assistant/backend/tools/openpcb-tool-registry";
import { buildDesignerSdk } from "../../../../../modules/designer/backend/sdk";
import { buildSdk } from "../../../../../modules/library/backend/queries";
import { commitKicadImport } from "../../../../../modules/library/backend/import/commit-kicad";
import { buildInspectResponse } from "../../../../../modules/library/backend/import/inspect-kicad";
import { MODULE_SDK_TOKENS } from "../../../../../sdks";

const MODULES_ROOT = path.resolve(import.meta.dir, "../../../../../modules");
export const UI_SESSION = "designer-ui-session";

function context(moduleId: string, sdk: RuntimeSdkRegistry): CoreBackendModuleContext {
  return {
    moduleId,
    db: createModuleDb(moduleId),
    sdk,
    logger: createLogger(`assistant-parity.${moduleId}`),
    manifest: {
      id: moduleId, label: moduleId, version: "0.1.0", apiVersion: 2,
      namespace: `space.${moduleId}`, kind: "space", enabled: true,
      availability: "all", defaultPinned: false, dependsOn: [],
      sidebar: { label: moduleId, icon: "Box", order: 0 },
      runtime: { backendEntry: "module.backend.ts", frontendEntry: "module.frontend.ts" },
    },
  };
}

async function importFixture(ctx: CoreBackendModuleContext): Promise<string> {
  const existing = ctx.db.rawSql<{ id: string }>(
    "SELECT id FROM library_components WHERE name = ?", ["Parity Capacitor"],
  )[0];
  if (existing) return existing.id;
  const input = {
    symbolLibrary: { fileName: "C.kicad_sym", content: await Bun.file(path.join(import.meta.dir, "capacitor.kicad_sym")).text() },
    footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: await Bun.file(path.join(import.meta.dir, "capacitor.kicad_mod")).text() }],
  };
  const inspected = buildInspectResponse(input);
  return commitKicadImport(ctx, {
    ...input,
    selection: { symbolId: inspected.symbols[0]!.id, footprintId: inspected.footprints[0]!.id },
    component: { name: "Parity Capacitor", description: "Deterministic assistant domain fixture" },
  }).componentId;
}

/** Real app migrations, library import and designer; no assistant engine or bundled-pack bootstrap. */
export async function openDomain(dbPath: string) {
  resetSharedSqliteForTesting();
  process.env.OPENPCB_DB_PATH = dbPath;
  MentionRegistry.init();
  const sdk = new RuntimeSdkRegistry();
  const secrets = new Map<string, string>();
  sdk.registerValue("core.secret-store", {
    async get(reference: string): Promise<string | null> { return secrets.get(reference) ?? null; },
    async set(reference: string, secret: string): Promise<void> { secrets.set(reference, secret); },
    async delete(reference: string): Promise<void> { secrets.delete(reference); },
    async listRefs(): Promise<string[]> { return [...secrets.keys()]; },
  });
  for (const id of ["library", "designer", "tasks", "assistant"]) {
    const report = await applyModuleMigrations(id, path.join(MODULES_ROOT, id, "backend/migrations"));
    if (report.failed) throw new Error(`${id}/${report.failed.name}: ${report.failed.error}`);
  }
  const libraryCtx = context("library", sdk);
  sdk.registerValue(MODULE_SDK_TOKENS.LIBRARY, buildSdk(libraryCtx));
  const designer = buildDesignerSdk(context("designer", sdk));
  sdk.registerValue(MODULE_SDK_TOKENS.DESIGNER, designer);
  const ctx = context("assistant", sdk);
  const providers = new ProviderStore(ctx);
  const settings = new SettingsStore(ctx, providers);
  const contextStore = new NativeContextStore(ctx);
  const contextResolver = new ContextResolver(ctx, contextStore);
  const registry = buildOpenpcbToolRegistry(ctx, contextResolver, undefined, { allowRawToolData: false });
  return { ctx, designer, providers, settings, contextStore, contextResolver, registry, componentId: await importFixture(libraryCtx) };
}

export async function isolatedDomain() {
  const previousDb = process.env.OPENPCB_DB_PATH;
  const dir = await mkdtemp(path.join(os.tmpdir(), "openpcb-assistant-parity-"));
  const dbPath = path.join(dir, "fixture.sqlite");
  const cleanup = async (): Promise<void> => {
    resetSharedSqliteForTesting();
    if (previousDb === undefined) delete process.env.OPENPCB_DB_PATH;
    else process.env.OPENPCB_DB_PATH = previousDb;
    await rm(dir, { recursive: true, force: true });
  };
  let domain: Awaited<ReturnType<typeof openDomain>>;
  try { domain = await openDomain(dbPath); }
  catch (error) { await cleanup(); throw error; }
  return {
    ...domain, dbPath,
    async close(): Promise<void> {
      await cleanup();
    },
  };
}

export type ParityDomain = Awaited<ReturnType<typeof isolatedDomain>>;
