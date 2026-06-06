# OpenPCB — Website Design Notes

> **Generated:** 2026-05-16  
> **Version:** 0.1.1-dev  
> **Purpose:** Reference for designing the OpenPCB marketing/product website. Contains the current feature set, UX flows, and immediate next features.

---

## 1. Product Identity

**OpenPCB** is a modern, open-source, **local-first** desktop application for electronic schematic capture and PCB layout design. It is intended to be simple to use while remaining powerful enough for real hardware projects.

- **Tagline direction:** "PCB design, on your machine." / "Local. Fast. Open."
- **Packaging:** Electron Forge — macOS (DMG, ZIP), Windows (Squirrel), Linux (deb, rpm, AppImage)
- **Positioning:** An alternative to cloud-locked EDA tools. KiCad-compatible. No login, no cloud dependency, no subscription.
- **Target users:** Hobbyists, makers, students, indie hardware engineers.

---

## 2. Architecture at a Glance

| Layer     | Technology                                                             |
| --------- | ---------------------------------------------------------------------- |
| Frontend  | React 19, Vite 7, Tailwind 4, React Three Fiber (R3F)                  |
| Backend   | Bun HTTP server, SQLite (Drizzle ORM)                                  |
| Desktop   | Electron (Forge packaging)                                             |
| Rendering | WebGL via R3F — all canvases are 3D scenes, no Canvas2D                |
| Modules   | 4 runtime modules: **Designer**, **Library**, **Tasks**, **Assistant** |

The app uses a **module system** where the backend discovers modules, resolves dependencies, and lazy-loads frontend code. The UI is a single-page app with no React Router — navigation is handled via a Zustand store and an app shell.

---

## 3. Modules & Screens

### 3.1 App Shell

- **Left sidebar** (80px wide) with module icons: Designer, Library, Tasks, Assistant.
- **Settings dialog** (`Ctrl/Cmd + ,`) with tabs: General, Assistant, About.
- **Theme toggle:** Light / Dark mode.
- **Global context menu:** Right-click anywhere → Settings, app actions.
- **Home screen:** Design list with create / open / delete. Card grid layout with revision badges and relative timestamps.

### 3.2 Designer Module (The Core)

The main workspace. Opens in tabs. Each design has 4 view modes via a top-center tab switcher:

| Tab       | Status         | Description                             |
| --------- | -------------- | --------------------------------------- |
| **Schem** | ✅ Active      | Schematic capture editor                |
| **PCB**   | ✅ Active      | PCB layout editor                       |
| **3D**    | ✅ Active      | Interactive 3D board preview            |
| **BOM**   | 🚧 Placeholder | Bill of Materials (not yet implemented) |

#### Schematic Editor (Schem)

- **Canvas:** Infinite pan/zoom R3F canvas with demand rendering.
- **Component placement:** Command palette (`Cmd/Ctrl + K`) to search library components by name, tag, or description. Live symbol preview in palette.
- **Wire routing:** Manhattan (orthogonal) wire drawing. Click-to-place segments. Junction dots auto-detected.
- **Net labels:** Place named labels to connect nets across the sheet.
- **Power ports:** GND and PWR symbols available from floating toolbar.
- **Selection:** Click to select part, wire, or label. Shift-click multi-select. Marquee selection (rubber-band box).
- **Outline panel (left sidebar):** Searchable tree of Components, Nets, and Labels. Click to frame canvas. Actions: rename, duplicate, delete.
- **Selection inspector (right overlay):** Contextual panel for selected item(s) — edit reference, value, footprint variant.
- **Floating toolbar:** Undo/Redo, Zoom In/Out, Fit, Grid toggle, quick-place buttons (Components, GND, PWR, Net Portal).
- **Keyboard shortcuts:** `Cmd/Ctrl+K` (palette), `Cmd/Ctrl+W` (close tab), `R` (rotate), `G` (place GND), `P` (place PWR), `H` (place net portal), `Del` (delete), `Esc` (clear selection).
- **Design tabs:** Draggable, reorderable, renameable (double-click), middle-click to close, context menu for Close / Close Others / Close All.

#### PCB Editor (PCB)

