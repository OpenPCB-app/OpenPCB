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

export function matchPath(compiled: CompiledRoute, pathname: string): MatchResult | null {
  const matched = pathname.match(compiled.pattern);
  if (!matched) {
    return null;
  }

  const params: Record<string, string> = {};
  compiled.paramNames.forEach((name, index) => {
    params[name] = matched[index + 1] ?? "";
  });
  return { params };
}
