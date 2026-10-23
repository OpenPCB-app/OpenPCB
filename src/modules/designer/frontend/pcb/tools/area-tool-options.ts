/**
 * In-progress options for the zone (Z) and keepout (K) draw tools — the
 * per-tool picker state (layer, net, pad connection / restrictions) that sits
 * alongside the sketch session (`sketch-tool-state.ts`) while the ring is
 * being drawn. Defaults and reconciliation follow the zone/keepout contract
 * §12.3: zone net defaults to the ground net by name, keepout defaults to
 * every restriction forbidden.
 */
import type {
  PcbCopperLayerId,
  PcbKeepoutRestrictions,
  PcbLayerCount,
  PcbZonePadConnection,
} from "../../../../../sdks";
import { copperLayersForCount } from "../../../../../sdks/designer";
import { findGroundNetId } from "../../../../../sdks/designer/ground-net";

/**
 * New picks persist the net ID. Existing name hints remain readable only
 * when no ID is stored; names never replace an existing identity.
 */
export interface AreaNetRef {
  netId: string | null;
  netName: string | null;
}

export interface ZoneToolOptions {
  layer: PcbCopperLayerId;
  net: AreaNetRef;
  padConnection: PcbZonePadConnection;
}

export interface KeepoutToolOptions {
  layers: PcbCopperLayerId[];
  restrictions: PcbKeepoutRestrictions;
}

const NO_NET: AreaNetRef = { netId: null, netName: null };

/**
 * `pick` is a UI selector value: `""` means "no net", otherwise the id of a
 * net from `nets`. Implements the persistence rule directly rather than
 * re-deriving it ad hoc at every call site.
 */
export function netRefForPick(
  nets: ReadonlyArray<{ id: string; name: string }>,
  pick: string,
): AreaNetRef {
  if (pick === "") return NO_NET;
  const net = nets.find((n) => n.id === pick);
  if (!net) return NO_NET;
  return { netId: net.id, netName: null };
}

export function defaultZoneToolOptions({
  activeLayer,
  netNames,
}: {
  activeLayer: PcbCopperLayerId;
  netNames: Readonly<Record<string, string>>;
}): ZoneToolOptions {
  const groundId = findGroundNetId(netNames);
  const net: AreaNetRef =
    groundId !== null
      ? { netId: groundId, netName: null }
      : NO_NET;
  return { layer: activeLayer, net, padConnection: "solid" };
}

export function defaultKeepoutToolOptions({
  activeLayer,
}: {
  activeLayer: PcbCopperLayerId;
}): KeepoutToolOptions {
  return {
    layers: [activeLayer],
    restrictions: {
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    },
  };
}

/**
 * Re-validate zone tool options against the current stackup / net table —
 * called whenever the layer count changes or a net is renamed/deleted while
 * the tool is armed. Untouched fields pass through unchanged.
 */
export function reconcileZoneToolOptions(
  opts: ZoneToolOptions,
  {
    layerCount,
    netNames,
    activeLayer,
  }: {
    layerCount: PcbLayerCount;
    netNames: Readonly<Record<string, string>>;
    activeLayer: PcbCopperLayerId;
  },
): ZoneToolOptions {
  const stackup = copperLayersForCount(layerCount);
  const layer = stackup.includes(opts.layer) ? opts.layer : activeLayer;
  let net = opts.net;
  // Keep inactive IDs visible for explicit repair instead of silently clearing
  // or rebinding them through an old display-name hint.
  if (net.netId === null && net.netName !== null) {
    const key = net.netName.trim().toUpperCase();
    const stillNamed = Object.values(netNames).some(
      (name) => name.trim().toUpperCase() === key,
    );
    if (!stillNamed) net = NO_NET;
  }
  return { ...opts, layer, net };
}

export function reconcileKeepoutToolOptions(
  opts: KeepoutToolOptions,
  {
    layerCount,
    activeLayer,
  }: { layerCount: PcbLayerCount; activeLayer: PcbCopperLayerId },
): KeepoutToolOptions {
  const stackup = copperLayersForCount(layerCount);
  const layers = opts.layers.filter((l) => stackup.includes(l));
  return { ...opts, layers: layers.length > 0 ? layers : [activeLayer] };
}