- **Canvas:** Dark-themed R3F canvas. Grid snap toggle.
- **Tool modes:** Select (default), Route, Hole.
- **Trace routing:**
  - Manhattan 90° and 45° modes.
  - Click-to-route from pad → pad or pad → empty space.
  - **Smart Via:** Press `V` or `+/-` during routing to drop a via and continue on opposite layer.
  - Width presets cycle with `W` / `Shift+W`. Custom width via `Alt+W`.
  - Posture toggle (`/` or `F`) flips elbow direction.
  - Backspace removes last segment. Escape cancels.
  - **Split-and-reroute:** Right-click a trace → "Split and reroute from here."
- **Layer system:** F.Cu (top), B.Cu (bottom), In1.Cu, In2.Cu. Active layer pill follows cursor.
- **View flip:** Toggle top/bottom view (`Shift+F`). Flips active layer accordingly.
- **Selection filter:** Toggle visibility of selectable primitives (pads, traces, vias, placements).
- **Disambiguation popup:** Alt+click when multiple items overlap → cycle through candidates.
- **Snap targets:** Visual indicators when cursor snaps to pad centers, trace endpoints, or via centers.
- **Marquee selection:** Same KiCad-style window/crossing modes as schematic.
- **Placement actions:** Rotate 90°, Flip side (F.Cu ↔ B.Cu), Drag-move (single or group), Delete.
- **Free holes:** Drop mounting holes with configurable drill size.
- **Ratsnest:** Visual airwires showing unconnected nets. Toggle visibility.
- **Live DRC:** Real-time design rule checking with violation count.
- **Context menu:** Rich context menus for traces, vias, placements, and empty canvas (mode toggle, layer switch, ratsnest toggle).
- **Board panel (sidebar):** Board size, layer visibility toggles, opacity sliders, net class list.

#### 3D Preview

- **Interactive 3D board:** Orbit controls, realistic lighting.
- **Board substrate:** Rendered with correct thickness.
- **Copper traces & vias:** Extruded geometry from PCB data.
- **Component models:** GLB models loaded from library. Missing models shown as footprint overlay.
- **Empty state:** Prompts user to add placements/traces/vias.
- **Model cache:** Reuses downloaded models across views.

#### Design Management

- **Create design:** From HomeScreen or Designer empty state. Auto-named "Untitled Design".
- **Rename:** Double-click tab or use outline panel.
- **Undo/Redo:** Full command history with revision-based conflict detection.
- **Auto-save:** Commands persisted to SQLite immediately.
- **No dedicated onboarding:** First-run guidance handled by empty states only.

### 3.3 Library Module (Component Catalog)

The component library where all symbols, footprints, and 3D models live.

- **Browse view:** Card grid of all components. Search by name/description. Tag filter chips (grouped by category).
- **Sort:** By name or "as loaded" (recent-first proxy).
- **Bulk actions:** Select multiple non-built-in components → Delete.
- **Component card:** Name, description, tags, mount type badge, package code badge, "Core" badge for built-ins.
- **Component detail page:**
  - **Symbol preview:** Interactive canvas with symbol rendering. Metadata: name, reference prefix, pin count, warnings.
  - **Footprint preview:** Interactive canvas with footprint rendering. Metadata: name, mount type, pad count, package code, warnings.
  - **3D preview:** Interactive 3D model viewer. Upload STEP file button (converts to GLB client-side).
  - **Footprint variants:** If multiple footprints linked, shows list with default marker.
  - **Actions:** Edit (name, description, tags), Duplicate, Back.
  - **Built-in protection:** Built-in components are read-only; user must duplicate to edit.
- **Import wizard (4 steps):**
  1. **Symbol:** Upload KiCad `.kicad_sym` OR draw symbol from scratch using symbol editor.
  2. **Footprints:** Upload KiCad `.kicad_mod`, generate from IPC-7351B preset, OR draw footprint from scratch.
  3. **3D Model:** Optional STEP file upload.
  4. **Metadata:** Name, description, tags.
- **Symbol editor tools:** Select, Line, Rectangle, Circle, Arc, Pin, Text.
- **Footprint editor tools:** Select, Line, Rectangle, Circle, Arc, Pad, Text. Layer panel for copper/silkscreen/mask/etc. Pad property panel.
- **ZIP upload:** Direct ZIP upload of KiCad libraries for quick import.

### 3.4 Tasks Module

- Hidden from sidebar by default.
- System-level task/background job management.

### 3.5 Assistant Module

- Dev-only availability.
- AI assistant integration (icon: Bot).
- Depends on Tasks module.

---

## 4. Feature Completeness Matrix

