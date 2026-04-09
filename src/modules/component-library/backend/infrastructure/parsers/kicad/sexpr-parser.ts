/**
 * S-expression parser for KiCad files.
 *
 * Handles KiCad-specific quirks: quoted strings, numeric coercion,
 * escaped characters. Uses s-expression.js internally with post-processing.
 *
 * Abstraction layer — swap the internal implementation without
 * changing the public API (parseSexpr, findNode, findNodes, etc.).
 */

export type SExprAtom = string | number;
export type SExpr = SExprAtom | SExpr[];

/**
 * Parse an S-expression string into a nested array structure.
 * Numbers are coerced to number type. Quoted strings are unquoted.
 */
export function parseSexpr(input: string): SExpr {
  let pos = 0;
  const len = input.length;

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(input[pos]!)) pos++;
  }

  function parseQuotedString(): string {
    pos++; // skip opening "
    let str = "";
    while (pos < len && input[pos] !== '"') {
      if (input[pos] === "\\") {
        pos++;
        const c = input[pos]!;
        if (c === "n") str += "\n";
        else if (c === "r") str += "\r";
        else if (c === "t") str += "\t";
        else if (c === "\\") str += "\\";
        else if (c === '"') str += '"';
        else str += c;
      } else {
        str += input[pos];
      }
      pos++;
    }
    pos++; // skip closing "
    return str;
  }

  function parseToken(): SExprAtom {
    let token = "";
    while (pos < len && !/[\s()]/.test(input[pos]!)) {
      token += input[pos];
      pos++;
    }
    const num = Number(token);
    if (!isNaN(num) && token !== "") return num;
    return token;
  }

  function parseExpr(): SExpr {
    skipWhitespace();
    if (pos >= len) throw new Error("Unexpected end of input");

    if (input[pos] === "(") {
      pos++; // skip (
      const list: SExpr[] = [];
      while (true) {
        skipWhitespace();
        if (pos >= len)
          throw new Error("Unexpected end of input: unclosed parenthesis");
        if (input[pos] === ")") break;
        list.push(parseExpr());
      }
      pos++; // skip )
      return list;
    }

    if (input[pos] === '"') {
      return parseQuotedString();
    }

    return parseToken();
  }

  skipWhitespace();
  return parseExpr();
}

/** Find all direct child nodes with the given tag name */
export function findNodes(expr: SExpr, tag: string): SExpr[][] {
  if (!Array.isArray(expr)) return [];
  const results: SExpr[][] = [];
  for (const child of expr) {
    if (Array.isArray(child) && child[0] === tag) {
      results.push(child);
    }
  }
  return results;
}

/** Find first direct child node with the given tag name */
export function findNode(expr: SExpr, tag: string): SExpr[] | null {
  return findNodes(expr, tag)[0] ?? null;
}

/** Get string value at index (default 1) from a node */
export function getStringValue(node: SExpr[], index = 1): string | null {
  const val = node[index];
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return null;
}

/** Get number value at index (default 1) from a node */
export function getNumberValue(node: SExpr[], index = 1): number | null {
  const val = node[index];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

/** Serialize SExpr back to string (for provenance) */
export function serializeSexpr(expr: SExpr): string {
  if (typeof expr === "number") return String(expr);
  if (typeof expr === "string") {
    if (/[\s()]/.test(expr) || expr === "")
      return `"${expr.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return expr;
  }
  return `(${expr.map(serializeSexpr).join(" ")})`;
}
