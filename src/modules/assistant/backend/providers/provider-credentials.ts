import {
  CredentialError,
  isSecretReference,
  publicCredentialError,
  type SecretStore,
} from "../../../../core/contracts/credentials/secret-store";
import type { CoreBackendModuleContext } from "../../../../core/contracts/modules/backend-module";

interface CredentialRow {
  api_key: string | null;
  secret_ref: string | null;
}

const locks = new WeakMap<object, Map<string, Promise<unknown>>>();

/** Credentials stay in the trusted process. Historical refs remain valid for pinned runs. */
export class ProviderCredentials {
  private readonly pending: Map<string, Promise<unknown>>;

  constructor(private readonly ctx: CoreBackendModuleContext) {
    let pending = locks.get(ctx.db);
    if (!pending) locks.set(ctx.db, (pending = new Map()));
    this.pending = pending;
  }

  async serialize<T>(
    providerId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.pending.get(providerId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(providerId, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(providerId) === next)
        this.pending.delete(providerId);
    }
  }

  async write(secret: string): Promise<string> {
    if (
      !secret.trim() ||
      new TextEncoder().encode(secret).length > 16 * 1024 ||
      /[\u0000-\u001f\u007f]/.test(secret)
    ) {
      throw new CredentialError("INVALID_REQUEST");
    }
    const vault = this.vault();
    const reference = `provider/${crypto.randomUUID()}`;
    try {
      await vault.set(reference, secret);
      if ((await vault.get(reference)) !== secret) {
        throw new CredentialError("WRITE_FAILED");
      }
      return reference;
    } catch (error) {
      throw error instanceof CredentialError
        ? error
        : new CredentialError("WRITE_FAILED");
    }
  }

  async resolve(reference: string): Promise<string> {
    if (!isSecretReference(reference) || !reference.startsWith("provider/")) {
      throw new CredentialError("INVALID_REQUEST");
    }
    try {
      const secret = await this.vault().get(reference);
      if (!secret) throw new CredentialError("RECONNECT_REQUIRED");
      return secret;
    } catch (error) {
      throw publicCredentialError(error);
    }
  }

  async migrate(providerId: string): Promise<void> {
    await this.serialize(providerId, async () => {
      const prior = this.row(providerId);
      if (!prior?.api_key) return;
      const reference = await this.write(prior.api_key);
      this.associate(providerId, prior, reference);
    });
  }

  row(providerId: string): CredentialRow | undefined {
    return this.ctx.db.rawSql<CredentialRow>(
      "SELECT api_key, secret_ref FROM assistant_provider_config WHERE id=?",
      [providerId],
    )[0];
  }

  associate(
    providerId: string,
    prior: CredentialRow,
    reference: string | null,
  ): void {
    this.ctx.db.transaction(() => {
      const current = this.row(providerId);
      if (
        !current ||
        current.api_key !== prior.api_key ||
        current.secret_ref !== prior.secret_ref
      ) {
        throw new CredentialError("WRITE_FAILED");
      }
      this.ctx.db.rawSql(
        "UPDATE assistant_provider_config SET secret_ref=?, api_key=NULL, updated_at=? WHERE id=?",
        [reference, new Date().toISOString(), providerId],
      );
    });
  }

  private vault(): SecretStore {
    const vault = this.ctx.sdk.get<SecretStore>("core.secret-store");
    if (!vault) throw new CredentialError("UNAVAILABLE");
    return vault;
  }
}