| Feature                  | Status         | Notes                                                         |
| ------------------------ | -------------- | ------------------------------------------------------------- |
| Schematic capture        | ✅ Complete    | Wire routing, symbols, labels, power ports, ERC backend       |
| Schematic ERC (backend)  | ✅ Complete    | Electrical rule checking engine exists                        |
| Schematic ERC (UI panel) | 🚧 Missing     | No frontend ERC report panel yet                              |
| PCB trace routing        | ✅ Complete    | Manhattan 90/45, smart via, width cycling, reroute            |
| PCB layer system         | ✅ Complete    | F.Cu, B.Cu, In1.Cu, In2.Cu, silkscreen, mask, paste, drill    |
| PCB DRC (live)           | 🚧 Partial     | Live routing checks trace-trace and trace-pad clearances only |
| Copper zones (fill)      | 🚧 Partial     | Visual rendering exists; manufacturing export missing         |
| PCB ratsnest             | ✅ Complete    | Airwire visualization, toggle                                 |
| PCB placement            | ✅ Complete    | Drag, rotate, flip, multi-select, marquee                     |
| 3D board preview         | ✅ Complete    | Traces, vias, substrate, component models                     |
| Component library        | ✅ Complete    | Search, tags, preview, detail, editing                        |
| KiCad import             | ✅ Complete    | `.kicad_sym` + `.kicad_mod` + ZIP batch                       |
| Symbol editor            | ✅ Complete    | Draw from scratch with full toolset                           |
| Footprint editor         | ✅ Complete    | Draw from scratch with pad/layer support                      |
| IPC-7351B presets        | ✅ Complete    | Auto-generate footprints from standard                        |
| 3D model upload          | ✅ Complete    | STEP → GLB conversion, preview                                |
| STEP conversion          | ✅ Complete    | Client-side OCCT worker conversion                            |
| Design management        | ✅ Complete    | CRUD, tabs, undo/redo, rename                                 |
| BOM view                 | 🚧 Placeholder | Tab exists but shows placeholder                              |
| Manufacturing export     | ❌ Not started | No Gerber, drill, pick-and-place, or BOM export yet           |
| Netlist export           | ❌ Not started | No SPICE or netlist export                                    |
| Copper fill (zones)      | 🚧 Partial     | Visual rendering exists; manufacturing export missing         |
| Design rule presets      | ✅ Complete    | JLCPCB / PCBWay fab presets for validation                    |
| ERC report UI            | 🚧 Missing     | Backend engine ready, no frontend panel                       |
| Multi-sheet schematics   | ❌ Not started | Single sheet only                                             |
| Hierarchical design      | ❌ Not started | Flat design only                                              |
| Design versioning        | 🚧 Partial     | Revision tracking exists, no branching/history browser        |
| Collaborative editing    | ❌ Not started | Single-user only                                              |
| Cloud sync               | ❌ Not started | Local SQLite only                                             |
| SPICE simulation         | ❌ Not started | Not on roadmap currently                                      |
| Pick-and-place export    | ❌ Not started | Not yet implemented                                           |
| Gerber export            | ❌ Not started | Not yet implemented (metadata groundwork exists)              |
| Drill file export        | ❌ Not started | Not yet implemented                                           |

---

## 5. UX Flows (User Journeys)

### 5.1 First Launch → First Schematic

1. App boots → HomeScreen shows "No designs yet" empty state.
2. User clicks "New Design" → Design created → Auto-opened in Designer tab.
3. Designer shows empty state: "No design open" → "New design" button.
4. User clicks → New tab created, Schem view active.
5. User presses `Cmd/Ctrl+K` → Component palette opens.
6. User searches "resistor" → Selects → Symbol ghost follows cursor → Click to place.
7. User places second resistor → Presses `W` (or clicks wire mode implicitly) → Draws wire between pins.
8. User presses `H` → Places net label "VCC".
9. User clicks GND in floating toolbar → Places GND port.
10. User saves implicitly (every command auto-persists).

### 5.2 Schematic → PCB Flow

1. User switches to **PCB** tab.
2. PCB canvas shows board outline (default size) and ratsnest airwires.
3. User clicks "Route" (or presses `R`) → Clicks pad → Trace follows cursor.
4. User routes to another pad → Click → Trace committed.
5. User needs to switch layer → Presses `V` → Smart via drops, continues on B.Cu.
6. User presses `Shift+F` → Flips board view to inspect bottom side.
7. User switches to **3D** tab → Rotates board to verify.

