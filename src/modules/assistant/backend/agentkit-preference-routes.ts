import { Type } from "@sinclair/typebox";
import type { ModuleRouterHandle } from "../../../core/contracts/modules/backend-module";
import { ValidationError } from "../../../core/contracts/errors";
import type { AgentKitHttpService } from "./agentkit-routes";
import { json, readInput, safeRoute } from "./agentkit-http-input";
import {
  PREFERENCE_PROVIDER_KINDS, preferenceToolCalling, providerPreferenceDto,
  refreshPreferenceCapabilities, refreshPreferenceModels, requirePreferenceProvider,
  settingsPreferenceDto, testPreferenceProvider,
} from "./agentkit/provider-preferences";

const ProviderInput = Type.Object({
  label: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  kind: Type.Optional(Type.Union(PREFERENCE_PROVIDER_KINDS.map((kind) => Type.Literal(kind)))),
  baseUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
  defaultModel: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  enabled: Type.Optional(Type.Boolean()),
});
const PROVIDER_FIELDS = ["label", "kind", "baseUrl", "defaultModel", "enabled"] as const;
const SettingsInput = Type.Object({
  defaultProviderId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  defaultPromptPresetId: Type.Optional(Type.Union([
    Type.Literal("strict-grounded"), Type.Literal("friendly-tutorial"), Type.Literal("minimal-concise"),
  ])),
  contextSizePreference: Type.Optional(Type.Union([Type.Literal("small"), Type.Literal("medium"), Type.Literal("large")])),
  allowRawToolData: Type.Optional(Type.Boolean()),
  toolExecutionPolicy: Type.Optional(Type.Union([
    Type.Literal("auto_readonly_confirm_writes"), Type.Literal("confirm_all_writes"), Type.Literal("auto_all"),
  ])),
  mcpEnabled: Type.Optional(Type.Boolean()),
  mcpAllowWrites: Type.Optional(Type.Boolean()),
});
const SETTINGS_FIELDS = Object.keys(SettingsInput.properties);
const ToolCallingInput = Type.Object({ mode: Type.Union([
  Type.Literal("auto"), Type.Literal("on"), Type.Literal("off"),
]) });
const TestInput = Type.Object({ includeCompletion: Type.Optional(Type.Boolean()) });
const CanonicalSettingsInput = Type.Object({
  defaultProviderId: SettingsInput.properties.defaultProviderId,
  defaultModel: ProviderInput.properties.defaultModel,
  contextSizePreference: SettingsInput.properties.contextSizePreference,
  writePolicyMode: SettingsInput.properties.toolExecutionPolicy,
  allowRawToolData: SettingsInput.properties.allowRawToolData,
  toolCalling: Type.Optional(ToolCallingInput.properties.mode),
});

/** App-owned preferences retain the desktop credential owner and opaque public DTOs. */
export function registerAgentKitPreferenceRoutes(router: ModuleRouterHandle, service: AgentKitHttpService): void {
  for (const prefix of ["", "/v1"]) {
    registerProviders(router, service, prefix);
    router.get(`${prefix}/settings`, safeRoute(() => json(prefix
      ? settingsPreferenceDto(service.host.settings, service.host.providers)
      : service.host.settings.getSettings())));
    const update = safeRoute(async ({ req }) => {
      if (prefix) return json(await updateCanonicalSettings(service, req));
      return json(service.host.settings.updateSettings(await readInput(req, SettingsInput, SETTINGS_FIELDS)));
    });
    router.patch(`${prefix}/settings`, update);
    router.put(`${prefix}/settings`, update);
    router.get(`${prefix}/prompt-presets`, () => json(service.prompts.listPresets()));
  }
}

async function updateCanonicalSettings(service: AgentKitHttpService, req: Request) {
  const input = await readInput(req, CanonicalSettingsInput, Object.keys(CanonicalSettingsInput.properties));
  const { providers, settings } = service.host;
  const providerId = input.defaultProviderId ?? settings.getSettings().defaultProviderId;
  requirePreferenceProvider(providers, providerId);
  if (input.defaultModel !== undefined) await providers.updateProvider(providerId, { defaultModel: input.defaultModel });
  if (input.toolCalling !== undefined) providers.setToolCallingMode(providerId, input.toolCalling);
  settings.updateSettings({
    defaultProviderId: input.defaultProviderId, contextSizePreference: input.contextSizePreference,
    allowRawToolData: input.allowRawToolData, toolExecutionPolicy: input.writePolicyMode,
  });
  return settingsPreferenceDto(settings, providers);
}

