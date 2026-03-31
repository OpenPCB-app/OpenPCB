declare module "bun:sqlite" {
  export interface DatabaseOptions {
    readonly?: boolean;
    create?: boolean;
    readwrite?: boolean;
  }

  export class Database {
    constructor(path: string, options?: DatabaseOptions);
    exec(query: string): void;
    query<T = unknown, P extends unknown[] = unknown[]>(
      query: string,
      params?: P,
    ): {
      get(): T | undefined;
      all(): T[];
      run(): void;
    };
    prepare(query: string): {
      get(): unknown;
      all(): unknown[];
      run(): void;
    };
    close(): void;
  }
}

declare module "bun" {
  export interface Subprocess {
    exited: Promise<number>;
    kill(): void;
  }
}

declare namespace Bun {
  interface ServeOptions {
    port?: number;
    hostname?: string;
    fetch: (
      req: Request,
      server: Server,
    ) => Response | Promise<Response | undefined> | undefined;
    websocket?: {
      open?: (ws: WebSocket) => void;
      message?: (ws: WebSocket, message: string | Uint8Array) => void;
      close?: (ws: WebSocket) => void;
    };
  }

  interface Server {
    port: number;
    upgrade(req: Request, options?: { data?: unknown }): boolean;
  }

  interface FileBlob {
    size: number;
    text(): Promise<string>;
    exists(): Promise<boolean>;
  }

  interface SpawnOptions {
    env?: Record<string, string | undefined>;
    stdout?: "inherit" | "pipe" | "ignore";
    stderr?: "inherit" | "pipe" | "ignore";
  }
}

declare const Bun: {
  file(path: string): Bun.FileBlob;
  sleep(ms: number): Promise<void>;
  spawn(args: string[], options?: Bun.SpawnOptions): import("bun").Subprocess;
  serve(options: Bun.ServeOptions): Bun.Server;
};