### 5.3 Adding a Custom Component

1. User navigates to **Library** module.
2. Clicks "New" → Import Wizard opens.
3. **Step 1 (Symbol):** User clicks "Draw" → Symbol editor opens → Draws shape, adds pins, saves.
4. **Step 2 (Footprint):** User selects "Generate from preset" → Enters package code → Preview generated.
5. **Step 3 (3D):** Optional STEP upload.
6. **Step 4 (Metadata):** Names component, adds tags.
7. Clicks "Import component" → Component appears in library.
8. Returns to Designer → `Cmd/Ctrl+K` → New component appears in palette.

### 5.4 Importing from KiCad

1. User goes to Library → "Upload ZIP".
2. Selects ZIP containing `.kicad_sym` and `.kicad_mod` files.
3. Backend inspects → Component detail page opens.
4. If warnings: Toast notification shown.
5. If 3D model needs conversion: Background conversion starts, toast updates.

---

## 6. Visual Design System

| Token            | Value                   |
| ---------------- | ----------------------- |
| Primary accent   | Violet-600 (`#7c3aed`)  |
| Dark canvas bg   | Slate-950 (`#020617`)   |
| Light canvas bg  | Slate-50 (`#f8fafc`)    |
| Panel bg (dark)  | Slate-900 (`#0f172a`)   |
| Panel bg (light) | White                   |
| Border (dark)    | Slate-800 (`#1e293b`)   |
| Border (light)   | Slate-200 (`#e2e8f0`)   |
| Error            | Red-600 (`#dc2626`)     |
| Warning          | Amber-500 (`#f59e0b`)   |
| Success          | Emerald-500 (`#10b981`) |

- **Typography:** System sans-serif, small sizes dominant (text-xs, text-sm). Dense UI.
- **Font stack:** Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif.
- **Icons:** Lucide React icons throughout.
- **Components:** Custom UI primitives built on Radix (Dialog, ContextMenu, Tabs, ScrollArea).
- **Border radius:** Consistent rounded-lg, rounded-xl for cards.
- **Shadows:** Subtle shadow-sm for toolbars, shadow-lg for modals.
- **Backdrop blur:** Used for floating toolbars and overlays.
- **Scrollbar:** Hidden on tabs, thin on panels.

### Dark Mode

- PCB canvas is **always dark** regardless of app theme.
- 3D view has its own dark token set.
- Schematic and Library follow app theme.

---

## 7. Keyboard Shortcuts Reference

| Shortcut           | Action                                                          |
| ------------------ | --------------------------------------------------------------- |
| `Cmd/Ctrl + K`     | Open component palette                                          |
| `Cmd/Ctrl + W`     | Close active design tab                                         |
| `Cmd/Ctrl + ,`     | Open Settings                                                   |
| `R`                | Rotate selected placement 90° (Select mode) / Toggle Route mode |
| `F`                | Flip selected placement side / Cycle route posture              |
| `G`                | Place GND port                                                  |
| `P`                | Place PWR port                                                  |
| `H`                | Place net portal / Toggle Hole tool                             |
| `X`                | Toggle Select / Route mode (PCB)                                |
| `V` / `+` / `-`    | Smart Via (drop via + switch layer)                             |
| `W` / `Shift+W`    | Cycle trace width preset                                        |
| `Alt + W`          | Custom trace width prompt                                       |
| `/`                | Toggle route posture                                            |
| `Shift + F`        | Flip PCB view side                                              |
| `Shift + Space`    | Toggle Manhattan 90° / 45°                                      |
| `Backspace`        | Remove last route segment                                       |
| `Esc`              | Cancel route / Clear selection                                  |
| `Del`              | Delete selected item                                            |
| `Alt + Click`      | Disambiguation popup (PCB)                                      |
| `Middle Click`     | Close tab                                                       |
| `Double Click tab` | Rename design                                                   |

---

## 8. Immediate Next Features (Post-Website)

These are the **highest-priority upcoming features** that should be mentioned on the website as "coming soon" or part of the roadmap:

### 8.1 Manufacturing Export (Critical)

- **Gerber export** (RS-274X) — all copper layers, solder mask, silkscreen, edge cuts.
- **Drill file export** (Excellon) — plated and non-plated holes.
- **Pick-and-place export** (CSV) — component positions, rotations, layers.
- **BOM export** (CSV) — component references, values, footprints, quantities.
- These are the biggest blockers for users wanting to actually fabricate boards.

