import type { DesignEntity } from "../../contracts/entity";
import { pointKey, type PointNm } from "../../contracts/geometry";
import type { EntityId } from "../../contracts/ids";
import type { DesignPatch, NetMemberRef } from "../../contracts/patch";
import type { DesignWorld } from "../design-world";

class UnionFind {
  private parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(x: number): number {
    if (this.parent[x] === x) {
      return x;
    }
    this.parent[x] = this.find(this.parent[x]!);
    return this.parent[x]!;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) {
      this.parent[rootB] = rootA;
    }
  }
}

interface NetRebuildResult {
  patches: DesignPatch[];
  affectedEntityIds: EntityId[];
}

interface PinNode {
  key: string;
  partId: EntityId;
  pinKey: string;
  sheetId: string;
  position: PointNm;
}

interface WireSegment {
  start: PointNm;
  end: PointNm;
}

function rotatePoint(point: PointNm, rotationDeg: 0 | 90 | 180 | 270): PointNm {
  if (rotationDeg === 0) return point;
  if (rotationDeg === 90) return { xNm: -point.yNm, yNm: point.xNm };
  if (rotationDeg === 180) return { xNm: -point.xNm, yNm: -point.yNm };
  return { xNm: point.yNm, yNm: -point.xNm };
}

function transformPinLocal(
  point: PointNm,
  transform: { xNm: number; yNm: number; rotationDeg: 0 | 90 | 180 | 270; mirrored: boolean },
): PointNm {
  const mirrored = transform.mirrored
    ? { xNm: -point.xNm, yNm: point.yNm }
    : point;
  const rotated = rotatePoint(mirrored, transform.rotationDeg);
  return {
    xNm: transform.xNm + rotated.xNm,
    yNm: transform.yNm + rotated.yNm,
  };
}

function worldPinNodes(world: DesignWorld): PinNode[] {
  const result: PinNode[] = [];

  for (const entity of world.entities.values()) {
    if (entity.kind !== "part_instance") {
      continue;
    }

    const sheetId = entity.components.sheet_ref?.sheetId;
    const transform = entity.components.transform_2d;
    const snapshot = entity.components.symbol_snapshot;
    if (!sheetId || !transform || !snapshot) {
      continue;
    }

    for (const pin of snapshot.pins) {
      result.push({
        key: `${entity.id}:${pin.originPinKey}`,
        partId: entity.id,
        pinKey: pin.originPinKey,
        sheetId,
        position: transformPinLocal(pin.localPosition, transform),
      });
    }
  }

  return result;
}

function getWireSegments(points: PointNm[]): WireSegment[] {
  const segments: WireSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ start: points[i]!, end: points[i + 1]! });
  }
  return segments;
}

function isPointOnSegment(point: PointNm, segment: WireSegment): boolean {
  const cross =
    (point.yNm - segment.start.yNm) * (segment.end.xNm - segment.start.xNm) -
    (point.xNm - segment.start.xNm) * (segment.end.yNm - segment.start.yNm);
  if (cross !== 0) {
    return false;
  }

  const minX = Math.min(segment.start.xNm, segment.end.xNm);
  const maxX = Math.max(segment.start.xNm, segment.end.xNm);
  const minY = Math.min(segment.start.yNm, segment.end.yNm);
  const maxY = Math.max(segment.start.yNm, segment.end.yNm);
  return (
    point.xNm >= minX &&
    point.xNm <= maxX &&
    point.yNm >= minY &&
    point.yNm <= maxY
  );
}

function wireNodeId(wireId: string): string {
  return `wire:${wireId}`;
}

function pinMemberKey(partId: string, pinKeyValue: string): string {
  return `part_pin:${partId}:${pinKeyValue}`;
}

function wireMemberKey(wireId: string): string {
  return `wire:${wireId}`;
}

