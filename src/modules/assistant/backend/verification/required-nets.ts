function railNetName(token: string): string | null {
  // Accept 5V, +5V, 3.3V, 3V3, 1V8, 12V. `whole` digits, optional fractional
  // digits separated by "." or "v" (either before or after the trailing V).
  const m = /^[+]?(\d+)(?:\.(\d+)v|v(\d+)|v)$/i.exec(token.replace(/\s+/g, ""));
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? m[3];
  return frac ? `+${whole}V${frac}` : `+${whole}V`;
}

/**
 * Deterministically derive the nets a BOM item is expected to participate in
 * from its role keyword plus any explicit voltage in its value/role text. Used by
 * the DoD `nets_wired` check. Conservative: only power/ground rails are inferred,
 * since those are the connections a build is most likely to leave dangling.
 *
 * F7a: explicit rails keep their REAL names (+5V, +3V3, +12V); only a bare,
 * voltage-less power role falls back to the generic "VCC".
 */
export function requiredNetsForItem(
  role: string,
  value: string | undefined,
): string[] {
  const r = role.toLowerCase();
  const nets = new Set<string>();
  if (/(gnd|ground|return)/.test(r)) nets.add("GND");
  const isPower = /(vcc|vdd|\+?\d+v|3\.3v|power|supply|rail)/.test(r);
  if (isPower) {
    // Pull explicit rail tokens out of the role text and the item value.
    const haystack = `${role} ${value ?? ""}`;
    const tokens = haystack.match(/[+]?\d+(?:\.\d+v|v\d+|v)\b/gi) ?? [];
    let added = false;
    for (const token of tokens) {
      const rail = railNetName(token);
      if (rail) {
        nets.add(rail);
        added = true;
      }
    }
    if (!added) nets.add("VCC");
  }
  return [...nets];
}
