# PCB Design Suite — Product Specification v1.0

> **Status:** Ready for Development  
> **Version:** 1.0 (Initial Release Scope)  
> **Last Updated:** March 30, 2026  
> **Platform:** Browser-first (desktop planned for v2.0)  
> **Working Name:** *[TBD — placeholder: "CircuitForge"]*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Strategy](#2-product-vision--strategy)
3. [Target Users & Personas](#3-target-users--personas)
4. [Technology Architecture](#4-technology-architecture)
5. [UX Design System](#5-ux-design-system)
6. [Schematic Editor](#6-schematic-editor)
7. [PCB Layout Editor](#7-pcb-layout-editor)
8. [Component Library System](#8-component-library-system)
9. [AI Copilot](#9-ai-copilot)
10. [3D Preview (ECAD-MCAD)](#10-3d-preview-ecad-mcad)
11. [Supply Chain Integration](#11-supply-chain-integration)
12. [Manufacturing Outputs](#12-manufacturing-outputs)
13. [Project Management & Storage](#13-project-management--storage)
14. [File Import/Export](#14-file-importexport)
15. [Onboarding & Education](#15-onboarding--education)
16. [Pricing & Licensing](#16-pricing--licensing)
17. [Performance Requirements](#17-performance-requirements)
18. [Security & Compliance](#18-security--compliance)
19. [Development Phases & Roadmap](#19-development-phases--roadmap)
20. [Success Metrics](#20-success-metrics)
21. [Appendix A: Data Model Schema](#appendix-a-data-model-schema)
22. [Appendix B: API Surface](#appendix-b-api-surface)
23. [Appendix C: Competitive Positioning](#appendix-c-competitive-positioning)

---

## 1. Executive Summary

### What we're building

A **browser-first PCB design suite** optimized for beginners, makers, students, and small hardware teams. The tool combines a **Figma-like infinite canvas UX**, **AI copilot assistance**, **live supply chain data**, and a **lightweight 3D preview** — all accessible from any modern browser with zero installation.

### Why now

- **Eagle end-of-life (June 7, 2026)** displaces hundreds of thousands of users seeking a new tool
- **No browser-based tool** currently handles professional features with beginner-friendly UX
- **$30–50/month mid-market gap** between free tools (KiCad, EasyEDA) and $10K+ enterprise tools (Altium, Allegro)
- **AI-assisted design** is becoming table stakes — early movers gain lasting advantage

### v1.0 scope summary

| Dimension | v1.0 Target |
|-----------|-------------|
| Max copper layers | 2 (top + bottom) |
| Platform | Browser (Chrome, Firefox, Safari, Edge) |
| AI copilot | Chat sidebar with canvas actions |
| 3D preview | Lightweight viewer (STEP export) |
| Supply chain | Live pricing/stock from aggregated sources |
| File imports | KiCad (.kicad_sch, .kicad_pcb) |
| Collaboration | Single-user (multi-user planned v1.5) |
| Pricing | Free personal / $30–50/month teams |

---

## 2. Product Vision & Strategy

### Vision statement

**Make PCB design as approachable as Figma made UI design** — a tool where a curious beginner can design their first board in an afternoon, while growing into professional-grade capabilities over time.

### Strategic principles

1. **Simplicity over feature count** — Every feature must pass the "would a beginner understand this in 10 seconds?" test. Advanced features are discoverable, never in the way.

2. **AI as guide, not replacement** — The copilot assists and educates. It suggests, explains *why*, and teaches best practices — not just auto-generates.

3. **Design-to-manufacturing pipeline** — The workflow doesn't end at Gerber export. Integrated supply chain, DFM checks, and one-click ordering (v1.5) make the full journey seamless.

4. **Start simple, scale up** — v1.0 targets 2-layer boards. Architecture must support 16+ layers, differential pairs, and high-speed design in future versions without refactoring the core.

5. **Open data, no lock-in** — Users own their designs. Local export always available. Open file format specification published.

### Competitive positioning

| vs. Tool | Our Advantage |
|----------|---------------|
| vs. KiCad | Zero install, AI copilot, integrated supply chain, modern UX |
| vs. Flux.ai | Offline export, open file format, simpler UX for beginners, planned desktop app |
| vs. EasyEDA | Vendor-neutral (not locked to JLCPCB/LCSC), AI copilot, Figma-like UX |
| vs. Eagle/Fusion | No subscription lock-in for designs, browser-native, AI-assisted |
| vs. Altium | 100x cheaper, browser-based, beginner-friendly, cross-platform |

---

## 3. Target Users & Personas

### Primary personas (v1.0)

#### Persona 1: "Aria" — The Curious Beginner

- **Profile:** College student, 20, studying computer science. Wants to build a custom Arduino shield for a class project. Has never used a PCB tool.
- **Needs:** Step-by-step guidance, forgiving UI, pre-made templates, simple component search, clear path from design to ordering a board.
- **Pain points:** Overwhelmed by KiCad's interface. Can't afford Altium. Doesn't know what a "footprint" is yet.
- **Success metric:** Designs and orders her first PCB within 3 hours of first opening the tool.

#### Persona 2: "Marcus" — The Maker Migrating from Eagle

- **Profile:** Hardware hobbyist, 35, has designed ~20 boards in Eagle. Frustrated by Eagle's shutdown and doesn't want to learn KiCad.
- **Needs:** Familiar workflow patterns, KiCad import for reference designs, ability to export Gerber files for any fab house, reliable DRC.
- **Pain points:** Doesn't want vendor lock-in. Needs offline access to designs. Wants something "that just works."
- **Success metric:** Imports an Eagle design (via KiCad conversion), modifies it, and exports manufacturing files within 1 hour.

#### Persona 3: "Priya" — The Startup Hardware Lead

- **Profile:** EE at a 5-person hardware startup, 28. Designing IoT sensor boards. Needs to move fast, manage BOM costs, and collaborate with mechanical engineer.
- **Needs:** Live BOM pricing, 3D preview for enclosure fitting, team workspace, version history, DFM validation.
- **Pain points:** Currently juggling KiCad + spreadsheets + Slack for collaboration. No single tool covers her workflow.
- **Success metric:** Reduces design-to-order cycle from 2 weeks to 3 days.

### Secondary personas (v1.5+)

- **Educators** using it as a teaching tool in university courses
- **Professional freelancers** doing contract PCB design work
- **Open-source hardware developers** sharing designs publicly

---

## 4. Technology Architecture

### 4.1 Stack overview

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER CLIENT                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  React UI     │  │  Canvas      │  │  3D Viewer   │   │
│  │  (TypeScript) │  │  (WebGL2/    │  │  (Three.js / │   │
│  │              │  │   WebGPU)    │  │   WebGL)     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │            │
│  ┌──────▼─────────────────▼──────────────────▼───────┐   │
│  │              Rust/WASM Core Engine                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │   │
│  │  │ Design   │ │ DRC/ERC  │ │ Router   │           │   │
│  │  │ Data     │ │ Engine   │ │ Engine   │           │   │
│  │  │ Model    │ │          │ │          │           │   │
│  │  └──────────┘ └──────────┘ └──────────┘           │   │
│  └───────────────────────┬───────────────────────────┘   │
│                          │                                │
└──────────────────────────┼────────────────────────────────┘
                           │ HTTPS / WebSocket
┌──────────────────────────▼────────────────────────────────┐
│                    BACKEND SERVICES                        │
│                                                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │ API Server │ │ AI Copilot │ │ Supply     │            │
│  │ (Node.js / │ │ Service    │ │ Chain API  │            │
│  │  Rust)     │ │ (LLM      │ │ Aggregator │            │
│  │            │ │  Gateway)  │ │            │            │
│  └──────┬─────┘ └────────────┘ └────────────┘            │
│         │                                                  │
│  ┌──────▼───────────────────────────────────────────┐     │
│  │  PostgreSQL  │  Redis  │  S3 (project storage)   │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Rust/WASM core engine

The performance-critical core runs in WebAssembly, compiled from Rust.

**Responsibilities:**

- **Design data model** — All schematic and PCB objects, netlist management, connectivity graph
- **DRC/ERC engine** — Design rule checking, electrical rule checking, clearance calculations
- **Interactive router** — Push-and-shove routing for v1.0 (2-layer), extensible to multi-layer
- **Gerber/drill generation** — Manufacturing file output computed client-side
- **Geometry engine** — Polygon operations (union, intersection, clipping) for copper zones
- **Undo/redo stack** — Command pattern with full state serialization

**Design decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Internal units | Nanometers (i64) | 64-bit avoids KiCad's 2.14m board limit. Nanometer precision future-proofs for advanced packaging. |
| Coordinate system | Cartesian, Y-up | Standard mathematical orientation. Convert to Y-down only at rendering layer. |
| Object IDs | UUID v7 | Time-ordered, globally unique, no collision risk in collaborative scenarios. |
| Undo model | Command pattern with inverse operations | Memory-efficient. Each command stores forward/backward delta. Serializable for sync. |

### 4.3 React UI layer

- **Framework:** React 18+ with TypeScript (strict mode)
- **State management:** Zustand (lightweight, minimal boilerplate)
- **Canvas rendering:** Custom WebGL2 renderer for schematic/PCB canvas (not DOM-based — DOM is too slow for thousands of primitives)
- **UI components:** Radix UI primitives + custom design system (see Section 5)
- **Styling:** Tailwind CSS + CSS variables for theming
- **Keyboard shortcuts:** Platform-aware (Cmd on macOS, Ctrl on Windows/Linux)

### 4.4 Backend services

- **API server:** Node.js with Fastify (or Rust with Axum for compute-heavy endpoints)
- **Database:** PostgreSQL 16 (projects, users, teams, component metadata)
- **Cache:** Redis (session state, component search cache, real-time presence)
- **Object storage:** S3-compatible (project files, 3D models, thumbnails)
- **AI gateway:** Routes copilot requests to LLM provider (Anthropic Claude / OpenAI) with PCB-specific system prompts and RAG over component datasheets
- **Supply chain aggregator:** Caches and normalizes data from Octopart, DigiKey, Mouser, LCSC APIs

### 4.5 File format specification

**Format name:** `.cfproj` (CircuitForge Project)

**Structure:** ZIP archive containing JSON files (human-readable, Git-friendly).

```
project.cfproj (ZIP)
├── manifest.json          # Version, metadata, settings
├── schematic/
│   ├── sheets/
│   │   ├── sheet-001.json # Each sheet as separate file
│   │   └── sheet-002.json
│   └── symbols.json       # Symbol instances with properties
├── pcb/
│   ├── board.json         # Board outline, stackup, zones
│   ├── footprints.json    # Placed footprints
│   ├── traces.json        # Routed traces, vias
│   └── rules.json         # Design rules
├── library/
│   ├── local-parts.json   # Project-specific components
│   └── 3d-models/         # STEP/VRML files
└── assets/
    └── thumbnails/        # Auto-generated previews
```

**Key design choices:**

- **JSON over S-expressions** — More universally parseable, better tooling ecosystem, still diff-friendly
- **Separate files per logical unit** — Enables granular Git diffs (changing one sheet doesn't touch others)
- **All coordinates in nanometers** — No floating-point rounding errors
- **Schema versioned** — `manifest.json` includes `"format_version": "1.0"` for migration support

---

## 5. UX Design System

### 5.1 Design philosophy

**"Progressive disclosure meets infinite canvas."**

The interface reveals complexity only when needed. A beginner sees a clean, minimal workspace. A power user discovers layers of capability through contextual menus, keyboard shortcuts, and the AI copilot.

### 5.2 Core UX principles

1. **One-click defaults** — Every action has a sensible default. Placing a resistor? It auto-assigns R1, picks 10kΩ, and uses an 0402 footprint. Users change only what they need.

2. **Contextual toolbars** — No permanent toolbar walls. Tools appear near the cursor based on selection and context. Select a trace → routing options appear. Select a component → properties panel slides in.

3. **Command palette** — `Ctrl+K` / `Cmd+K` opens a universal search that finds commands, components, settings, and help articles. This is the power user's primary interface.

4. **Inline feedback** — Errors and warnings appear directly on the canvas (red/yellow indicators on violations), not in a separate log panel that nobody reads.

5. **Consistent mental model** — Schematic and PCB editors share the same interaction patterns: select, move, rotate, copy, wire/route. Learning one teaches the other.

### 5.3 Layout structure

```
┌──────────────────────────────────────────────────────────┐
│  [Logo] [Project Name ▼]     [Sch|PCB|3D]  [Share] [AI] │  ← Top bar (48px)
├──────┬───────────────────────────────────────────┬───────┤
│      │                                           │       │
│  L   │                                           │  R    │
│  e   │         INFINITE CANVAS                   │  i    │
│  f   │                                           │  g    │
│  t   │    (Schematic or PCB view)                │  h    │
│      │                                           │  t    │
│  P   │                                           │       │
│  a   │                                           │  P    │
│  n   │                                           │  a    │
│  e   │                                           │  n    │
│  l   │                                           │  e    │
│      │                                           │  l    │
│      │                                           │       │
├──────┴───────────────────────────────────────────┴───────┤
│  [Status: DRC ✓ 0 errors]  [Zoom: 100%]  [Grid: 0.1mm] │  ← Status bar (32px)
└──────────────────────────────────────────────────────────┘
```

**Panel behavior:**

- **Left panel** (collapsible, 240px default): Component browser, layer manager, design hierarchy
- **Right panel** (collapsible, 280px default): Properties inspector, AI copilot chat
- **Both panels** collapse to icon-only rail (48px) — maximizing canvas space
- **Floating contextual toolbar** appears near cursor on selection (like Figma's selection toolbar)

### 5.4 Interaction model

| Action | Mouse | Keyboard | Touch (tablet) |
|--------|-------|----------|----------------|
| Pan | Middle-click drag / Space+drag | Arrow keys | Two-finger drag |
| Zoom | Scroll wheel | `+` / `-` / `Ctrl+0` (fit) | Pinch |
| Select | Left click | — | Tap |
| Multi-select | Shift+click / drag box | — | Long press + drag |
| Place component | Double-click canvas / drag from library | `A` (add component) | Drag from panel |
| Wire / route | `W` then click-click-click, double-click to end | `W` to start | Tap-tap-tap |
| Delete | Select → `Delete` / `Backspace` | `X` (quick delete mode) | Select → trash icon |
| Undo / Redo | — | `Ctrl+Z` / `Ctrl+Shift+Z` | Toolbar buttons |
| Command palette | — | `Ctrl+K` | — |
| Rotate | `R` while dragging/selected | `R` | Rotation gesture |
| Flip | `F` while dragging/selected | `F` | Double-tap while selected |

### 5.5 Visual design tokens

```json
{
  "colors": {
    "canvas-bg": "#1E1E2E",
    "canvas-grid": "#2A2A3E",
    "wire-default": "#00D4AA",
    "wire-bus": "#5B8DEF",
    "trace-front": "#FF4444",
    "trace-back": "#4444FF",
    "copper-zone": "rgba(255, 68, 68, 0.15)",
    "component-body": "#3A3A4E",
    "component-pin": "#FFFFFF",
    "component-ref": "#FFD700",
    "component-value": "#00D4AA",
    "error": "#FF3366",
    "warning": "#FFAA00",
    "success": "#00CC88",
    "selection": "#5B8DEF",
    "hover": "rgba(91, 141, 239, 0.3)",
    "ui-surface": "#1A1A2E",
    "ui-text": "#E0E0E0",
    "ui-text-muted": "#888899",
    "ui-border": "#2A2A3E",
    "ui-accent": "#5B8DEF"
  },
  "typography": {
    "font-family": "Inter, system-ui, sans-serif",
    "font-mono": "JetBrains Mono, monospace",
    "canvas-font": "Inter",
    "font-size-xs": "11px",
    "font-size-sm": "13px",
    "font-size-md": "14px",
    "font-size-lg": "16px"
  },
  "spacing": {
    "panel-padding": "12px",
    "element-gap": "8px",
    "toolbar-height": "48px",
    "status-bar-height": "32px"
  },
  "radii": {
    "button": "6px",
    "panel": "8px",
    "tooltip": "4px"
  }
}
```

**Theming:** Dark mode is the default (standard in EDA tools). Light mode available as user preference. All canvas colors use CSS variables for theme switching.

---

## 6. Schematic Editor

### 6.1 Core features (v1.0)

#### Canvas and grid

- Infinite canvas with smooth pan/zoom (WebGL rendered)
- Configurable grid: 50mil (default), 25mil, 10mil, 1mm, custom
- Grid snap with visual snap indicator
- Ruler overlay on canvas edges (togglable)
- Zoom range: 10% to 3000%

#### Component placement

- **Drag from library panel** or **`A` key → search popup** (command palette style)
- Auto-incremented reference designator (R1, R2, C1, C2...)
- Default values assigned from library (e.g., 10kΩ for resistor)
- Rotate (`R`), flip (`F`), and mirror during placement
- Snap to grid on drop
- **Ghost preview** follows cursor before placement

#### Wiring

- Press `W` to enter wire mode
- Click to place wire vertices, double-click or `Escape` to end
- **Auto-routing wires** around obstacles (simple Manhattan routing for schematics)
- Junction dots auto-placed at T-intersections
- Wire dragging: moving a component auto-adjusts connected wires (rubber-band mode)
- **Hop-over display** for non-connected crossing wires (visual clarity)

#### Net labeling

- **Net labels** for local connections (place with `L`)
- **Power symbols** (VCC, GND, 3V3, 5V) as special components from library
- **Bus notation** for grouped signals (e.g., `DATA[0..7]`)
- Color-coded nets for visual tracing (hover a net → all connected wires highlight)

#### Sheets

- **Single-sheet designs** for v1.0 (sufficient for 2-layer boards)
- Architecture supports multi-sheet (implemented in v1.5)
- Sheet size: A4 (default), A3, Letter, custom

#### Electrical Rules Check (ERC)

- **Pin conflict detection** (output driving output, unconnected inputs, etc.)
- **Missing power connections** (power pins not connected to power nets)
- **Floating nets** (wires going nowhere)
- **Duplicate net names** across different connections
- **Real-time inline markers** — violations shown as red/yellow badges directly on the schematic, not in a separate panel
- ERC severity: Error (blocks manufacturing export) / Warning (informational) / Ignored

### 6.2 Component properties panel

When a component is selected, the right panel shows:

```
┌─────────────────────────────┐
│  R1 — Resistor              │
│  ────────────────────────── │
│  Reference:  [R1         ]  │
│  Value:      [10kΩ    ▼  ]  │  ← Dropdown with common values
│  Footprint:  [0402    ▼  ]  │  ← Visual footprint previews
│  MPN:        [RC0402FR-...] │  ← From supply chain
│  ────────────────────────── │
│  💡 Stock: 45,230 @ $0.002  │  ← Live pricing
│  📦 Alt: 8 alternatives     │  ← AI-suggested alternatives
│  ────────────────────────── │
│  [Open Datasheet]           │
│  [Find Alternatives]        │
│  [Ask AI about this part]   │
└─────────────────────────────┘
```

### 6.3 Data model (schematic objects)

```typescript
interface SchematicSheet {
  id: UUID;
  name: string;
  size: { width: number; height: number }; // nanometers
  grid: number; // nanometers
  symbols: SymbolInstance[];
  wires: Wire[];
  junctions: Junction[];
  labels: NetLabel[];
  powerSymbols: PowerSymbol[];
  graphicItems: GraphicItem[]; // text, lines, boxes for annotation
}

interface SymbolInstance {
  id: UUID;
  libraryRef: UUID;          // reference to library symbol
  position: Point;            // nanometers
  rotation: 0 | 90 | 180 | 270;
  mirrored: boolean;
  reference: string;          // "R1", "U3", etc.
  value: string;              // "10kΩ", "ATmega328P", etc.
  footprintRef: UUID;         // linked footprint from library
  fields: Record<string, string>; // MPN, datasheet URL, etc.
  pins: PinConnection[];
}

interface Wire {
  id: UUID;
  net: string;                // net name (auto-assigned or user-named)
  points: Point[];            // ordered vertices
  style: "solid" | "dashed";  // dashed for construction lines
}

interface Point {
  x: number; // nanometers (i64 in Rust)
  y: number;
}
```

---

## 7. PCB Layout Editor

### 7.1 Core features (v1.0)

#### Board setup

- **Board outline:** Draw with rectangle tool, polygon tool, or import DXF
- **Layer stackup (v1.0):**
  - F.Cu (Front Copper)
  - B.Cu (Back Copper)
  - F.SilkS (Front Silkscreen)
  - B.SilkS (Back Silkscreen)
  - F.Mask (Front Solder Mask)
  - B.Mask (Back Solder Mask)
  - F.Paste (Front Paste)
  - B.Paste (Back Paste)
  - Edge.Cuts (Board Outline)
  - Dwgs.User (User Drawings)
  - Cmts.User (User Comments)
- **Board thickness:** default 1.6mm (configurable)
- **Layer colors:** Matched to KiCad conventions for familiarity

#### Design rules (v1.0 defaults)

```json
{
  "clearance": {
    "trace_to_trace": 0.2,
    "trace_to_pad": 0.2,
    "trace_to_zone": 0.2,
    "pad_to_pad": 0.2
  },
  "trace": {
    "min_width": 0.15,
    "default_width": 0.25,
    "max_width": 2.0
  },
  "via": {
    "diameter": 0.6,
    "drill": 0.3,
    "min_diameter": 0.45,
    "min_drill": 0.2
  },
  "silkscreen": {
    "min_width": 0.12,
    "min_text_height": 0.8
  },
  "board_edge_clearance": 0.25,
  "units": "mm"
}
```

Design rules are pre-configured with **manufacturer presets**:

- "JLCPCB Standard" (min 0.127mm trace, 0.3mm drill)
- "PCBWay Standard"
- "Osh Park" (min 6mil trace, 10mil drill)
- "Custom" (user-defined)

Selecting a preset auto-populates all rules. Users can override individual values.

#### Component placement

- **Import from schematic** — `Update PCB from Schematic` button
- Components appear in a cluster outside the board outline, ready to be placed
- **Drag and snap** to grid
- **Ratsnest** (unrouted connections) shown as thin straight lines
- **Auto-group** related components (all caps for a voltage regulator stay together)
- **Placement locking** — lock placed components to prevent accidental movement
- **Courtyard visualization** — show component courtyard boundaries to prevent overlap
- AI copilot can suggest optimal placement (see Section 9)

#### Interactive routing

- **Click-to-route** — Click a pad, route follows cursor, click to place vertices, click target pad to complete
- **45° routing** (default) with option for 90° or free-angle
- **Push-and-shove** — Existing traces and vias push aside to make room (toggle on/off)
- **Via insertion** — Press `V` during routing to switch layers (places through-hole via)
- **Trace width selector** — Quick-access widget during routing: `W` cycles through preset widths
- **Net highlighting** — Hover on a net to highlight all connected traces, pads, and zones
- **Length display** — Show real-time trace length while routing
- **Routing mode toggle:** Walk-around / Push-and-shove / Highlight collisions

#### Copper zones

- Draw zone boundary (polygon), assign to net (typically GND)
- **Auto-fill** with configurable clearance, thermal relief, and priority
- Zone priority for overlapping zones
- **Hatched fill** option (reduce copper usage for non-critical zones)
- Zones update on demand (`B` to refill all zones) or auto-update on idle

#### Design Rule Check (DRC)

- **Real-time DRC** — violations highlighted as you route (red overlay on violations)
- **Full DRC run** — Button to check entire board
- Checks include: clearance violations, unrouted nets, minimum trace width, minimum drill size, silk-to-pad overlap, copper-to-edge clearance, courtyard overlap
- **DRC marker overlay** — clickable markers on violations that zoom to the issue
- DRC must pass before manufacturing export is allowed (warning, not blocking)

### 7.2 Data model (PCB objects)

```typescript
interface PCBBoard {
  id: UUID;
  outline: Polygon;                // board boundary in nanometers
  stackup: LayerStackup;
  designRules: DesignRules;
  footprints: FootprintInstance[];
  traces: Trace[];
  vias: Via[];
  zones: CopperZone[];
  graphics: GraphicItem[];         // silkscreen text, drawings
  dimensions: Dimension[];         // measurement annotations
}

interface Trace {
  id: UUID;
  net: string;
  layer: CopperLayer;
  width: number;                   // nanometers
  points: Point[];                 // ordered vertices
}

interface Via {
  id: UUID;
  net: string;
  position: Point;
  diameter: number;                // nanometers
  drill: number;                   // nanometers
  type: "through";                 // v1.0: through-hole only
  layers: [CopperLayer, CopperLayer]; // always ["F.Cu", "B.Cu"] in v1.0
}

interface CopperZone {
  id: UUID;
  net: string;
  layer: CopperLayer;
  boundary: Polygon;
  clearance: number;
  minWidth: number;
  thermalRelief: {
    gap: number;
    spokeWidth: number;
  };
  fillType: "solid" | "hatched";
  priority: number;                // higher = filled first
}

type CopperLayer = "F.Cu" | "B.Cu";
```

---

## 8. Component Library System

### 8.1 Design philosophy: "One search bar to find everything"

The library system is the tool's primary UX differentiator. Traditional EDA tools require users to understand the distinction between symbols, footprints, and 3D models — and to manually link them. Our library presents a **unified component** that bundles everything together.

### 8.2 Component data model

Inspired by Horizon EDA's 5-level hierarchy but simplified for beginners:

```
┌─────────────────────────────────────────┐
│              COMPONENT                   │
│  (What the user sees and searches for)   │
│                                          │
│  ┌──────────┐  ┌──────────┐            │
│  │ Symbol   │  │ Footprint│            │
│  │ (visual  │  │ (physical│            │
│  │  sch     │  │  pads +  │            │
│  │  repr.)  │  │  outline)│            │
│  └──────────┘  └──────────┘            │
│                                          │
│  ┌──────────┐  ┌──────────┐            │
│  │ 3D Model │  │ Metadata │            │
│  │ (.step)  │  │ (MPN,    │            │
│  │          │  │  params, │            │
│  │          │  │  stock)  │            │
│  └──────────┘  └──────────┘            │
└─────────────────────────────────────────┘
```

```typescript
interface Component {
  id: UUID;
  
  // Identity
  name: string;                    // "10kΩ Resistor"
  description: string;             // "Thick film, ±1%, 1/16W"
  category: ComponentCategory;     // "Resistors > Chip Resistor"
  tags: string[];                  // ["resistor", "smd", "0402"]
  
  // Electrical
  symbol: SymbolDefinition;        // schematic visual
  pins: PinDefinition[];           // electrical pins with types
  
  // Physical
  footprints: FootprintOption[];   // one or more footprint options
  defaultFootprint: UUID;          // which footprint is pre-selected
  model3d?: Model3DReference;      // STEP file reference
  
  // Supply chain
  mpn?: string;                    // "RC0402FR-0710KL"
  manufacturer?: string;           // "Yageo"
  datasheetUrl?: string;
  suppliers: SupplierInfo[];       // live pricing from aggregator
  lifecycle: "active" | "nrnd" | "obsolete" | "unknown";
  
  // Parameters (filterable)
  parameters: Record<string, ParameterValue>;
  // e.g., { "resistance": "10kΩ", "tolerance": "1%", 
  //         "power": "0.0625W", "voltage": "50V" }
}

interface FootprintOption {
  id: UUID;
  name: string;                    // "0402", "0603", "0805"
  pads: PadDefinition[];
  courtyard: Polygon;
  silkscreen: GraphicItem[];
  fabrication: GraphicItem[];      // fab layer graphics
}
```

### 8.3 Library tiers

#### Tier 1: Built-in essentials (~500 components)

Pre-loaded, curated, guaranteed quality. Covers 80% of beginner projects:

- **Passives:** Resistors (E24 series, 0402–1206), capacitors (common values, 0402–1206), inductors
- **Semiconductors:** Common LEDs, diodes (1N4148, 1N5819), transistors (2N2222, BSS138, IRLML6344)
- **ICs:** ATmega328P, ESP32-S3, STM32G0, RP2040, NE555, LM7805, AMS1117-3.3
- **Connectors:** Pin headers (1x2 through 2x20), USB-C, JST-PH, barrel jack, screw terminals
- **Electromechanical:** Tactile switches, slide switches, common buzzers
- **Power:** Common LDOs, USB-C PD chips, battery connectors

#### Tier 2: Cloud library (~100K+ components)

Searchable from the component browser. Downloaded on demand. Community-contributed with quality ratings.

- Sourced from: SnapEDA, Ultra Librarian, KiCad library (with attribution)
- Quality score: verified symbol, verified footprint, 3D model, datasheet linked
- User ratings and "used in X projects" metrics

#### Tier 3: User/project library

- Users create custom components using built-in editors
- **Symbol editor:** Draw pins, rectangles, text on a grid canvas
- **Footprint editor:** Place pads (SMD/through-hole), draw courtyard and silkscreen
- Save to project (local) or user library (cloud, persists across projects)

### 8.4 Search experience

The component search is the most used feature. It must be **fast, forgiving, and visual.**

**Search interface:**

```
┌────────────────────────────────────────┐
│ 🔍 [10k resistor 0402              ]  │  ← Natural language search
│                                        │
│ Filters: [Category ▼] [Package ▼]     │
│          [In Stock ☑] [Has 3D ☐]      │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ ▣ 10kΩ Resistor — 0402            │ │  ← Visual card
│ │   RC0402FR-0710KL · Yageo         │ │
│ │   $0.002 · 45,230 in stock        │ │
│ │   ★★★★★ (verified)                │ │
│ │   [Add to Schematic]              │ │
│ ├────────────────────────────────────┤ │
│ │ ▣ 10kΩ Resistor — 0603            │ │
│ │   RC0603FR-0710KL · Yageo         │ │
│ │   $0.003 · 128,400 in stock       │ │
│ │   ★★★★☆ (verified)                │ │
│ │   [Add to Schematic]              │ │
│ └────────────────────────────────────┘ │
└────────────────────────────────────────┘
```

**Search capabilities:**

- **Fuzzy matching:** "10k res" matches "10kΩ Resistor"
- **Parametric search:** "capacitor 100uF 25V" filters by parameters
- **MPN search:** "RC0402FR" finds exact manufacturer part
- **Category browsing:** Expandable tree for visual browsing
- **Recently used:** Top of search results shows recently placed components
- **AI-powered suggestions:** "I need a voltage regulator for 3.3V 500mA" → copilot suggests specific parts

---

## 9. AI Copilot

### 9.1 Interaction model

The AI copilot lives in the **right panel as a chat sidebar**. It can see the current design state and execute actions on the canvas.

```
┌───────────────────────────┐
│  🤖 AI Copilot             │
│  ─────────────────────────│
│                            │
│  You: I need to add a      │
│  voltage regulator to      │
│  power my ESP32 from USB   │
│                            │
│  AI: I'd recommend the     │
│  AMS1117-3.3 — it's a      │
│  common LDO that takes     │
│  5V USB input and outputs  │
│  a stable 3.3V at up to   │
│  1A. Here's what I'll add: │
│                            │
│  • AMS1117-3.3 (U2)       │
│  • 10µF input cap (C3)    │
│  • 10µF output cap (C4)   │
│                            │
│  [Place on Schematic]      │
│  [Show Alternatives]       │
│  [Explain Circuit]         │
│                            │
│  ─────────────────────────│
│  💬 [Ask the copilot...  ] │
└───────────────────────────┘
```

### 9.2 Copilot capabilities (v1.0)

| Capability | Description | Example Prompt |
|------------|-------------|----------------|
| **Component selection** | Recommend parts based on requirements | "I need a MOSFET that can switch 2A at 12V" |
| **Circuit suggestions** | Suggest reference circuits with components | "Add USB-C power input with ESD protection" |
| **Design review** | Check design for common mistakes | "Review my schematic for issues" |
| **Explain** | Explain any component, net, or design concept | "Why do I need a decoupling cap here?" |
| **DRC help** | Explain DRC violations and suggest fixes | "What does this clearance violation mean?" |
| **BOM optimization** | Suggest cheaper/available alternatives | "Find a cheaper alternative for U3" |
| **Place on canvas** | Execute placement actions from chat | "Place a 100nF cap between VCC and GND near U1" |
| **Routing guidance** | Suggest routing strategies | "How should I route this power trace?" |

### 9.3 Copilot architecture

```
User Message
    │
    ▼
┌──────────────┐
│ Context      │  ← Extracts: current design state, selected objects,
│ Builder      │     recent actions, design rules, component list
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ LLM Gateway  │  ← System prompt with PCB domain knowledge
│ (Claude API) │     + RAG over component datasheets
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Action       │  ← Parses LLM response for executable actions
│ Parser       │     (place component, modify property, etc.)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Canvas       │  ← Executes approved actions on design
│ Executor     │     (always with undo support)
└──────────────┘
```

**Safety rules:**

- AI never modifies the design without explicit user approval
- Every AI action is wrapped in an undo-able command
- AI suggestions include confidence indicators
- AI explanations cite datasheets and application notes when available

### 9.4 Future expansion (v2.0+)

- **Schematic generation from text:** "Design a temperature sensor board with I2C output"
- **AI auto-routing:** Reinforcement learning-powered routing (similar to Flux.ai)
- **Inline suggestions:** Proactive tips that appear contextually (like Copilot in VS Code)
- **Design-to-text:** Generate documentation from the design automatically

---

## 10. 3D Preview (ECAD-MCAD)

### 10.1 v1.0 scope: Lightweight 3D viewer

A dedicated **3D tab** renders the PCB board with placed components in 3D.

**Features:**

- **Orbit, pan, zoom** controls (trackball-style rotation)
- **Board rendering:** Green solder mask, white silkscreen, copper traces, substrate
- **Component rendering:**
  - Generic 3D shapes for components without STEP models (colored boxes sized to courtyard)
  - STEP models rendered for components that have them (from library)
- **Layer visibility toggles:** Show/hide front, back, silkscreen, copper, mask
- **Measurement tool:** Click two points to measure distance in 3D
- **Screenshot export:** PNG at configurable resolution
- **STEP export:** Export entire board assembly as STEP for import into SolidWorks, Fusion 360, etc.

**Technology:** Three.js with WebGL2 rendering. STEP parsing via opencascade.js (WASM port of OpenCascade).

### 10.2 Future expansion (v2.0+)

- Enclosure import (STEP) for fit-checking
- Board-in-enclosure clearance visualization
- Real-time bidirectional sync with external MCAD tools (IDX format)

---

## 11. Supply Chain Integration

### 11.1 Architecture

```
┌─────────────────────────────────────────────┐
│          Supply Chain Aggregator             │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ Octopart │ │ DigiKey  │ │ Mouser   │    │
│  │ API      │ │ API      │ │ API      │    │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘    │
│       │             │            │           │
│       ▼             ▼            ▼           │
│  ┌──────────────────────────────────────┐   │
│  │     Normalized Price/Stock Cache     │   │
│  │            (Redis, 1hr TTL)          │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

### 11.2 Features (v1.0)

- **Live pricing and stock** displayed in component browser and properties panel
- **Multi-supplier comparison** — show prices from 3+ distributors side by side
- **BOM cost calculator** — real-time total BOM cost as components are added
- **Stock alerts** — warning badge if a component has <100 units available
- **Lifecycle status** — active, not recommended, obsolete indicators
- **Alternative suggestions** — AI-powered cross-references (same specs, different MPN)
- **Currency:** USD default, user-selectable (EUR, GBP, CNY)

### 11.3 BOM manager

Dedicated BOM view accessible from the top navigation:

```
┌──────────────────────────────────────────────────────────────┐
│  BOM Manager                                    [Export CSV] │
│  ────────────────────────────────────────────────────────────│
│  Ref  │ Value    │ Footprint │ MPN           │ Qty │ Price  │
│  ─────┼──────────┼───────────┼───────────────┼─────┼────────│
│  R1-4 │ 10kΩ     │ 0402      │ RC0402FR-07.. │  4  │ $0.008 │
│  C1-3 │ 100nF    │ 0402      │ CC0402KRX7R.. │  3  │ $0.009 │
│  U1   │ ESP32-S3 │ QFN-56    │ ESP32-S3-W..  │  1  │ $2.85  │
│  ─────┴──────────┴───────────┴───────────────┴─────┴────────│
│  Total unique parts: 3    Total components: 8               │
│  Estimated BOM cost: $2.87 (qty 1) / $1.92 (qty 100)       │
│  ⚠ 0 parts out of stock    ✓ All parts active lifecycle     │
└──────────────────────────────────────────────────────────────┘
```

---

## 12. Manufacturing Outputs

### 12.1 Supported export formats (v1.0)

| Format | Purpose | Specification |
|--------|---------|---------------|
| **Gerber RS-274X** | Copper, mask, silkscreen, paste layers | Industry standard, universal fab acceptance |
| **Gerber X2** | Same as above with embedded metadata | Layer type, polarity, function attributes |
| **Excellon Drill** | Drill holes (plated and non-plated) | Separate files for PTH and NPTH |
| **BOM (CSV)** | Bill of materials | Ref, Value, Footprint, MPN, Qty, Supplier |
| **Pick and Place (CSV)** | SMT assembly | Ref, X, Y, Rotation, Side, Value, Footprint |
| **Board Drawing (PDF)** | Fabrication notes | Board dimensions, stackup, notes |
| **3D Assembly (STEP)** | Mechanical integration | Full board with components |

### 12.2 Export workflow

```
User clicks "Export for Manufacturing"
    │
    ▼
┌──────────────────────────────────┐
│  Pre-export checks (automated)   │
│  ─────────────────────────────── │
│  ✓ DRC passed (0 errors)        │
│  ✓ All nets routed              │
│  ✓ Board outline closed         │
│  ✓ All components have          │
│    footprints                    │
│  ⚠ 2 silkscreen overlaps        │
│    (warning, non-blocking)       │
│  ─────────────────────────────── │
│  [Continue to Export]            │
└──────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────┐
│  Export configuration            │
│  ─────────────────────────────── │
│  Preset: [JLCPCB Standard ▼]    │
│                                   │
│  ☑ Gerber files (RS-274X)        │
│  ☑ Drill files (Excellon)        │
│  ☑ BOM (CSV)                     │
│  ☑ Pick & Place (CSV)            │
│  ☐ Board drawing (PDF)           │
│  ☐ 3D model (STEP)              │
│  ─────────────────────────────── │
│  [Download ZIP]                  │
└──────────────────────────────────┘
```

**Manufacturer presets** auto-configure Gerber layer naming, drill format, and coordinate origin for common fabs:

- JLCPCB
- PCBWay
- Osh Park
- Eurocircuits
- Custom

### 12.3 DFM validation (v1.0 — basic)

Pre-export checks against selected manufacturer's capabilities:

- Minimum trace width vs. fab minimum
- Minimum drill size vs. fab minimum
- Minimum clearance vs. fab minimum
- Board outline validity (closed polygon)
- Copper-to-edge clearance
- Annular ring check

---

## 13. Project Management & Storage

### 13.1 Storage model: Hybrid cloud + local export

```
┌─────────────────────────────────────────────────┐
│                  Cloud (default)                 │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │  S3 Bucket (per user)                        │ │
│  │  ├── project-uuid-1/                         │ │
│  │  │   ├── v1/ (auto-saved snapshots)          │ │
│  │  │   ├── v2/                                 │ │
│  │  │   └── latest/                             │ │
│  │  └── project-uuid-2/                         │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  Auto-save: every 30 seconds                     │
│  Version history: last 50 snapshots (free)       │
│  Version history: unlimited (paid)               │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│              Local Export (always available)      │
│                                                   │
│  Download as .cfproj (ZIP of JSON files)         │
│  ── or ──                                        │
│  Download as .kicad project (converted)          │
│  ── or ──                                        │
│  Download individual outputs (Gerber, BOM, etc.) │
└─────────────────────────────────────────────────┘
```

### 13.2 Project dashboard

```
┌──────────────────────────────────────────────────────────┐
│  My Projects                            [+ New Project]  │
│  ────────────────────────────────────────────────────────│
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │  ┌──────┐  │  │  ┌──────┐  │  │  ┌──────┐  │        │
│  │  │ 📐   │  │  │  │ 📐   │  │  │  │  +   │  │        │
│  │  │ thumb│  │  │  │ thumb│  │  │  │ New  │  │        │
│  │  └──────┘  │  │  └──────┘  │  │  └──────┘  │        │
│  │  Sensor    │  │  LED       │  │             │        │
│  │  Board v2  │  │  Driver    │  │  Start from │        │
│  │  Modified  │  │  Modified  │  │  Template   │        │
│  │  2h ago    │  │  3d ago    │  │             │        │
│  └────────────┘  └────────────┘  └────────────┘        │
│                                                          │
│  Templates:                                              │
│  [Arduino Shield] [ESP32 Dev] [Sensor Board] [Blank]    │
└──────────────────────────────────────────────────────────┘
```

### 13.3 Version history

- **Auto-save** every 30 seconds (background, non-blocking)
- **Named versions** — user can tag a snapshot (e.g., "v1.0 — sent to fab")
- **Version compare** — side-by-side visual diff between two versions
- **Restore** — revert to any previous version
- **Local backup** — auto-download .cfproj backup weekly (configurable)

---

## 14. File Import/Export

### 14.1 Import (v1.0)

| Format | Support Level | Notes |
|--------|---------------|-------|
| KiCad 7/8/9/10 (.kicad_sch, .kicad_pcb) | Full | S-expression parser in Rust/WASM. Maps symbols, footprints, traces, zones, design rules. |
| Eagle (.sch, .brd) via KiCad conversion | Guided | UI wizard: "Import Eagle file → we'll convert via KiCad format" |

**Import workflow:**

1. User drags file onto dashboard or clicks "Import"
2. Parser validates file, shows preview of what will be imported
3. **Import report** shows: components found, unmapped footprints, design rule conflicts
4. User resolves any mapping issues (e.g., missing footprints → choose from library)
5. Project opens in editor

### 14.2 Export (v1.0)

| Format | Purpose |
|--------|---------|
| .cfproj (native) | Full project archive |
| KiCad (.kicad_sch, .kicad_pcb) | Interoperability with KiCad |
| Gerber + Drill (ZIP) | Manufacturing |
| BOM (CSV) | Procurement |
| Pick & Place (CSV) | Assembly |
| STEP (3D) | Mechanical CAD |
| PDF (board drawing) | Documentation |
| PNG/SVG (schematic) | Documentation / sharing |

### 14.3 Future imports (v1.5+)

- Altium (.SchDoc, .PcbDoc) — reverse-engineered OLE parsing
- EasyEDA (JSON) — relatively straightforward
- LTspice (.asc) — schematic only

---

## 15. Onboarding & Education

### 15.1 First-run experience

**Step 1: Welcome screen** (5 seconds)

```
Welcome to CircuitForge!
Design your first PCB in minutes.

[Start with a Template]  ← recommended for beginners
[Create Blank Project]
[Import Existing Design]
```

**Step 2: Interactive tutorial** (if template selected) — "Blink LED Board"

A guided walkthrough that builds a complete 1-LED PCB:

1. **Place components** — Guided placement of LED, resistor, connector (highlights where to click, what to search)
2. **Wire the schematic** — Step-by-step wiring with visual hints
3. **Run ERC** — Shows what the check does and why
4. **Switch to PCB** — Explains the schematic-to-PCB transition
5. **Place footprints** — Drag components onto the board
6. **Route traces** — Interactive routing tutorial
7. **Run DRC** — Explains manufacturing constraints
8. **Export Gerber** — Download manufacturing files
9. **Celebrate** — "You just designed a PCB! 🎉"

**Duration:** ~15 minutes. Skippable at any step.

### 15.2 Contextual help

- **Tooltip hints** on hover for all tools and buttons
- **"What is this?"** context menu option on any object → opens explanation panel
- **AI copilot** always available for questions
- **Keyboard shortcut cheat sheet** — `?` key opens overlay
- **Interactive video links** — short (30–60s) embedded videos for complex features

### 15.3 Templates library

Pre-built project templates for common use cases:

| Template | Components | Complexity |
|----------|------------|------------|
| Blink LED | LED, resistor, header | Trivial |
| Arduino Shield | Headers, prototyping area | Easy |
| ESP32 Dev Board | ESP32, USB-C, regulator, buttons | Medium |
| Sensor Breakout | I2C sensor, level shifter, headers | Medium |
| Motor Driver | H-bridge, capacitors, connectors | Medium |
| USB-C PD Sink | PD controller, FET, connectors | Advanced |

Templates include completed schematics, partially routed PCBs, and explanatory comments.

---

## 16. Pricing & Licensing

### 16.1 Tier structure

| Feature | Personal (Free) | Team ($35/month per editor) |
|---------|-----------------|---------------------------|
| Projects | 3 active | Unlimited |
| Layers | 2 | 2 (v1.0), scaling in later versions |
| Board size | 100mm × 100mm max | Unlimited |
| Component library | Full access | Full access |
| AI copilot | 20 messages/day | Unlimited |
| Supply chain data | Basic (price only) | Full (price + stock + lifecycle + alternatives) |
| Export formats | Gerber, BOM, CSV | All formats + STEP + PDF |
| Version history | Last 10 versions | Unlimited + named versions |
| Cloud storage | 500 MB | 10 GB per seat |
| Team workspace | — | ✓ (shared projects, permissions) |
| Priority support | — | ✓ (email + chat) |
| Local export (.cfproj) | ✓ (always) | ✓ (always) |

### 16.2 Principles

- **No design hostage** — Designs are always exportable, even on the free tier, even if subscription lapses
- **No feature crippling** — Free tier is genuinely useful, not a demo
- **Students** — Free Pro access with .edu email (6-month grants, renewable)
- **Open-source projects** — Free Pro access for public hardware projects

---

## 17. Performance Requirements

### 17.1 Target benchmarks

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial load time | < 3 seconds | Time from URL to interactive canvas (cached) |
| Cold start | < 6 seconds | First visit, no cache |
| Component search latency | < 200ms | Keystroke to results rendered |
| Canvas FPS (idle) | 60 FPS | Smooth pan/zoom with 200 components |
| Canvas FPS (routing) | 30+ FPS | During interactive push-and-shove routing |
| DRC full run | < 2 seconds | 200-component, 2-layer board |
| Gerber export | < 3 seconds | Complete ZIP generation |
| Auto-save | < 500ms | Background save, non-blocking |
| AI copilot response | < 3 seconds | Time to first token |
| WASM core load | < 1 second | Rust/WASM module initialization |

### 17.2 Browser support

| Browser | Minimum Version | WebGL2 | WebGPU | WASM |
|---------|----------------|--------|--------|------|
| Chrome | 90+ | ✓ | ✓ (preferred) | ✓ |
| Firefox | 90+ | ✓ | Flag only | ✓ |
| Safari | 15.4+ | ✓ | ✓ (16.4+) | ✓ |
| Edge | 90+ | ✓ | ✓ | ✓ |

**Minimum hardware:** 4 GB RAM, integrated GPU with WebGL2 support, 1280×720 screen.

**Recommended:** 8 GB RAM, discrete GPU, 1920×1080+ screen.

---

## 18. Security & Compliance

### 18.1 Data security

- **Encryption at rest:** AES-256 for all stored project data
- **Encryption in transit:** TLS 1.3 for all API communication
- **Authentication:** OAuth 2.0 (Google, GitHub, email/password)
- **Authorization:** Role-based access control (Owner, Editor, Viewer) for team workspaces
- **Data residency:** US-East (default), EU (optional for paid tiers)
- **Backup:** Daily automated backups with 30-day retention

### 18.2 Privacy

- **No design data used for AI training** — explicit policy, contractually guaranteed
- **No analytics on design content** — we track usage patterns (clicks, features used), never design specifics
- **GDPR compliant** — data export, deletion requests honored within 72 hours
- **SOC 2 Type I** — targeted for 18 months post-launch

### 18.3 IP protection

- Users retain full intellectual property rights to all designs
- Open file format specification enables vendor-independent access
- Local export always available regardless of account status

---

## 19. Development Phases & Roadmap

### Phase 1: Foundation (Months 1–4)

**Goal:** Core editor functional with basic component placement and wiring.

- [ ] Rust/WASM core: data model, coordinate system, object management
- [ ] WebGL2 canvas renderer: pan, zoom, grid, snap
- [ ] React UI shell: panels, toolbar, command palette
- [ ] Schematic editor: component placement, wiring, net labels
- [ ] Built-in component library (Tier 1: ~200 essential parts)
- [ ] Basic ERC (pin conflicts, unconnected pins)
- [ ] Project save/load (cloud + local export)
- [ ] Authentication (OAuth)

### Phase 2: PCB Editor (Months 4–7)

**Goal:** Complete schematic-to-PCB-to-Gerber workflow.

- [ ] Schematic-to-PCB netlist transfer (forward annotation)
- [ ] PCB canvas: board outline, layer management (2 layers)
- [ ] Component placement on PCB (drag, rotate, snap)
- [ ] Ratsnest display
- [ ] Interactive routing (click-to-route, 45° angles)
- [ ] Push-and-shove router (Rust/WASM)
- [ ] Via insertion
- [ ] Copper zone fills (GND plane)
- [ ] DRC engine (clearance, width, drill checks)
- [ ] Gerber RS-274X + Excellon export
- [ ] BOM and Pick & Place CSV export

### Phase 3: Differentiators (Months 7–10)

**Goal:** AI copilot, supply chain, and 3D preview — the competitive edge.

- [ ] AI copilot chat sidebar (LLM integration)
- [ ] AI component suggestions and circuit references
- [ ] Supply chain aggregator (Octopart/DigiKey/Mouser APIs)
- [ ] Live pricing in component browser and BOM manager
- [ ] 3D preview viewer (Three.js)
- [ ] STEP export
- [ ] KiCad import parser (.kicad_sch, .kicad_pcb)
- [ ] Manufacturer presets for export
- [ ] DFM validation (basic)
- [ ] Component library expansion (Tier 2: cloud library)

### Phase 4: Polish & Launch (Months 10–12)

**Goal:** Production-ready with onboarding and team features.

- [ ] Interactive onboarding tutorial ("Blink LED" walkthrough)
- [ ] Project templates (6+ starter templates)
- [ ] Team workspaces (shared projects, roles)
- [ ] Version history with visual diff
- [ ] Performance optimization (target benchmarks)
- [ ] Gerber X2 export
- [ ] PDF board drawing export
- [ ] Keyboard shortcut customization
- [ ] Dark/light theme toggle
- [ ] Landing page, documentation site, billing integration
- [ ] Beta program → public launch

### Post-launch roadmap (v1.5 — v3.0)

| Version | Key Features |
|---------|-------------|
| v1.5 | Real-time multiplayer collaboration, 4-layer support, one-click ordering |
| v2.0 | Desktop app (Electron/Tauri), 8+ layers, differential pairs, length matching |
| v2.5 | AI auto-routing (RL-based), hierarchical schematics, advanced DFM |
| v3.0 | 16+ layers, ECAD-MCAD bidirectional sync, plugin marketplace, SPICE simulation |

---

## 20. Success Metrics

### 20.1 North star metric

**Boards successfully exported for manufacturing per month.**

This captures the full value chain: users acquired → designs created → designs completed → manufacturing files generated.

### 20.2 Key metrics by category

| Category | Metric | Target (Month 6 post-launch) |
|----------|--------|------------------------------|
| **Acquisition** | Monthly signups | 5,000 |
| **Activation** | Users who place ≥1 component in first session | 60% of signups |
| **Engagement** | Weekly active users (WAU) | 30% of total users |
| **Retention** | 30-day retention | 25% |
| **Conversion** | Free → paid conversion | 5% of active users |
| **Completion** | Projects with Gerber export | 15% of created projects |
| **AI usage** | Copilot messages per active user per week | 10+ |
| **NPS** | Net Promoter Score | 40+ |
| **Performance** | P95 canvas frame time | < 33ms (30 FPS) |
| **Reliability** | Uptime | 99.9% |

---

## Appendix A: Data Model Schema

### Complete entity relationship

```
User (1) ──── (N) Project
Project (1) ──── (1) Schematic
Project (1) ──── (1) PCBLayout
Project (1) ──── (N) ProjectComponent (BOM entry)
Schematic (1) ──── (N) SchematicSheet
SchematicSheet (1) ──── (N) SymbolInstance
SchematicSheet (1) ──── (N) Wire
SchematicSheet (1) ──── (N) NetLabel
PCBLayout (1) ──── (1) BoardOutline
PCBLayout (1) ──── (N) FootprintInstance
PCBLayout (1) ──── (N) Trace
PCBLayout (1) ──── (N) Via
PCBLayout (1) ──── (N) CopperZone
Component (library) (1) ──── (N) FootprintOption
Component (library) (1) ──── (1) SymbolDefinition
Component (library) (1) ──── (0..1) Model3DReference
Component (library) (1) ──── (N) SupplierInfo
SymbolInstance (N) ──── (1) Component (library ref)
FootprintInstance (N) ──── (1) Component (library ref)
FootprintInstance (1) ──── (1) FootprintOption
```

### Database tables (PostgreSQL)

```sql
-- Core entities
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    avatar_url TEXT,
    plan TEXT DEFAULT 'free',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    thumbnail_url TEXT,
    storage_url TEXT NOT NULL,          -- S3 path to .cfproj
    is_public BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id),
    version_number INTEGER NOT NULL,
    label TEXT,                          -- user-defined name (nullable)
    storage_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Team features
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    owner_id UUID REFERENCES users(id),
    plan TEXT DEFAULT 'team',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_members (
    team_id UUID REFERENCES teams(id),
    user_id UUID REFERENCES users(id),
    role TEXT CHECK (role IN ('owner', 'editor', 'viewer')),
    PRIMARY KEY (team_id, user_id)
);

-- Component library metadata (cloud cache)
CREATE TABLE components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    mpn TEXT,
    manufacturer TEXT,
    description TEXT,
    parameters JSONB,                   -- {"resistance": "10kΩ", ...}
    datasheet_url TEXT,
    symbol_data JSONB,                  -- symbol definition
    footprint_data JSONB,               -- footprint options
    model3d_url TEXT,                   -- S3 path to STEP file
    quality_score REAL DEFAULT 0,       -- 0-5 rating
    source TEXT,                        -- "builtin", "community", "snapeda"
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_components_search ON components 
    USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '') || ' ' || COALESCE(mpn, '')));
CREATE INDEX idx_components_category ON components (category);
CREATE INDEX idx_components_mpn ON components (mpn);
```

---

## Appendix B: API Surface

### REST API endpoints (v1.0)

```
Authentication
  POST   /api/auth/signup
  POST   /api/auth/login
  POST   /api/auth/oauth/{provider}
  POST   /api/auth/refresh

Projects
  GET    /api/projects                      # list user's projects
  POST   /api/projects                      # create new project
  GET    /api/projects/:id                  # get project metadata
  PUT    /api/projects/:id                  # update metadata
  DELETE /api/projects/:id                  # delete project
  GET    /api/projects/:id/download         # download .cfproj
  POST   /api/projects/:id/upload           # upload .cfproj
  GET    /api/projects/:id/versions         # list version history
  POST   /api/projects/:id/versions         # create named version
  GET    /api/projects/:id/versions/:vid    # download specific version

Components
  GET    /api/components/search?q=...       # full-text search
  GET    /api/components/:id                # get component details
  GET    /api/components/categories         # list category tree
  POST   /api/components                    # create user component

Supply Chain
  GET    /api/supply/pricing/:mpn           # get live pricing
  GET    /api/supply/stock/:mpn             # get stock levels
  GET    /api/supply/alternatives/:mpn      # get cross-references
  POST   /api/supply/bom-price              # price entire BOM

AI Copilot
  POST   /api/ai/chat                       # send message, get response
  POST   /api/ai/suggest-component          # component recommendation
  POST   /api/ai/review-design              # design review

File Operations
  POST   /api/import/kicad                  # import KiCad project
  POST   /api/export/gerber/:projectId      # generate Gerber ZIP
  POST   /api/export/bom/:projectId         # generate BOM CSV
  POST   /api/export/step/:projectId        # generate STEP file
  POST   /api/export/kicad/:projectId       # export as KiCad format

Teams (paid tier)
  POST   /api/teams                         # create team
  GET    /api/teams/:id/members             # list members
  POST   /api/teams/:id/members             # invite member
  DELETE /api/teams/:id/members/:userId     # remove member
```

### WebSocket events (real-time)

```
Client → Server:
  project:open          # join project session
  project:close         # leave project session
  design:change         # send design change delta

Server → Client:
  project:saved         # auto-save confirmation
  drc:result            # DRC check results
  ai:response           # AI copilot streaming response
  supply:update         # price/stock change notification
```

---

## Appendix C: Competitive Positioning

### Feature comparison (v1.0 vs. market)

| Feature | Our v1.0 | Flux.ai | EasyEDA | KiCad 10 |
|---------|----------|---------|---------|----------|
| Zero install (browser) | ✓ | ✓ | ✓ | ✗ |
| Figma-like UX | ✓ | Partial | ✗ | ✗ |
| AI copilot | ✓ | ✓ | ✗ | ✗ |
| Live supply chain | ✓ | ✓ | ✓ (LCSC only) | ✗ |
| 3D preview | ✓ | ✓ | ✓ | ✓ |
| KiCad import | ✓ | ✗ | ✓ | N/A |
| Local export (no lock-in) | ✓ | ✗ | Partial | N/A |
| Free tier | ✓ (generous) | Limited | ✓ | ✓ (full) |
| Beginner tutorials | ✓ (interactive) | ✗ | ✗ | ✗ |
| Open file format | ✓ (JSON spec published) | ✗ | Partial | ✓ |
| Command palette | ✓ | ✗ | ✗ | ✗ |
| Push-and-shove routing | ✓ | ✗ | Limited | ✓ |

### Key differentiators summary

1. **Figma-like UX** — No other PCB tool has this interaction model
2. **AI + supply chain + 3D** combined in a beginner-friendly package
3. **No design lock-in** — Open format, local export always available
4. **KiCad import** — Catches Eagle refugees who've already converted to KiCad
5. **Interactive onboarding** — First PCB tool with a guided tutorial that builds a real board

---

*End of specification. This document should be treated as a living reference — update as decisions are validated through user research and technical prototyping.*