### 8.2 ERC Report UI

- Frontend panel showing electrical rule check results.
- Navigate to error location from report.
- Similar to KiCad's ERC dialog.

### 8.3 BOM View

- Replace placeholder with actual bill of materials table.
- Group by component, show quantity, reference designators.
- Export to CSV.

### 8.4 Multi-Sheet Support

- Ability to create multiple schematic sheets per design.
- Sheet-to-sheet connectors / hierarchical labels.

### 8.5 Copper Zones / Pours

- Polygon copper fills connected to nets.
- Thermal relief patterns.

### 8.6 Design Rule Editor

- User-editable DRC rules (clearances, trace widths, via sizes).
- Manufacturer preset selector (JLCPCB, PCBWay, etc.).

### 8.7 Component Variant System

- Per-design BOM variants (e.g., "assembled" vs "DIY").
- DNP (Do Not Populate) flagging.

### 8.8 Net Classes UI

- Visual editor for net class rules (width, clearance, via size).
- Assign nets to classes in schematic.

---

## 9. Unique Selling Points (for Website Copy)

1. **Local-first & Private:** Everything runs on your machine. No cloud, no login, no data leaves your computer.
2. **KiCad Compatible:** Import existing KiCad symbol and footprint libraries seamlessly.
3. **Modern UI:** Clean, fast, dark-mode-first interface built with modern web tech.
4. **3D Preview:** Real-time 3D board preview with component models and copper traces.
5. **Open Source:** Fully open-source codebase. Community-driven.
6. **Fast Rendering:** React Three Fiber with demand rendering — smooth even on large designs.
7. **Smart Routing:** Intelligent trace routing with smart vias, snap targets, and live DRC.
8. **Component Editor:** Built-in symbol and footprint editors — draw from scratch or generate from IPC standards.
9. **STEP Model Support:** Upload STEP files, view in 3D, integrated into board preview.
10. **Command Pattern Architecture:** Robust undo/redo with revision tracking.

---

## 10. Screenshots / Visual Assets Needed for Website

### Must-have

1. **Hero image:** Schematic editor with components, wires, and labels (dark canvas).
2. **PCB editor:** Trace routing with ratsnest visible, layer panel open.
3. **3D preview:** Board with component models, rotated at an angle.
4. **Component palette:** Search open, component highlighted, preview visible.
5. **Library view:** Component grid with search and tag filters.
6. **Component detail:** Split view showing symbol, footprint, and 3D preview.
7. **Import wizard:** Symbol step with editor canvas visible.
8. **Home screen:** Design list with cards.

### Nice-to-have

9. **Split screen:** Schematic and PCB side by side (if supported in future).
10. **Mobile / responsive:** Not applicable (desktop-only app).
11. **GIFs:** Trace routing animation, smart via placement, component placement flow.

---

## 11. Content Warnings / Honesty

For the website, be transparent about current limitations to set correct expectations:

- **Manufacturing export is not yet implemented.** Users cannot currently generate Gerber/drill files for fabrication. This is the top priority.
- **Single-sheet schematics only.** No multi-page or hierarchical designs yet.
- **Desktop only.** No web version or mobile support.
- **BOM view is a placeholder.** Not functional yet.
- **No simulation.** No SPICE or circuit simulation.
- **Early beta.** Version 0.1.1-dev. Expect bugs and missing polish.

---

## 12. File Paths for Reference

| What              | Where                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Schematic canvas  | `src/modules/designer/frontend/components/SchematicCanvas.tsx`         |
| PCB canvas        | `src/modules/designer/frontend/pcb/PcbCanvas.tsx`                      |
| 3D board preview  | `src/modules/designer/frontend/three-d/Board3DCanvas.tsx`              |
| Component palette | `src/modules/designer/frontend/components/ComponentCommandPalette.tsx` |
| Library space     | `src/modules/library/frontend/Space.tsx`                               |
| Component detail  | `src/modules/library/frontend/ComponentDetailPage.tsx`                 |
| Import wizard     | `src/modules/library/frontend/import-wizard/ImportWizardPage.tsx`      |
| Home screen       | `src/core/frontend/src/screens/HomeScreen.tsx`                         |
| App shell         | `src/core/frontend/src/AppShell.tsx`                                   |
| Designer space    | `src/modules/designer/frontend/Space.tsx`                              |

---

_End of WEBSITE_NOTES.md_
