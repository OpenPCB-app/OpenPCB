# Design Rules & Manufacturer Capabilities — Reference

## DRC rule interface

```typescript
interface DesignRules {
  clearance: {
    traceToTrace: number;       // default: 0.2mm
    traceToPad: number;         // default: 0.2mm
    padToPad: number;           // default: 0.2mm
    traceToVia: number;         // default: 0.2mm
    viaToVia: number;           // default: 0.254mm
    traceToBoardEdge: number;   // default: 0.3mm
    copperToBoardEdge: number;  // default: 0.3mm
  };
  minimums: {
    traceWidth: number;         // default: 0.15mm
    drillSize: number;          // default: 0.3mm
    annularRing: number;        // default: 0.15mm
    viaDiameter: number;        // default: 0.6mm
    viaDrill: number;           // default: 0.3mm
    solderMaskWeb: number;      // default: 0.1mm
    silkscreenWidth: number;    // default: 0.15mm
  };
  solderMask: {
    expansion: number;          // default: 0.05mm
  };
  manufacturing: {
    boardThickness: number;     // default: 1.6mm
    copperWeight: "0.5oz" | "1oz" | "2oz";  // default: "1oz"
    minHoleToHole: number;      // default: 0.5mm
  };
}
```

## IPC-2221B minimum electrical clearance

| Voltage (DC/AC peak) | Internal layers | External (uncoated) | External (coated) |
|----------------------|-----------------|--------------------|--------------------|
| 0–15V | 0.05mm (2mil) | 0.1mm (4mil) | 0.05mm (2mil) |
| 16–30V | 0.05mm (2mil) | 0.1mm (4mil) | 0.05mm (2mil) |
| 31–50V | 0.1mm (4mil) | 0.6mm (24mil) | 0.13mm (5mil) |
| 51–100V | 0.1mm (4mil) | 0.6mm (24mil) | 0.13mm (5mil) |
| 101–150V | 0.2mm (8mil) | 0.6mm (24mil) | 0.4mm (16mil) |
| 151–250V | 0.2mm (8mil) | 1.25mm (50mil) | 0.4mm (16mil) |
| 251–500V | 0.25mm (10mil) | 2.5mm (100mil) | 0.8mm (32mil) |

**For hobbyist boards (3.3V–12V)**: IPC minimum is only 0.1mm. Manufacturing minimums are usually the binding constraint.

## Manufacturer presets

### JLCPCB Standard

```typescript
{
  clearance: {
    traceToTrace: 0.127,
    traceToPad: 0.127,
    padToPad: 0.127,
    traceToVia: 0.127,
    viaToVia: 0.254,
    traceToBoardEdge: 0.3,
    copperToBoardEdge: 0.3,
  },
  minimums: {
    traceWidth: 0.127,
    drillSize: 0.3,
    annularRing: 0.13,
    viaDiameter: 0.56,
    viaDrill: 0.3,
    solderMaskWeb: 0.1,
    silkscreenWidth: 0.15,
  },
  solderMask: { expansion: 0.05 },
  manufacturing: { boardThickness: 1.6, copperWeight: "1oz", minHoleToHole: 0.5 },
}
```

### Conservative (beginner-friendly)

```typescript
{
  clearance: {
    traceToTrace: 0.2,
    traceToPad: 0.2,
    padToPad: 0.2,
    traceToVia: 0.2,
    viaToVia: 0.3,
    traceToBoardEdge: 0.5,
    copperToBoardEdge: 0.5,
  },
  minimums: {
    traceWidth: 0.2,
    drillSize: 0.4,
    annularRing: 0.2,
    viaDiameter: 0.8,
    viaDrill: 0.4,
    solderMaskWeb: 0.15,
    silkscreenWidth: 0.2,
  },
  solderMask: { expansion: 0.05 },
  manufacturing: { boardThickness: 1.6, copperWeight: "1oz", minHoleToHole: 0.5 },
}
```

## DRC check types (priority for implementation)

| Rule | What to check | Priority |
|------|--------------|----------|
| Clearance | All copper object pairs on same layer, different nets | Must have |
| Min trace width | Every trace ≥ minimum | Must have |
| Min drill size | Every via/THT drill ≥ minimum | Must have |
| Annular ring | Via pad radius - drill radius ≥ minimum | Must have |
| Board edge clearance | All copper ≥ min distance from Edge.Cuts | Must have |
| Unconnected nets | Pads in same net not connected by traces | Must have |
| Short circuits | Different nets touching | Must have |
| Floating copper | Copper not connected to any net | Nice to have |
| Silkscreen overlap | Silkscreen over exposed copper | Nice to have |
| Courtyard overlap | Component courtyards overlapping | Nice to have |

## DRC violation structure

```typescript
interface DrcViolation {
  id: string;
  type: "clearance" | "min_width" | "min_drill" | "annular_ring" |
        "board_edge" | "unconnected" | "short_circuit";
  severity: "error" | "warning";
  message: string;
  position: Point2D;
  objectIds: string[];
  actual?: number;
  required?: number;
}
```
