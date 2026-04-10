# Trace Width Calculation — Reference

## IPC-2221 formula

```
Cross-sectional Area (mil²) = (I / (k × ΔT^b))^(1/c)
Width (mil) = Area / Thickness
Width (mm) = Width (mil) × 0.0254
```

### Constants

| Parameter | External layers | Internal layers |
|-----------|----------------|-----------------|
| k | 0.048 | 0.024 |
| b | 0.44 | 0.44 |
| c | 0.725 | 0.725 |

### Copper thickness

| Weight | Thickness (mil) | Thickness (μm) |
|--------|----------------|-----------------|
| 0.5 oz | 0.7 | 17.5 |
| 1 oz | 1.4 | 35 |
| 2 oz | 2.8 | 70 |

## Implementation

```typescript
function calculateTraceWidth(
  current: number,       // Amps
  tempRise: number,      // °C (typically 10-20)
  copperOz: number,      // oz/ft² (typically 1)
  isInternal: boolean
): number {              // returns width in mm
  const k = isInternal ? 0.024 : 0.048;
  const b = 0.44;
  const c = 0.725;
  const thickness = copperOz * 1.4; // mils
  const area = Math.pow(current / (k * Math.pow(tempRise, b)), 1 / c);
  const widthMils = area / thickness;
  return Math.ceil(widthMils * 0.0254 * 100) / 100; // round up to 0.01mm
}
```

## Quick reference — External layer, 1oz copper

| Current | 10°C rise | 20°C rise | 30°C rise |
|---------|-----------|-----------|-----------|
| 0.5A | 0.18mm | 0.13mm | 0.10mm |
| 1.0A | 0.41mm | 0.28mm | 0.23mm |
| 1.5A | 0.69mm | 0.48mm | 0.38mm |
| 2.0A | 1.02mm | 0.71mm | 0.56mm |
| 3.0A | 1.83mm | 1.27mm | 1.00mm |
| 5.0A | 3.87mm | 2.69mm | 2.12mm |

## Quick reference — Internal layer, 1oz copper

| Current | 10°C rise | 20°C rise | 30°C rise |
|---------|-----------|-----------|-----------|
| 0.5A | 0.36mm | 0.25mm | 0.20mm |
| 1.0A | 0.81mm | 0.56mm | 0.45mm |
| 2.0A | 2.04mm | 1.42mm | 1.12mm |
| 3.0A | 3.66mm | 2.54mm | 2.01mm |

## Practical guidance

For typical hobbyist boards (3.3V logic, <1A signals):
- **Signal traces**: 0.25mm (10mil) default — safe for up to ~1A
- **Power traces**: 0.5mm (20mil) — good for up to ~2A at 20°C rise
- **High current (>2A)**: calculate explicitly or use 1mm+ traces
- **Ground plane**: use copper pour instead of traces
