import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { deriveNetComponents, deriveNetsAndJunctions } from "../../../modules/designer/backend/projection-world";
import { loadLegacyFixtureSource, legacyDerivationSnapshot } from "./helpers/legacy-net-fixture-source";

// Captured from the frozen S0 raw rows before the S4 derivation split.
const EXPECTED: Record<string, string> = {
  "f1-routed-clean": "8fdf83c6f84e19e98a55a2a9a58595d08fcee4c7fc993f02ae5c433e1de78be9",
  "f2-t132-stale": "45984a7103eba6ff600baac374288ccb62490f574e715da99e7d6d32e11b8232",
  "f3-name-hints": "8fc983dff25070ebc148046cdbc3fcb79fb42bb0a61ba81bc7c9810fb1fe455d",
  "f9-pour-only-gnd": "d32f04db2a94498d9f155c2d6d017b5b1e841b149e82434d948098830bf4616d",
};

for (const [name, expected] of Object.entries(EXPECTED)) {
  test(`${name}: legacy roots, names, member order, junctions, warnings and attachment sets stay byte-equal`, async () => {
    const { projection } = await loadLegacyFixtureSource(name);
    const args = [projection.parts, projection.wires, projection.labels, projection.primitives] as const;
    const legacy = deriveNetsAndJunctions(...args);
    expect(createHash("sha256").update(legacyDerivationSnapshot(legacy)).digest("hex")).toBe(expected);
    const derived = deriveNetComponents(...args);
    expect(derived.components.map((component) => component.key)).toEqual(legacy.nets.map((net) => net.id));
    expect(derived.components.map((component) => component.legacyName)).toEqual(legacy.nets.map((net) => net.name));
    expect(legacy.nets.some((net) => "autoNamed" in net)).toBe(false);
    expect(derived.junctions).toEqual(legacy.junctions);
    expect(derived.warnings).toEqual(legacy.warnings);
  });
}
