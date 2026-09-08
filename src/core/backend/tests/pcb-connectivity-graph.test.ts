/**
 * The copper connectivity graph (docs/pcb-hardening/01-connectivity-contract.md
 * §1, §3, §6). Physical overlap only: same net, shared copper layer, copper
 * within CONNECT_EPS_MM. No net-name special case, no cross-layer contact
 * without a via, no bounding-box stand-in for a pad ring.
 *
 * This file pins determinism, an all-pairs equivalence check on the bounds
 * sweep, and a wall-clock budget that would fail if the sweep degraded to
 * O(n²).
 */
import { describe, expect, test } from "bun:test";
import { computeConnectivity } from "../../../shared/pcb-connectivity";
import type { PcbPlacedPart, PcbTrace } from "../../../sdks/designer";
import { pad, placement, trace } from "./helpers/drc-fixtures";
import {
  bruteForce,
  buildItems,
  mulberry32,
  randomBoard,
  serialize,
} from "./helpers/pcb-connectivity-fixtures";

describe("determinism and the bounds sweep", () => {
  test("input order never changes the result, component ids included", () => {
    const items = randomBoard(1337);
    const base = serialize(computeConnectivity(items));
    expect(serialize(computeConnectivity([...items].reverse()))).toBe(base);
    const rnd = mulberry32(7);
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rnd() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    expect(serialize(computeConnectivity(shuffled))).toBe(base);
  });

  test("the per-layer sweep agrees with an all-pairs reference", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const items = randomBoard(seed);
      const result = computeConnectivity(items);
      // Guard the fixture: a degenerate board (no unions, no contacts) would
      // make the equivalence assertion below pass vacuously.
      expect(items.length).toBeGreaterThanOrEqual(55);
      expect(result.components.some((c) => c.itemKeys.length > 1)).toBe(true);
      expect(
        [...result.endpointContacts.values()].some((c) => c[0].size + c[1].size > 0),
      ).toBe(true);
      expect(serialize(result)).toBe(serialize(bruteForce(items)));
    }
  });

  test("300 circular pads + 300 traces stay inside the wall-clock budget", () => {
    const placements: PcbPlacedPart[] = [];
    const padNetIds = new Map<string, string>();
    const traces: PcbTrace[] = [];
    for (let i = 0; i < 300; i += 1) {
      const x = (i % 20) * 2;
      const y = Math.floor(i / 20) * 2;
      const id = `U${i}`;
      placements.push(
        placement(id, {
          positionMm: { x, y },
          pads: [pad("1", { x: 0, y: 0 }, 1, 1, { shape: "circle" })],
        }),
      );
      padNetIds.set(`${id}|1`, "gnd");
      traces.push(trace(`t${i}`, "gnd", [[x, y], [x + 2, y]], { widthMm: 0.25 }));
    }
    const items = buildItems({ placements, padNetIds, traces });
    expect(items).toHaveLength(600);
    const started = performance.now();
    const result = computeConnectivity(items);
    const elapsed = performance.now() - started;
    // One component per grid row: each row's trace chain joins its 20 pads.
    expect(result.components).toHaveLength(15);
    expect(elapsed).toBeLessThan(1000);
  });
});
