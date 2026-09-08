import type { DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Dangling copper (KiCad `track_dangling` / `via_dangling`, Altium Net
 * Antennae). This check owns no connectivity predicate of its own: it is a
 * lookup into the contact records the shared kernel
 * (`src/shared/pcb-connectivity/`) produces alongside its components — see
 * docs/pcb-hardening/01-connectivity-contract.md §4. Components alone cannot
 * answer the question, because a trace crossing another trace mid-body is
 * electrically continuous yet still an antenna at both ends.
 *
 * Semantic changes versus the old private predicate:
 *  - a trace end is an END CAP (a disc of radius = half the trace width), not a
 *    bare centreline point, so copper that overlaps without reaching the
 *    centreline now connects;
 *  - an end cap must touch the actual filled pour ISLAND, not merely share a
 *    layer with a same-net pour (the old whole-layer shortcut declared every
 *    endpoint on a poured layer connected, including ones sitting inside a
 *    clearance void);
 *  - a layer-invalid via occupies no layer under the fail-safe policy, so it
 *    has zero connected span layers and is reported dangling (it also raises
 *    `VIA_LAYER_SPAN`).
 *
 * The null-net rule is the kernel's and is asymmetric: unassigned copper is in
 * contact with anything it touches, but a named-net end cap or via barrel is in
 * contact only with same-net copper — null-net copper never rescues a named-net
 * stub.
 */
export function checkDangling(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const conn = ctx.connectivity();

  for (const item of ctx.copperItems()) {
    // Traces: either end cap touching nothing ⇒ dangling (one report per
    // trace, the start cap winning when both ends are free).
    if (item.kind === "trace") {
      const contacts = conn.endpointContacts.get(item.key);
      if (!contacts) continue;
      const [startCap, endCap] = contacts;
      const end =
        startCap.size === 0
          ? item.pointsMm[0]
          : endCap.size === 0
            ? item.pointsMm[item.pointsMm.length - 1]
            : undefined;
      if (!end) continue;
      out.push({
        code: "TRACK_DANGLING",
        ruleClass: "dfm",
        message: "Trace has a dangling (unconnected) end",
        anchors: [{ kind: "trace", traceId: item.id }],
        locationMm: { x: end.x, y: end.y },
        layer: item.layer,
      });
      continue;
    }

    // Vias: a via must electrically connect on ≥ 2 of its spanned layers.
    if (item.kind === "via") {
      const perLayer = conn.viaLayerContacts.get(item.key);
      let connectedLayers = 0;
      if (perLayer) {
        for (const touched of perLayer.values()) {
          if (touched.size > 0) connectedLayers += 1;
        }
      }
      if (connectedLayers < 2) {
        out.push({
          code: "VIA_DANGLING",
          ruleClass: "dfm",
          message: `Via connects on only ${connectedLayers} layer${connectedLayers === 1 ? "" : "s"} (needs 2)`,
          anchors: [{ kind: "via", viaId: item.id }],
          locationMm: { x: item.center.x, y: item.center.y },
        });
      }
    }
  }

  return out;
}