function chooseReusableNet(
  sheetId: string,
  memberKeys: string[],
  oldNetEntities: Map<string, DesignEntity>,
  oldNetIdsByMemberKey: Map<string, string>,
  usedNetIds: Set<string>,
): DesignEntity | null {
  const scores = new Map<string, number>();
  for (const memberKey of memberKeys) {
    const oldNetId = oldNetIdsByMemberKey.get(memberKey);
    if (!oldNetId || usedNetIds.has(oldNetId)) {
      continue;
    }
    const oldNet = oldNetEntities.get(oldNetId);
    if (!oldNet || oldNet.components.sheet_ref?.sheetId !== sheetId) {
      continue;
    }
    scores.set(oldNetId, (scores.get(oldNetId) ?? 0) + 1);
  }

  let bestNet: DesignEntity | null = null;
  let bestScore = -1;
  for (const [netId, score] of scores.entries()) {
    const candidate = oldNetEntities.get(netId)!;
    const candidateOrdinal = candidate.components.net_meta?.ordinal ?? Number.MAX_SAFE_INTEGER;
    const bestOrdinal = bestNet?.components.net_meta?.ordinal ?? Number.MAX_SAFE_INTEGER;
    if (
      score > bestScore ||
      (score === bestScore && candidateOrdinal < bestOrdinal)
    ) {
      bestNet = candidate;
      bestScore = score;
    }
  }

  return bestNet;
}

