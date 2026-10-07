import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { startBackendRuntime, type StartedBackendRuntime } from "../../../src/core/backend/runtime";
import { buildCoreLibraryFixture } from "../../../src/core/backend/tests/helpers/core-library-fixture-data";
import { startFixtureModel } from "./assistant-agentkit-model";

let runtime: StartedBackendRuntime | undefined;
let model: Awaited<ReturnType<typeof startFixtureModel>> | undefined;

process.on("message", (message: { origin?: string; stop?: boolean }) => {
  if (message.stop) { void stop(); return; }
  if (message.origin) void start(message.origin).catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown startup error";
    process.send?.({ error: `Isolated AgentKit runtime could not start: ${detail.replace(/[0-9a-f]{64}/gi, "[REDACTED]")}` });
    void stop();
  });
});

async function start(origin: string): Promise<void> {
  const directory = process.env.APP_DATA_DIR;
  if (!directory) throw new Error("Isolated app data directory is required");
  const token = randomBytes(32).toString("hex");
  const bundle = path.join(directory, "test-core.opclib");
  await writeFile(bundle, buildCoreLibraryFixture());
  process.env.OPENPCB_BUNDLED_LIBRARY_PATH = bundle;
  model = await startFixtureModel();
  const secrets = new Map<string, string>();
  runtime = await startBackendRuntime({ host: "127.0.0.1", port: 0,
    localApi: { token, rendererOrigins: [origin] }, secretStore: {
      async get(reference) { return secrets.get(reference) ?? null; },
      async set(reference, value) { secrets.set(reference, value); },
      async delete(reference) { secrets.delete(reference); },
      async listRefs() { return [...secrets.keys()]; },
    } });
  for (const id of ["assistant", "designer", "library"]) {
    if (!runtime.snapshot.loadedModules.includes(id)) throw new Error(`Required module ${id} did not load`);
  }
  const api = async (route: string, body?: unknown, method = "POST") => {
    const response = await fetch(`${runtime!.url}/api/modules/${route}`, {
      method, headers: { "X-OpenPCB-Token": token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Fixture setup failed: ${route} ${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  const componentId = await importCapacitor(api);
  model.setComponentId(componentId);
  await api("assistant/v1/providers/lmstudio", { enabled: true, baseUrl: model.url, defaultModel: "fixture-native" }, "PATCH");
  await api("assistant/v1/providers/lmstudio/models/refresh");
  await api("assistant/v1/providers/lmstudio/capabilities/refresh");
  await api("assistant/v1/settings", { defaultProviderId: "lmstudio", defaultModel: "fixture-native" }, "PATCH");
  process.send?.({ ready: true, bootstrap: { url: runtime.url, token }, port: runtime.port, componentId });
}

async function importCapacitor(api: (route: string, body?: unknown) => Promise<Record<string, unknown>>): Promise<string> {
  const fixtures = path.resolve("src/core/backend/tests/fixtures/assistant-parity");
  const input = { symbolLibrary: { fileName: "C.kicad_sym", content: await readFile(path.join(fixtures, "capacitor.kicad_sym"), "utf8") },
    footprints: [{ fileName: "C_0603_1608Metric.kicad_mod", content: await readFile(path.join(fixtures, "capacitor.kicad_mod"), "utf8") }] };
  const inspected = await api("library/imports/kicad/inspect", input) as { data: { symbols: Array<{ id: string }>; footprints: Array<{ id: string }> } };
  const imported = await api("library/imports/kicad", { ...input,
    selection: { symbolId: inspected.data.symbols[0]!.id, footprintId: inspected.data.footprints[0]!.id },
    component: { name: "E2E Fixture Capacitor", description: "Real KiCad import for browser regression" } }) as { data: { componentId: string } };
  return imported.data.componentId;
}

async function stop(): Promise<void> {
  try { await model?.close(); await runtime?.close(); }
  finally { process.disconnect?.(); process.exit(0); }
}
