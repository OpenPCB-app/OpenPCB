declare module "bun:sqlite" {
  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
  }

  export interface Statement<T = unknown, P extends unknown[] = unknown[]> {
    get(...params: P): T | undefined;
    all(...params: P): T[];
    run(...params: P): void;
  }

  export class Database {
    constructor(path: string, options?: DatabaseOptions);
    exec(query: string): void;
    query<T = unknown, P extends unknown[] = unknown[]>(sql: string): Statement<T, P>;
    close(): void;
  }
}