function registerProviders(router: ModuleRouterHandle, service: AgentKitHttpService, prefix: string): void {
  const providers = service.host.providers;
  const path = `${prefix}/providers`;
  const parameter = prefix ? "providerId" : "id";
  const project = prefix ? providerPreferenceDto : (provider: ReturnType<typeof requirePreferenceProvider>) => provider;
  router.get(path, safeRoute(() => json(providers.listProviders().map(project))));
  router.post(path, safeRoute(async ({ req }) => json(
    project(await providers.createProvider(await readInput(req, ProviderInput, PROVIDER_FIELDS))), 201,
  )));
  router.get(`${path}/:${parameter}`, safeRoute(({ params }) => json(project(
    requirePreferenceProvider(providers, params.getOrThrow(parameter)),
  ))));
  const update = safeRoute(async ({ req, params }) => json(project(await providers.updateProvider(
    params.getOrThrow(parameter), await readInput(req, ProviderInput, PROVIDER_FIELDS),
  ))));
  router.patch(`${path}/:${parameter}`, update);
  router.put(`${path}/:${parameter}`, update);
  router.delete(`${path}/:${parameter}`, safeRoute(async ({ params }) => {
    await providers.deleteProvider(params.getOrThrow(parameter));
    return prefix ? new Response(null, { status: 204 }) : json({ ok: true });
  }));
  registerProviderOperations(router, service, `${path}/:${parameter}`, parameter, Boolean(prefix));
}

function registerProviderOperations(
  router: ModuleRouterHandle, service: AgentKitHttpService, item: string, parameter: string, canonical: boolean,
): void {
  const providers = service.host.providers;
  router.get(`${item}/models`, safeRoute(({ params }) => {
    const id = params.getOrThrow(parameter);
    requirePreferenceProvider(providers, id);
    return json(providers.listModels(id));
  }));
  router.post(`${item}/models/refresh`, safeRoute(async ({ req, params }) => {
    await optionalInput(req, false);
    return json(await refreshPreferenceModels(providers, params.getOrThrow(parameter), req.signal));
  }));
  router.post(`${item}/test`, safeRoute(async ({ req, params }) => {
    const input = await optionalInput(req, true);
    const result = await testPreferenceProvider(providers, params.getOrThrow(parameter), Boolean(input.includeCompletion), req.signal);
    return json(canonical ? { ok: result.ok, ...(!result.ok ? { error: result.message } : {}) } : result);
  }));
  router.get(`${item}/capabilities`, safeRoute(({ params }) => {
    const id = params.getOrThrow(parameter);
    requirePreferenceProvider(providers, id);
    return json(providers.getCapabilities(id));
  }));
  router.post(`${item}/capabilities/refresh`, safeRoute(async ({ req, params }) => {
    await optionalInput(req, false);
    return json(await refreshPreferenceCapabilities(providers, params.getOrThrow(parameter), req.signal));
  }));
  router.get(`${item}/tool-calling`, safeRoute(({ params }) => json(
    preferenceToolCalling(providers, params.getOrThrow(parameter)),
  )));
  router.put(`${item}/tool-calling`, safeRoute(async ({ req, params }) => {
    const { mode } = await readInput(req, ToolCallingInput, ["mode"]);
    const id = params.getOrThrow(parameter);
    requirePreferenceProvider(providers, id);
    providers.setToolCallingMode(id, mode);
    return json(preferenceToolCalling(providers, id));
  }));
}

async function optionalInput(req: Request, test: boolean): Promise<{ includeCompletion?: boolean }> {
  const text = await req.text();
  if (!text.trim()) return {};
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new ValidationError("Request body must be JSON");
  }
  return readInput(new Request(req.url, { method: "POST", body: text }),
    test ? TestInput : Type.Object({}), test ? ["includeCompletion"] : []);
}
