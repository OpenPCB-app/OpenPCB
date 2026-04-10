---
name: eda-standards
description: "EDA industry standards and manufacturing reference — IPC clearance rules, trace width calculation, layer naming, manufacturer capabilities, Gerber mapping, via specifications, and design rule presets. Use this skill whenever implementing DRC rules, design rule validation, trace width calculation, clearance checks, manufacturer preset configuration, Gerber/drill export, layer stackup definition, via sizing, or any feature that needs to reference PCB manufacturing standards. Trigger for any mention of: IPC-2221, clearance rules, trace width formula, JLCPCB capabilities, PCBWay capabilities, Gerber format, drill file, solder mask, annular ring, copper weight, board thickness, stackup, or manufacturing constraints. Also trigger when the user asks about PCB manufacturing limits, minimum trace width, minimum drill size, or design rule values."
---

# EDA Standards & Manufacturing Reference

This skill provides industry standards and manufacturing reference data. It contains NO code patterns — only values, formulas, and rules. For implementation patterns, see `pcb-layout` and `r3f-eda-rendering` skills.

## Layer naming convention (KiCad-compatible)

Always use these exact layer IDs — they match KiCad format and the `kicadPayload` in footprint data.

| Layer ID | Purpose | Gerber extension |
|----------|---------|-----------------|
| `F.Cu` | Front copper | `.GTL` |
| `B.Cu` | Back copper | `.GBL` |
| `In1.Cu` | Inner copper 1 (4+ layer) | `.G2` |
| `In2.Cu` | Inner copper 2 (4+ layer) | `.G3` |
| `F.SilkS` | Front silkscreen | `.GTO` |
| `B.SilkS` | Back silkscreen | `.GBO` |
| `F.Mask` | Front solder mask | `.GTS` |
| `B.Mask` | Back solder mask | `.GBS` |
| `F.Paste` | Front paste stencil | `.GTP` |
| `B.Paste` | Back paste stencil | `.GBP` |
| `Edge.Cuts` | Board outline | `.GKO` / `.GML` |
| `F.CrtYd` | Front courtyard | (not in Gerber) |
| `B.CrtYd` | Back courtyard | (not in Gerber) |
| `F.Fab` | Front fabrication | (not in Gerber) |
| `B.Fab` | Back fabrication | (not in Gerber) |

**Rule**: NEVER invent new layer names. Use only the IDs above.

## Design rule defaults and manufacturer presets

Read `references/design-rules.md` for complete tables covering:
- IPC-2221B clearance requirements by voltage
- Practical DRC minimums (trace-to-trace, trace-to-pad, etc.)
- JLCPCB standard and advanced capabilities
- PCBWay capabilities
- Conservative preset for beginners
- Design rules TypeScript interface

## Trace width calculation

Read `references/trace-width.md` for:
- IPC-2221 formula (Area = (I / (k × ΔT^b))^(1/c))
- Constants for external and internal layers
- Quick reference lookup tables (current → width for various temperature rises)
- Implementation function

## Via specifications

| Parameter | Standard | Small | Micro |
|-----------|----------|-------|-------|
| Pad diameter | 0.6mm | 0.45mm | 0.3mm |
| Drill diameter | 0.3mm | 0.25mm | 0.15mm |
| Annular ring | 0.15mm | 0.1mm | 0.075mm |

**MVP**: through-hole vias only (pad 0.6mm, drill 0.3mm).

Via types:
- **Through-hole**: full board penetration, `layers: ["F.Cu", "B.Cu"]`
- **Blind**: outer to inner (future), `layers: ["F.Cu", "In1.Cu"]`
- **Buried**: inner to inner (future)
- **Micro**: laser-drilled, single span (future)

## Copper weight and thickness

| Weight | Thickness | Common use |
|--------|-----------|------------|
| 0.5 oz | 17.5μm (0.7 mil) | Fine-pitch, low current |
| 1 oz | 35μm (1.4 mil) | Standard (default) |
| 2 oz | 70μm (2.8 mil) | Power, high current |

## PCB grid standards

| Grid | Value | Use |
|------|-------|-----|
| 50 mil | 1.27mm | Through-hole component spacing |
| 25 mil | 0.635mm | Fine placement |
| 10 mil | 0.254mm | Routing grid (default for routing) |
| 5 mil | 0.127mm | Fine routing |
| Metric | 0.1mm | Metric routing |

## Board stackup

### 2-Layer (MVP)
```
Top Copper (35μm, 1oz) — signals + power
FR4 Core (1.5mm)       — dielectric εr ≈ 4.2-4.6
Bottom Copper (35μm)   — ground plane + signals
Total: ~1.6mm
```

### 4-Layer (future)
```
Top Copper     — Signal Layer 1
Prepreg (0.2mm)
Inner Copper 1 — Ground Plane
FR4 Core (0.8mm)
Inner Copper 2 — Power Plane
Prepreg (0.2mm)
Bottom Copper  — Signal Layer 2
Total: ~1.6mm
```

## Coordinate system

- **Origin**: (0, 0) at board center (or user-defined)
- **X**: increases right
- **Y**: increases up (Three.js convention, Y-up)
- **Units**: millimeters for all PCB dimensions
- **Precision**: 0.001mm (1μm) typical resolution

**Note**: KiCad uses Y-down. When importing KiCad footprint data, Y coordinates may need to be negated. Check the parser output — the existing KiCad parser should handle this.

## Reference files

- `references/design-rules.md` — Complete DRC rule tables and manufacturer presets
- `references/trace-width.md` — Trace width calculation formula and lookup tables
