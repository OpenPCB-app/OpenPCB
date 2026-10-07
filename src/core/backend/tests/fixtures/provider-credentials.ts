import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ProviderStore } from "../../../../modules/assistant/backend/provider-store";
import {
  CredentialError,
  type SecretStore,
} from "../../../contracts/credentials/secret-store";
import type {
  CoreBackendModuleContext,
  ModuleDbClient,
} from "../../../contracts/modules/backend-module";
import type { AssistantProviderConfigInput } from "../../../../sdks/assistant";

export const CANARY = "PROVIDER_SECRET_CANARY_58483b93";
const databases: Database[] = [];
const migrationDirectory = path.join(
  import.meta.dir,
  "../../../../modules/assistant/backend/migrations",
);
export function closeProviderFixtures(): void {
  for (const database of databases.splice(0)) database.close();
}

export class FakeVault implements SecretStore {
  readonly secrets = new Map<string, string>();
  beforeRead: (() => void) | undefined;
  failWrite = false;
  failRead = false;
  mismatch = false;
  writes = 0;
  active = 0;
  maxActive = 0;

  async set(reference: string, secret: string): Promise<void> {
    this.writes++;
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    await Promise.resolve();
    this.active--;
    if (this.failWrite) throw new Error(CANARY);
    this.secrets.set(reference, secret);
  }
  async get(reference: string): Promise<string | null> {
    this.beforeRead?.();
    if (this.failRead) throw new CredentialError("LOCKED");
    return this.mismatch
      ? "wrong-value"
      : (this.secrets.get(reference) ?? null);
  }
  async delete(reference: string): Promise<void> {
    this.secrets.delete(reference);
  }
  async listRefs(): Promise<string[]> {
    return [...this.secrets.keys()];
  }
}

export function fixture(vault: SecretStore | null = new FakeVault()) {
  const database = new Database(":memory:");
  databases.push(database);
  for (const file of readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    database.exec(readFileSync(path.join(migrationDirectory, file), "utf8"));
  }
  let failCommit = false;
  const values = new Map<string, unknown>([["core.secret-store", vault]]);
  const db: ModuleDbClient = {
    moduleId: "assistant",
    tablePrefix: "assistant_",
    db: database,
    rawSql<T>(query: string, params: unknown[] = []): T[] {
      const statement = database.query(query);
      const bindings = params as (string | number | null)[];
      if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(query))
        return statement.all(...bindings) as T[];
      statement.run(...bindings);
      return [];
    },
    transaction<T>(operation: (transaction: unknown) => T): T {
      return database.transaction(() => {
        const value = operation(undefined);
        if (failCommit) throw new Error("synthetic DB commit failure");
        return value;
      })();
    },
  };
  const ctx = {
    moduleId: "assistant",
    manifest: {} as CoreBackendModuleContext["manifest"],
    db,
    sdk: {
      get: <T>(token: string) => (values.get(token) ?? null) as T | null,
      has: (token: string) => values.has(token),
      registerValue: <T>(token: string, value: T) => {
        values.set(token, value);
      },
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  } as CoreBackendModuleContext;
  const store = new ProviderStore(ctx);
  return {
    database,
    store,
    ctx,
    failCommits: (value: boolean) => {
      failCommit = value;
    },
  };
}

export function input(
  overrides: AssistantProviderConfigInput = {},
): AssistantProviderConfigInput {
  return {
    label: "Fixture",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:43210/v1",
    defaultModel: "fixture-model",
    enabled: true,
    ...overrides,
  };
}

export function insertLegacy(
  database: Database,
  providerId = "legacy",
  secret = CANARY,
): void {
  database
    .query(
      "INSERT INTO assistant_provider_config (id,label,kind,base_url,api_key,default_model,enabled,is_builtin,created_at,updated_at) VALUES (?, 'Legacy', 'openai', 'https://api.openai.com/v1', ?, 'fixture-model', 1, 0, 'before', 'before')",
    )
    .run(providerId, secret);
}

export function credentialRow(database: Database, providerId: string) {
  return database
    .query(
      "SELECT api_key,secret_ref FROM assistant_provider_config WHERE id=?",
    )
    .get(providerId) as {
    api_key: string | null;
    secret_ref: string | null;
  };
}
