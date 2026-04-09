import type { SdkRegistryHandle } from "../../contracts/modules/backend-module";

interface RegistryEntry<T> {
  factory?: () => T;
  value?: T;
  initialized: boolean;
}

export class RuntimeSdkRegistry implements SdkRegistryHandle {
  private readonly entries = new Map<string, RegistryEntry<unknown>>();

  registerValue<T>(token: string, value: T): void {
    this.entries.set(token, {
      value,
      initialized: true,
    });
  }

  registerFactory<T>(token: string, factory: () => T): void {
    this.entries.set(token, {
      factory,
      initialized: false,
    });
  }

  has(token: string): boolean {
    return this.entries.has(token);
  }

  /**
   * Lookup an SDK by token. Returns null if missing or uninitialised-without-factory.
   * This is the non-throwing variant used by the `SdkRegistryHandle` contract.
   */
  get<T>(token: string): T | null {
    const entry = this.entries.get(token);
    if (!entry) {
      return null;
    }
    if (!entry.initialized) {
      if (!entry.factory) {
        return null;
      }
      entry.value = entry.factory();
      entry.initialized = true;
    }
    return (entry.value ?? null) as T | null;
  }

  /**
   * Lookup an SDK by token, throwing if not found. For call sites that want
   * a hard failure on misconfiguration (e.g. tests, module consumers).
   */
  resolve<T>(token: string): T {
    const value = this.get<T>(token);
    if (value === null) {
      throw new Error(`SDK token not registered: ${token}`);
    }
    return value;
  }

  listTokens(): string[] {
    return [...this.entries.keys()].sort();
  }
}
