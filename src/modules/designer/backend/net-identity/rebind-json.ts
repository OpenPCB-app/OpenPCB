export class NetRebindJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetRebindJsonError";
  }
}

function canonicalDecimal(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  const fraction = match[3] ?? "", digits = match[2]! + fraction;
  let first = 0, end = digits.length;
  while (first < end && digits[first] === "0") first++;
  if (first === end) return "0";
  while (digits[end - 1] === "0") end--;
  const exponent = BigInt(match[4] ?? "0") - BigInt(fraction.length) + BigInt(digits.length - end);
  return `${match[1]}${digits.slice(first, end)}e${exponent}`;
}

/** Reject decimal loss before a reference-only rewrite can change opaque numeric data. */
export function parseLosslessRebindJson(raw: string): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new NetRebindJsonError("payload must contain valid JSON"); }
  // Whole string tokens keep escaped quotes and numeric-looking text out of the number check.
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token[0] === '"') continue;
    const number = Number(token), encoded = JSON.stringify(number);
    if (!Number.isFinite(number) || !encoded || canonicalDecimal(token) !== canonicalDecimal(encoded)) {
      throw new NetRebindJsonError("payload contains a JSON number whose decimal value cannot be preserved");
    }
  }
  return parsed;
}
