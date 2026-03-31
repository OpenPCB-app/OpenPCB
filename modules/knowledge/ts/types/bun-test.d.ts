declare module "bun:test" {
  export function describe(name: string, callback: () => void | Promise<void>): void;
  export function it(name: string, callback: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
  };
}
