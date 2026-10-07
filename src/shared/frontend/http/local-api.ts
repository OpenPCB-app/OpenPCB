import { LOCAL_API_TOKEN_HEADER, isPrivilegedLocalApiPath, type LocalApiBootstrap, type RendererLocalApi } from "../../../core/contracts/security/local-api";

type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let developmentBootstrap: LocalApiBootstrap | null = null;
let bootstrapPromise: Promise<LocalApiBootstrap | null> | null = null;

function validBootstrap(value: LocalApiBootstrap): boolean {
  try {
    const url = new URL(value.url);
    return url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash && /^[a-f0-9]{64}$/.test(value.token);
  } catch { return false; }
}

/** Explicit browser-only development setup; credentials stay in memory. */
export function configureDevelopmentLocalApi(value: LocalApiBootstrap): void {
  const development = (import.meta as unknown as { env?: { DEV?: unknown } }).env?.DEV;
  if (development !== true || !validBootstrap(value)) throw new Error("Local API bootstrap refused");
  developmentBootstrap = { ...value };
  bootstrapPromise = null;
}

async function getBootstrap(): Promise<LocalApiBootstrap> {
  if (developmentBootstrap) return developmentBootstrap;
  if (!bootstrapPromise) {
    const api = (window as unknown as { electronAPI?: { localApi?: RendererLocalApi } }).electronAPI?.localApi;
    bootstrapPromise = api?.bootstrap() ?? Promise.resolve(null);
  }
  const value = await bootstrapPromise;
  if (!value || !validBootstrap(value)) {
    bootstrapPromise = null;
    throw new Error("Local API bootstrap unavailable");
  }
  return value;
}

/** Bind access to one explicit local server. Tokens never follow redirects or other origins. */
export function createLocalApiClient(bootstrap: LocalApiBootstrap, transport: FetchTransport = fetch): FetchTransport {
  if (!validBootstrap(bootstrap)) throw new Error("Local API bootstrap refused");
  const origin = new URL(bootstrap.url).origin;
  const token = bootstrap.token;
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input), origin);
    if (target.origin !== origin || target.username || target.password
      || !isPrivilegedLocalApiPath(target.pathname) || target.pathname === "/api/modules/assistant/mcp") {
      throw new Error("Local API target refused");
    }
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(LOCAL_API_TOKEN_HEADER, token);
    return transport(input instanceof Request ? input : target, { ...init, headers, redirect: "error", credentials: "omit" });
  };
}

export async function localApiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return createLocalApiClient(await getBootstrap())(input, init);
}
