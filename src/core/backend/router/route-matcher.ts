export interface MatchResult {
  params: Record<string, string>;
}

export interface CompiledRoute {
  method: string;
  path: string;
  pattern: RegExp;
  paramNames: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compilePath(method: string, path: string): CompiledRoute {
  const paramNames: string[] = [];
  const regexStr = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const name = segment.slice(1);
        paramNames.push(name);
        return "([^/]+)";
      }
      return escapeRegex(segment);
    })
    .join("/");

  return {
    method,
    path,
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

export function matchPath(
  compiled: CompiledRoute,
  pathname: string,
): MatchResult | null {
  const matched = pathname.match(compiled.pattern);
  if (!matched) {
    return null;
  }

  const params: Record<string, string> = {};
  compiled.paramNames.forEach((name, index) => {
    const raw = matched[index + 1] ?? "";
    // Path params are URL-encoded by clients (e.g. `:` → `%3A`). Decode here
    // so handlers see the natural id (`builtin:resistor` not `builtin%3Aresistor`).
    //
    // On malformed percent-escapes (e.g. `%ZZ`) we deliberately fall back to
    // the raw segment rather than 500ing the request. Handlers still apply
    // their own id validation, so a literal `%ZZ` reaching them produces a
    // clean ValidationError/NotFound, not a silent bypass.
    try {
      params[name] = decodeURIComponent(raw);
    } catch {
      params[name] = raw;
    }
  });
  return { params };
}
