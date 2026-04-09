import { ValidationError } from "../contracts/errors";

export class RouteParams {
  constructor(private readonly params: Record<string, string>) {}

  get(name: string): string | undefined {
    return this.params[name];
  }

  getOrThrow(name: string): string {
    const value = this.params[name];
    if (!value) {
      throw new ValidationError(`Required parameter \"${name}\" missing`);
    }
    return value;
  }

  getInt(name: string, defaultValue?: number): number {
    const value = this.params[name];
    if (!value) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      throw new ValidationError(`Required parameter \"${name}\" missing`);
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      throw new ValidationError(`Parameter \"${name}\" must be an integer`);
    }
    return parsed;
  }

  all(): Record<string, string> {
    return { ...this.params };
  }
}
