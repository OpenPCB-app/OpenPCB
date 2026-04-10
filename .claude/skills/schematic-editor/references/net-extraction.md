# Net Extraction Algorithm — Reference

## Purpose

Net extraction determines which pins are electrically connected across the schematic. It produces `DerivedNet[]` which feeds into PCB ratsnest calculation.

## Algorithm

```
Input:  symbols[] with pins, wires[] with points + pin IDs, netLabels[]
Output: ExtractedNet[] — each net is a group of electrically connected pins
```

### Step-by-step

1. **Index all pins**: Build a map of `pinId → index` for Union-Find. Pin IDs are formatted as `"symbolId-pin-N"`.

2. **Union by wire pin references**: For each wire with valid `sourcePinId` and `targetPinId`, union those two pins. This is the primary connectivity method.

3. **Union by coordinate matching**: For wire endpoints without explicit pin references, build a coordinate map (`"${x}:${y}"` → `pinId[]`). Union all pins at the same coordinate. This handles junctions where multiple wires meet.

4. **Union by junction transitivity**: If wire A ends at coordinate P and wire B starts at coordinate P, and wire A connects to pin X while wire B connects to pin Y — X and Y are in the same net (through the junction).

5. **Apply net labels**: For each net label, find the pin or wire endpoint at the label's position. Record the label name for that Union-Find group. If multiple net labels share the same name, merge their groups — this creates named connections across distance.

6. **Apply power symbol implicit nets**: Detect power symbols by `referencePrefix === "#PWR"` or `canonicalKey` matching `builtin:gnd` / `builtin:vcc`. All GND pins join the "GND" net. All VCC pins join the "VCC" net.

7. **Collect groups**: Walk the Union-Find structure, collect groups of pin IDs. Each group = one net.

8. **Name nets**: If a group has a net label → use label name. If a group has a power symbol → use power name ("GND", "VCC"). Otherwise → auto-name as `Net_1`, `Net_2`, etc.

## Output shape

```typescript
interface ExtractedNet {
  id: string;
  name: string | null;
  pinIds: string[];
  symbolIds: string[];
  wireIds: string[];
  labelIds: string[];
}
```

## Union-Find implementation

Use the shared `UnionFind` class at `src-react/src/lib/union-find.ts`:

```typescript
class UnionFind {
  constructor(size: number);
  find(x: number): number;       // with path compression
  union(x: number, y: number): void;  // with union by rank
  connected(x: number, y: number): boolean;
  groups(): Map<number, number[]>;
}
```

## Edge cases

- **Floating pin**: pin not connected to any wire → single-pin net (isolated)
- **Self-loop**: wire with `sourcePinId === targetPinId` → skip (no useful connection)
- **Missing pin reference**: wire with null `sourcePinId` → rely on coordinate matching only
- **Duplicate net label names on same net**: harmless (already same group)
- **Power symbol without wires**: GND symbol with no wires still creates a GND net — its pin is in the GND group by the implicit net rule. Other GND symbols' pins merge into the same group.