export function rebuildNets(
  world: DesignWorld,
  createEntityId: () => string,
): NetRebuildResult {
  const wires = [...world.entities.values()].filter((entity) => entity.kind === "wire");
  const pins = worldPinNodes(world);

  const nodes = [...pins.map((pin) => pin.key), ...wires.map((wire) => `wire:${wire.id}`)];
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  const uf = new UnionFind(nodes.length);

  const pinByPosition = new Map<string, string[]>();
  for (const pin of pins) {
    const key = `${pin.sheetId}:${pointKey(pin.position)}`;
    const list = pinByPosition.get(key) ?? [];
    list.push(pin.key);
    pinByPosition.set(key, list);
  }

  for (const wire of wires) {
    const wireNode = nodeIndex.get(`wire:${wire.id}`);
    if (wireNode === undefined) {
      continue;
    }
    const wireGeometry = wire.components.wire_geometry;
    if (!wireGeometry || wireGeometry.pointsNm.length < 2) {
      continue;
    }

    const segments = getWireSegments(wireGeometry.pointsNm);
    const sheetId = wire.components.sheet_ref?.sheetId;
    if (!sheetId) {
      continue;
    }

    for (const pin of pins) {
      if (pin.sheetId !== sheetId) {
        continue;
      }
      if (segments.some((segment) => isPointOnSegment(pin.position, segment))) {
        const pinNode = nodeIndex.get(pin.key);
        if (pinNode !== undefined) {
          uf.union(wireNode, pinNode);
        }
      }
    }
  }

  for (let i = 0; i < wires.length; i++) {
    const wireA = wires[i]!;
    const sheetA = wireA.components.sheet_ref?.sheetId;
    const geometryA = wireA.components.wire_geometry;
    if (!sheetA || !geometryA || geometryA.pointsNm.length < 2) {
      continue;
    }
    const segmentsA = getWireSegments(geometryA.pointsNm);
    const endpointsA = [geometryA.pointsNm[0]!, geometryA.pointsNm[geometryA.pointsNm.length - 1]!];

    for (let j = i + 1; j < wires.length; j++) {
      const wireB = wires[j]!;
      const sheetB = wireB.components.sheet_ref?.sheetId;
      const geometryB = wireB.components.wire_geometry;
      if (!sheetB || !geometryB || geometryB.pointsNm.length < 2 || sheetA !== sheetB) {
        continue;
      }

      const segmentsB = getWireSegments(geometryB.pointsNm);
      const endpointsB = [geometryB.pointsNm[0]!, geometryB.pointsNm[geometryB.pointsNm.length - 1]!];
      const connected =
        endpointsA.some((endpoint) => segmentsB.some((segment) => isPointOnSegment(endpoint, segment))) ||
        endpointsB.some((endpoint) => segmentsA.some((segment) => isPointOnSegment(endpoint, segment)));

      if (connected) {
        uf.union(nodeIndex.get(wireNodeId(wireA.id))!, nodeIndex.get(wireNodeId(wireB.id))!);
      }
    }
  }

  const groups = new Map<number, string[]>();
  for (const [node, index] of nodeIndex.entries()) {
    const root = uf.find(index);
    const list = groups.get(root) ?? [];
    list.push(node);
    groups.set(root, list);
  }

  const oldNetEntities = new Map(
    [...world.entities.values()]
      .filter((entity) => entity.kind === "net")
      .map((entity) => [entity.id, entity]),
  );
  const oldNetIdsByMemberKey = new Map<string, string>();
  for (const member of world.netMembers) {
    if (member.memberKind === "wire") {
      oldNetIdsByMemberKey.set(wireMemberKey(member.memberEntityId), member.netId);
      continue;
    }

    if (member.pinKey) {
      oldNetIdsByMemberKey.set(
        pinMemberKey(member.memberEntityId, member.pinKey),
        member.netId,
      );
    }
  }

  const patches: DesignPatch[] = [];
  const members: NetMemberRef[] = [];
  const affectedEntityIds: EntityId[] = [];
  const usedNetIds = new Set<string>();
  const desiredNetEntities = new Map<string, DesignEntity>();
  const desiredWireNetMap = new Map<string, string>();

  for (const nodesInGroup of groups.values()) {
    const wireNodes = nodesInGroup.filter((node) => node.startsWith("wire:"));
    if (wireNodes.length === 0) {
      continue;
    }

    const sheetId = (() => {
      const wireEntity = world.entities.get(wireNodes[0]!.slice(5));
      return wireEntity?.components.sheet_ref?.sheetId;
    })();

    if (!sheetId) {
      continue;
    }

    const memberKeys = [
      ...wireNodes.map((wireNode) => wireMemberKey(wireNode.slice(5))),
      ...nodesInGroup
        .filter((node) => !node.startsWith("wire:"))
        .map((pinNode) => {
          const separator = pinNode.indexOf(":");
          const partId = pinNode.slice(0, separator);
          const pinKeyValue = pinNode.slice(separator + 1);
          return pinMemberKey(partId, pinKeyValue);
        }),
    ];

    const reusableNet = chooseReusableNet(
      sheetId,
      memberKeys,
      oldNetEntities,
      oldNetIdsByMemberKey,
      usedNetIds,
    );

    let netId: string;
    let stableName: string;
    let ordinal: number;

    if (reusableNet) {
      netId = reusableNet.id;
      stableName = reusableNet.components.net_meta?.stableName ?? "N$1";
      ordinal = reusableNet.components.net_meta?.ordinal ?? 1;
    } else {
      const nextOrdinal = world.head.nextAutoNetOrdinals[sheetId] ?? 1;
      netId = createEntityId();
      stableName = `N$${nextOrdinal}`;
      ordinal = nextOrdinal;
      world.head.nextAutoNetOrdinals[sheetId] = nextOrdinal + 1;
    }
    usedNetIds.add(netId);

    const netEntity: DesignEntity = {
      id: netId,
      designId: world.head.designId,
      kind: "net",
      createdRevision: world.head.revision,
      updatedRevision: world.head.revision,
      components: {
        sheet_ref: { sheetId },
        net_meta: {
          stableName,
          namingSource: "auto",
          ordinal,
        },
      },
    };

    desiredNetEntities.set(netId, netEntity);
    affectedEntityIds.push(netId);

    for (const wireNode of wireNodes) {
      const wireId = wireNode.slice(5);
      desiredWireNetMap.set(wireId, netId);
      members.push({ netId, memberEntityId: wireId, memberKind: "wire" });
      affectedEntityIds.push(wireId);
    }

    for (const pinNode of nodesInGroup.filter((node) => !node.startsWith("wire:"))) {
      const separator = pinNode.indexOf(":");
      const partId = pinNode.slice(0, separator);
      const pinKeyValue = pinNode.slice(separator + 1);
      members.push({
        netId,
        memberEntityId: partId!,
        memberKind: "part_pin",
        pinKey: pinKeyValue,
      });
    }
  }

  for (const netEntity of desiredNetEntities.values()) {
    patches.push({ op: "upsert_entity", entity: netEntity });
  }

  for (const existingNetId of oldNetEntities.keys()) {
    if (!desiredNetEntities.has(existingNetId)) {
      patches.push({ op: "delete_entity", entityId: existingNetId });
      affectedEntityIds.push(existingNetId);
    }
  }

  for (const wire of wires) {
    const existingNetId = wire.components.wire_net_ref?.netId;
    const desiredNetId = desiredWireNetMap.get(wire.id);
    if (desiredNetId && existingNetId !== desiredNetId) {
      patches.push({
        op: "set_component",
        entityId: wire.id,
        component: "wire_net_ref",
        value: { netId: desiredNetId },
      });
      continue;
    }

    if (!desiredNetId && existingNetId) {
      patches.push({
        op: "remove_component",
        entityId: wire.id,
        component: "wire_net_ref",
      });
    }
  }

  patches.push({
    op: "replace_net_members",
    designId: world.head.designId,
    members,
  });

  return { patches, affectedEntityIds };
}
