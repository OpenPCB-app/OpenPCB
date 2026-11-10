/** Small read/write helpers over `@openpcb/kicad-parsers` s-expression nodes (frame K). */
import type { SExpr } from "@openpcb/kicad-parsers";

export type SExprNode = SExpr[];

export function childNode(node: SExprNode, tag: string): SExprNode | null {
  for (const c of node) if (Array.isArray(c) && c[0] === tag) return c;
  return null;
}

export function num(value: SExpr | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Negation that never yields `−0`. */
export function neg(v: number): number {
  return v === 0 ? 0 : -v;
}
