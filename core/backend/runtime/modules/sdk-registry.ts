interface RegistryEntry<T> {
  factory?: () => T;
  value?: T;
  initialized: boolean;
}

export class RuntimeSdkRegistry {
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

  resolve<T>(token: string): T {
    const entry = this.entries.get(token);
    if (!entry) {
      throw new Error(`SDK token not registered: ${token}`);
    }
    if (!entry.initialized) {
      if (!entry.factory) {
        throw new Error(`SDK token ${token} has no factory`);
      }
      entry.value = entry.factory();
      entry.initialized = true;
    }
    return entry.value as T;
  }

  listTokens(): string[] {
    return [...this.entries.keys()].sort();
  }
}
