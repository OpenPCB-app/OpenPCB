import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CompletedOnlyProviderClient } from "agentkit/testing";
import type { AiProviderClient } from "agentkit/core";
import type { ProposalApplier } from "agentkit/host";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";
import type { OpenPcbAgentKitHost } from "../agentkit-host";
import { ProviderStore } from "../provider-store";

export const nativeBinding = process.env.OPENPCB_AGENTKIT_TEST_NATIVE_BINDING;
export const CANARY = "AGENTKIT_KEY_CANARY_773a8a12";
export const applier: ProposalApplier = {
  apply: async () => { throw new Error("No domain apply expected in host tests"); },
  getOutcome: async () => null,
};

export function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "openpcb-agentkit-host-"));
  const database = new Database(join(directory, "openpcb.sqlite"), { nativeBinding });
  for (const name of readdirSync("src/modules/assistant/backend/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(join("src/modules/assistant/backend/migrations", name), "utf8"));
  }
  const secrets = new Map<string, string>();
  const vault = {
    get: async (reference: string) => secrets.get(reference) ?? null,
    set: async (reference: string, value: string) => { secrets.set(reference, value); },
    delete: async (reference: string) => { secrets.delete(reference); },
    listRefs: async () => [...secrets.keys()],
  };
  const context: CoreBackendModuleContext = {
    moduleId: "assistant", manifest: {} as CoreBackendModuleContext["manifest"],
    db: { moduleId: "assistant", tablePrefix: "assistant_", db: database,
      rawSql<T>(query: string, params: unknown[] = []): T[] {
        const statement = database.prepare(query);
        if (statement.reader) return statement.all(...params) as T[];
        statement.run(...params); return [];
      },
      transaction: (operation) => database.transaction(() => operation(undefined))(),
    },
    sdk: { get: <T>() => vault as T, has: () => true, registerValue: () => {} },
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  };
  return { directory, database, context, providers: new ProviderStore(context),
    nativeBinding, databasePath: join(directory, "agentkit.sqlite"), applicationDatabasePath: join(directory, "openpcb.sqlite"),
    cleanup: () => { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

export function completed(): AiProviderClient {
  const provider = new CompletedOnlyProviderClient();
  provider.setScript([{ content: "Host answer" }]);
  return provider;
}

export async function waitTerminal(host: OpenPcbAgentKitHost, taskId: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const task = await host.store.tasks.getTask(taskId);
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((done) => setTimeout(done, 5));
  }
  throw new Error("Task did not settle");
}

export async function addProvider(providers: ProviderStore, model = "model-one") {
  return providers.createProvider({ label: "Fixture", kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:43101/v1", defaultModel: model, enabled: true, apiKey: CANARY });
}
