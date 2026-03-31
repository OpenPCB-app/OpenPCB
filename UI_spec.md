# OpenPCB — User Interface Specification

> **Status:** Ready for Implementation  
> **Version:** 2.0  
> **Last Updated:** March 31, 2026  
> **Companion Document:** PCB_Design_Suite_Specification_v1.0.md  
> **Platform:** Browser-first (Chrome, Firefox, Safari, Edge)

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Global Shell & Navigation](#2-global-shell--navigation)
3. [Design Tokens & Theme System](#3-design-tokens--theme-system)
4. [Typography System](#4-typography-system)
5. [Icon System](#5-icon-system)
6. [View 1: Home Dashboard](#6-view-1-home-dashboard)
7. [View 2: Design Editor](#7-view-2-design-editor)
8. [View 3: Knowledge Base](#8-view-3-knowledge-base)
9. [View 4: Chat](#9-view-4-chat)
10. [View 5: Component Library & Editor](#10-view-5-component-library--editor)
11. [Component Properties Popover](#11-component-properties-popover)
12. [Error & DRC System](#12-error--drc-system)
13. [3D Picture-in-Picture](#13-3d-picture-in-picture)
14. [AI Copilot Panel](#14-ai-copilot-panel)
15. [Split View System](#15-split-view-system)
16. [Cross-Linking & Embeds](#16-cross-linking--embeds)
17. [Keyboard Shortcuts](#17-keyboard-shortcuts)
18. [Onboarding System](#18-onboarding-system)
19. [Responsive Behavior](#19-responsive-behavior)
20. [Accessibility](#20-accessibility)
21. [Component Inventory](#21-component-inventory)
22. [State Management Map](#22-state-management-map)

---

## 1. Design Philosophy

### Core Principles

**"Hardware Figma meets Notion."**

OpenPCB is a hardware development workspace — not just an EDA editor. It combines precision design tools with knowledge management and AI-assisted planning, unified under one navigation model.

**Five UX commandments:**

1. **Canvas is king** — The design canvas always gets maximum screen real estate. Every panel, sidebar, and overlay must be dismissible or collapsible. No permanent chrome that can't be hidden.

2. **Progressive disclosure** — A beginner sees only what they need. Advanced features are discoverable through contextual menus, keyboard shortcuts, and the AI copilot — never cluttering the default view.

3. **Information near the action** — Properties appear in floating popovers near the selected object, not in distant panels. Errors show inline on the canvas. The user's eyes stay where they're working.

4. **One navigation model everywhere** — The icon rail is the single consistent anchor across all views. Users always know where they are and how to get somewhere else.

5. **Zero-friction switching** — Moving between schematic, notes, chat, and library should feel as fast as switching browser tabs. No loading screens, no modal confirmations, no lost state.

### Visual Identity

The interface uses a dark-first design language inspired by professional creative tools (Figma, Linear, Cursor) rather than traditional EDA tools (KiCad, Altium). The aesthetic is: flat surfaces, thin borders, generous spacing, monochrome with purple accents.

---

## 2. Global Shell & Navigation

### 2.1 Shell Layout

The application shell consists of three persistent elements that never change regardless of which view is active:

```
┌────┬──────────────────────────────────────────────┐
│    │                                               │
│ I  │                                               │
│ C  │                                               │
│ O  │          CONTENT AREA                         │
│ N  │          (changes per view)                   │
│    │                                               │
│ R  │                                               │
│ A  │                                               │
│ I  │                                               │
│ L  │                                               │
│    │                                               │
│48px│              remaining width                  │
└────┴──────────────────────────────────────────────┘
```

**There is no global top bar.** Each view owns its own header area within the content region. This maximizes vertical space for the design canvas and keeps the navigation model simple.

### 2.2 Icon Rail Specification

**Dimensions:** 48px wide, full viewport height, fixed position left.

**Background:** `--color-rail-bg` (#141428 dark / #F0F0F5 light).

**Border:** 1px right border, `--color-border-subtle` (#2A2A3E dark / #E5E5EA light).

**Content layout:**

```
┌──────────┐
│  [Logo]  │  ← 48x48, top, 0px padding
│          │
│  [Home]  │  ← 28x28 icon + 7px label below
│  [Design]│     12px gap between items
│  [Notes] │     Active: tinted bg + bold label
│  [Chat]  │     Hover: bg highlight
│  [Library]│
│          │
│  (flex)  │  ← Spacer pushes settings to bottom
│          │
│[Settings]│  ← Always at bottom
│  [User]  │  ← Avatar circle, 24px diameter
└──────────┘
```

**Icon states:**

| State | Background | Icon color | Label color |
|-------|-----------|------------|-------------|
| Default | transparent | `--color-icon-muted` (#555568) | `--color-text-tertiary` (#6B6B80) |
| Hover | `--color-rail-hover` (#1E1E36) | `--color-icon-default` (#888899) | `--color-text-secondary` |
| Active | `--color-rail-active` (rgba(124,58,237,0.15)) | `--color-brand` (#7C3AED) | `--color-text-primary` (#C8C8D4) |
| Focus | same as hover + 2px focus ring | — | — |

**Icon size:** 20x20px SVG icons, centered in 28x28px hit target.

**Label:** 7px font-size, centered below icon, 4px gap from icon. Visible always (not tooltip-only — beginners need labels).

**Logo placement:** The OpenPCB mark sits at the very top of the rail, 12px padding. Clicking it navigates to Home. The mark uses the 24x24px size variant with thicker strokes for legibility.

**Badge indicators:** A notification dot (6px circle, `--color-danger`) can appear on the Chat icon to indicate unread AI responses. No other icons get badges.

### 2.3 Navigation Behavior

| Action | Result |
|--------|--------|
| Click icon | Switch to that view. Previous view state is preserved in memory (scroll position, selection, panel states). |
| Click active icon | No-op (already on that view). |
| Click logo | Navigate to Home dashboard. |
| `Ctrl+1` through `Ctrl+5` | Switch to Home / Design / Notes / Chat / Library respectively. |
| `Ctrl+K` | Open command palette (global, works in any view). |

**View transitions:** Instant crossfade (100ms opacity transition). No slide animations — speed is priority.

**State preservation:** When switching from Design to Notes and back, the canvas zoom, pan position, selection, and all panel states are exactly as the user left them. This is critical for the split-view workflow where users rapidly switch context.

---

## 3. Design Tokens & Theme System

### 3.1 Color Tokens (Dark Theme — Default)

```css
:root[data-theme="dark"] {
  /* Surfaces */
  --color-bg-primary:       #1E1E2E;   /* Main canvas / content bg */
  --color-bg-secondary:     #191930;   /* Sidebars, panels */
  --color-bg-tertiary:      #141428;   /* Rail, deepest surfaces */
  --color-bg-elevated:      #252540;   /* Popovers, dropdowns, modals */
  --color-bg-input:         #2A2A4A;   /* Input fields, search bars */

  /* Text */
  --color-text-primary:     #E0E0E0;   /* Primary text */
  --color-text-secondary:   #888899;   /* Secondary text, labels */
  --color-text-tertiary:    #6B6B80;   /* Placeholder text, hints */
  --color-text-muted:       #555568;   /* Disabled text, timestamps */

  /* Borders */
  --color-border-default:   #2A2A3E;   /* Standard borders */
  --color-border-subtle:    #222236;   /* Subtle separators */
  --color-border-strong:    #3A3A5A;   /* Emphasized borders, input focus */

  /* Brand */
  --color-brand:            #7C3AED;   /* Primary brand purple */
  --color-brand-light:      #A78BFA;   /* Purple for dark backgrounds */
  --color-brand-bg:         rgba(124, 58, 237, 0.15); /* Brand tinted bg */

  /* Canvas-specific */
  --color-canvas-bg:        #1E1E2E;   /* Canvas background */
  --color-canvas-grid:      #2A2A3E;   /* Grid dots/lines */
  --color-canvas-wire:      #00D4AA;   /* Default wire/trace color */
  --color-canvas-ref:       #FFD700;   /* Reference designators */
  --color-canvas-value:     #00D4AA;   /* Component values */
  --color-canvas-selection: #5B8DEF;   /* Selection highlight */
  --color-canvas-error:     #E24B4A;   /* Error markers */
  --color-canvas-warning:   #FFAA00;   /* Warning markers */
  --color-copper-front:     #FF4444;   /* Front copper layer */
  --color-copper-back:      #4444FF;   /* Back copper layer */

  /* Semantic */
  --color-success:          #44CC88;
  --color-warning:          #FFAA00;
  --color-danger:           #E24B4A;
  --color-info:             #5B8DEF;
}
```

### 3.2 Color Tokens (Light Theme)

```css
:root[data-theme="light"] {
  --color-bg-primary:       #FFFFFF;
  --color-bg-secondary:     #F8F8FC;
  --color-bg-tertiary:      #F0F0F5;
  --color-bg-elevated:      #FFFFFF;
  --color-bg-input:         #F0F0F5;

  --color-text-primary:     #1A1A2E;
  --color-text-secondary:   #555568;
  --color-text-tertiary:    #888899;
  --color-text-muted:       #AAAABC;

  --color-border-default:   #E5E5EA;
  --color-border-subtle:    #F0F0F5;
  --color-border-strong:    #D0D0DA;

  --color-brand:            #7C3AED;
  --color-brand-light:      #7C3AED;  /* Same in light mode */
  --color-brand-bg:         rgba(124, 58, 237, 0.08);

  --color-canvas-bg:        #FAFAFE;
  --color-canvas-grid:      #E8E8F0;
  /* All other canvas colors remain the same */
}
```

### 3.3 Spacing Scale

```css
:root {
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
}
```

### 3.4 Radius Scale

```css
:root {
  --radius-sm:  4px;   /* Buttons, inputs, small elements */
  --radius-md:  6px;   /* Cards, panels */
  --radius-lg:  8px;   /* Modals, popovers */
  --radius-xl:  12px;  /* Large cards, rail icons */
  --radius-pill: 9999px; /* Pills, tags */
}
```

### 3.5 Elevation (Shadows)

Dark theme uses border-based elevation, not shadows (shadows are invisible on dark backgrounds).

```css
:root[data-theme="dark"] {
  --elevation-1: 0 0 0 1px var(--color-border-default);       /* Panels */
  --elevation-2: 0 0 0 1px var(--color-border-strong);         /* Popovers */
  --elevation-3: 0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px var(--color-border-strong); /* Modals */
}

:root[data-theme="light"] {
  --elevation-1: 0 1px 3px rgba(0,0,0,0.06);
  --elevation-2: 0 4px 12px rgba(0,0,0,0.08);
  --elevation-3: 0 8px 24px rgba(0,0,0,0.12);
}
```

### 3.6 Transitions

```css
:root {
  --transition-fast:   100ms ease;   /* Hover states, toggles */
  --transition-normal: 200ms ease;   /* Panel open/close */
  --transition-slow:   300ms ease;   /* View transitions, modals */
}
```

---

## 4. Typography System

### 4.1 Font Stack

```css
:root {
  --font-sans:  'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
}
```

Inter is used everywhere in the UI. JetBrains Mono is used for component values, reference designators, code blocks, and technical data.

### 4.2 Type Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `--text-xs` | 11px | 400 | 16px | Timestamps, micro-labels, icon rail labels |
| `--text-sm` | 12px | 400 | 18px | Secondary labels, sidebar items, status bar |
| `--text-md` | 13px | 400 | 20px | Body text, form labels, table cells |
| `--text-lg` | 14px | 500 | 20px | Section headers, nav items, button labels |
| `--text-xl` | 16px | 500 | 24px | View titles, modal headers |
| `--text-2xl` | 20px | 500 | 28px | Page titles (Knowledge Base) |
| `--text-3xl` | 24px | 500 | 32px | Dashboard greeting, empty states |
| `--text-mono-sm` | 11px | 400 | 16px | Component values on canvas |
| `--text-mono-md` | 13px | 400 | 20px | Code blocks, property values |

### 4.3 Rules

- **Never bold body text mid-sentence.** Bold is for headings and labels only.
- **Sentence case everywhere.** No ALLCAPS except spacing-lettered section headers in sidebars (e.g., "COMPONENTS").
- **Letter spacing:** -0.3px on sizes 16px+. +0.5px on spaced sidebar headers. Default 0 elsewhere.
- **Truncation:** Use `text-overflow: ellipsis` with a minimum visible width of 60px. Never truncate in the main canvas — only in panels and sidebars.

---

## 5. Icon System

### 5.1 Specifications

- **Size:** 20x20px default, 16x16px in compact contexts, 24x24px for emphasis.
- **Style:** 1.5px stroke weight, round line caps and joins, no fills.
- **Color:** Inherits from parent `color` property via `currentColor`.
- **Format:** Inline SVG (not icon font). Tree-shakeable from a single icon module.

### 5.2 Icon Rail Icons

| Position | Icon | Description |
|----------|------|-------------|
| Top | OpenPCB mark | Logo, navigates to Home |
| 1 | Grid/dashboard icon | Home dashboard |
| 2 | Pen-ruler/artboard icon | Design editor |
| 3 | Document/page icon | Knowledge base |
| 4 | Chat bubble icon | Chat |
| 5 | Chip/cube icon | Component library |
| Bottom-1 | Gear icon | Settings |
| Bottom-2 | User avatar circle | Account / profile |

### 5.3 Toolbar Icons (Design View)

**Schematic mode toolbar:**

| Icon | Label | Shortcut | Action |
|------|-------|----------|--------|
| Cursor | Select | `V` | Default selection tool |
| Plus-in-box | Add | `A` | Open component search to place |
| Diagonal line | Wire | `W` | Enter wiring mode |
| "Aa" text | Label | `L` | Place net label |
| Power symbol | Power | `P` | Place power symbol (VCC, GND) |
| Divider | — | — | Visual separator |
| Checkmark-shield | ERC | — | Run electrical rules check |
| Arrow-to-board | Update PCB | — | Push schematic changes to PCB |

**PCB mode toolbar:**

| Icon | Label | Shortcut | Action |
|------|-------|----------|--------|
| Cursor | Select | `V` | Default selection tool |
| Path line | Route | `X` | Enter interactive routing mode |
| Circle-dot | Via | `V` (during routing) | Insert via while routing |
| Polygon | Zone | — | Draw copper zone boundary |
| Ruler | Measure | `M` | Distance measurement tool |
| Divider | — | — | Visual separator |
| Checkmark-shield | DRC | — | Run design rules check |
| Download-box | Export | — | Open manufacturing export dialog |

---

## 6. View 1: Home Dashboard

### 6.1 Purpose

The hub of the application. Users land here on login and return here between tasks. It provides quick access to recent work, project creation, and navigation to all other views.

### 6.2 Layout

```
┌────┬────────────────────────────────────────────────┐
│RAIL│  ┌─ View Header ─────────────────────────────┐ │
│    │  │ "Home"                 [Search] [New ▼]    │ │
│    │  └────────────────────────────────────────────┘ │
│    │                                                  │
│    │  ┌─ Recent Projects ──────────────────────────┐ │
│    │  │ [Card] [Card] [Card] [+ New project]       │ │
│    │  └────────────────────────────────────────────┘ │
│    │                                                  │
│    │  ┌─ Quick Actions ────────────────────────────┐ │
│    │  │ [New from template] [Import] [New comp.]   │ │
│    │  └────────────────────────────────────────────┘ │
│    │                                                  │
│    │  ┌─ Recent Notes ──────┐ ┌─ Recent Chats ────┐ │
│    │  │ Note list with      │ │ Chat list with     │ │
│    │  │ project tags        │ │ preview text       │ │
│    │  └─────────────────────┘ └────────────────────┘ │
└────┴────────────────────────────────────────────────┘
```

### 6.3 Project Card Specification

**Dimensions:** min-width 200px, max-width 280px, height 120px.  
**Layout:** Thumbnail area (full width, 56px tall, `--color-bg-input`) + metadata below.

```
┌────────────────────────┐
│  ┌──────────────────┐  │
│  │   PCB thumbnail   │  │  ← Auto-generated preview, 56px
│  └──────────────────┘  │
│  Project Name           │  ← --text-md, weight 500
│  Modified 2h ago        │  ← --text-sm, --color-text-tertiary
│  Sch 80% │ PCB 40%     │  ← --text-xs, progress indicators
└────────────────────────┘
```

**States:**

| State | Effect |
|-------|--------|
| Default | `--color-bg-input` background, `--color-border-default` border |
| Hover | Border color → `--color-border-strong`, slight scale (1.01) |
| Click | Opens project in Design view |
| Right-click | Context menu: Rename, Duplicate, Export, Delete |

**"+ New project" card:** Dashed border (`--color-border-default`), centered "+" icon (20px) and label. Clicking opens the new project dialog.

### 6.4 Quick Action Buttons

Rounded rect buttons (height 36px, `--radius-md`, `--color-bg-input` background, `--color-brand-light` text). On hover: background shifts to `--color-brand-bg`.

### 6.5 Recent Notes & Chats Lists

Simple lists with 32px row height. Each row shows: title (truncated), project tag pill (if project-linked) or "Global" tag, and relative timestamp. Clicking opens the item in the Notes or Chat view.

---

## 7. View 2: Design Editor

### 7.1 Purpose

The primary design environment. Contains the schematic editor, PCB layout editor, 3D viewer, and BOM manager — accessible via inner tabs.

### 7.2 Layout

```
┌────┬─────────────────────────────────────────────────┐
│RAIL│ ┌─ Editor Header ─────────────────────────────┐ │
│    │ │ Project name │ [Sch│PCB│3D│BOM] │ [Share][AI]│ │
│    │ └─────────────────────────────────────────────┘ │
│    │ ┌─ Toolbar ──────────────────────────────────┐  │
│    │ │ [Select][Add][Wire][Label][Power] │ [ERC]  │  │
│    │ └────────────────────────────────────────────┘  │
│    │ ┌──────┬─────────────────────────┬──────────┐  │
│    │ │Left  │                         │Right     │  │
│    │ │Panel │      CANVAS             │Panel     │  │
│    │ │      │                         │(AI)      │  │
│    │ │180px │                         │92-280px  │  │
│    │ └──────┴─────────────────────────┴──────────┘  │
│    │ ┌─ Status Bar ──────────────────────────────┐  │
│    │ │ ERC: 0 errors │ Zoom │ Grid │ Saved 2s   │  │
│    │ └───────────────────────────────────────────┘  │
└────┴─────────────────────────────────────────────────┘
```

### 7.3 Editor Header (40px)

**Left section:**
- Project name (editable inline on double-click, `--text-lg`)
- Unsaved indicator (small dot, `--color-warning`, appears when unsaved changes exist)

**Center section:**
- Inner tab bar for Schematic / PCB / 3D / BOM
- Tab bar container: `--color-bg-input` background, `--radius-sm`, height 28px
- Active tab: `--color-bg-elevated` background, `--color-text-primary` text, `--radius-sm`
- Inactive tab: transparent background, `--color-text-tertiary` text
- Tab width: auto (fit content), min 48px, padding 0 12px

**Right section:**
- Share button (text button, `--color-text-tertiary`)
- AI toggle button (28x28, `--color-brand-bg` background when active, brand-colored "AI" text)
- User avatar (24px circle)

### 7.4 Toolbar (36px)

**Background:** `--color-bg-secondary`.  
**Border:** 1px bottom, `--color-border-default`.  
**Padding:** 8px horizontal.  
**Tool buttons:** 28x28px, `--radius-sm`.

**Tool button states:**

| State | Background | Icon color |
|-------|-----------|------------|
| Default | transparent | `--color-text-tertiary` |
| Hover | `--color-bg-input` | `--color-text-secondary` |
| Active (selected tool) | `--color-bg-input` | `--color-text-primary` |
| Disabled | transparent | `--color-text-muted` |

**Tool labels:** Appear as tooltips on hover (not visible by default). Tooltip shows: tool name + keyboard shortcut. Tooltip style: `--color-bg-elevated`, `--text-sm`, `--radius-sm`, 4px 8px padding, positioned 4px below the button.

**Separator:** 1px vertical line, `--color-border-subtle`, 8px horizontal margin, 20px height.

**Contextual toolbar change:** When switching between Schematic and PCB tabs, the toolbar smoothly crossfades (100ms) to show the appropriate tool set.

### 7.5 Left Sidebar Panel (180px, collapsible)

**Background:** `--color-bg-secondary`.  
**Border:** 1px right, `--color-border-default`.  
**Collapse behavior:** Double-click the right border to collapse to 0px. A small expand tab (12x48px) remains visible at the edge. Shortcut: `Ctrl+B`.

**Three collapsible sections:**

#### Section 1: Components

```
┌─────────────────────────┐
│ COMPONENTS          [▾] │  ← Section header, collapsible
│ ┌─────────────────────┐ │
│ │ 🔍 Search parts...  │ │  ← Search input, always visible
│ └─────────────────────┘ │
│                         │
│ ▸ Resistors             │  ← Expandable category
│ ▸ Capacitors            │
│ ▾ ICs                   │  ← Expanded
│   · ATmega328P          │  ← Draggable component
│   · ESP32-S3            │
│   · RP2040              │
│ ▸ Connectors            │
│ ▸ LEDs                  │
│ ▸ Power                 │
└─────────────────────────┘
```

**Search input:** Height 28px, `--radius-md`, `--color-bg-input`, placeholder "Search parts...", auto-focus on `A` keypress. Results replace the category tree below.

**Category items:** Height 28px, 12px left padding, `--text-sm`. Expand chevron (8px) on the left.

**Component items:** Height 24px, 24px left padding (indented under category), `--text-sm`, `--color-text-tertiary`. Draggable — user drags directly onto the canvas to place. On hover: background `--color-bg-input`.

#### Section 2: Layers

```
┌─────────────────────────┐
│ LAYERS              [▾] │
│ [■] F.Cu          [👁]  │  ← Color swatch + name + visibility
│ [■] B.Cu          [👁]  │
│ [■] F.SilkS       [👁]  │
│ [■] F.Mask        [👁]  │
│ [■] Edge.Cuts     [👁]  │
└─────────────────────────┘
```

**Layer row:** Height 24px. Color swatch (8x8px, rounded 2px) + layer name (`--text-sm`) + visibility toggle eye icon (right-aligned).

**Visibility toggle:** Click the eye icon to show/hide layer on canvas. Dimmed layer name when hidden.

**Active layer indicator:** Left 2px border accent in the layer's color on the currently selected routing layer.

#### Section 3: Design Tree

```
┌─────────────────────────┐
│ DESIGN TREE         [▾] │
│ ▾ Sheet 1 (main)        │
│   · U1: ESP32-S3        │  ← Click to select on canvas
│   · R1-R4: 10kΩ         │
│   · C1-C3: 100nF        │
│   · J1: USB-C           │
└─────────────────────────┘
```

**Tree items:** Clicking any component in the tree selects and centers it on the canvas. Double-clicking opens the properties popover.

### 7.6 Canvas Area

**Background:** `--color-canvas-bg`.  
**Grid:** Dotted grid pattern, `--color-canvas-grid`, configurable spacing (default 50mil / 1.27mm).  
**Rendering:** WebGL2 (fallback WebGL1). Hardware-accelerated 2D rendering for all schematic and PCB primitives.

**Canvas interaction:**

| Input | Action |
|-------|--------|
| Left click | Select object under cursor |
| Left drag (empty area) | Selection rectangle |
| Left drag (selected object) | Move object |
| Middle click drag / Space+drag | Pan canvas |
| Scroll wheel | Zoom (centered on cursor position) |
| Ctrl+scroll | Zoom (slower, fine control) |
| Right click | Context menu |
| Double click (component) | Open properties popover |
| Double click (empty area) | Open component search popup at cursor |
| Escape | Deselect all / cancel current tool |

**Zoom range:** 5% to 5000%.  
**Zoom indicator:** Bottom status bar shows current zoom percentage. Click to enter exact value.

**Selection rendering:**

| Selection state | Visual |
|----------------|--------|
| Hover (not selected) | 1px dashed outline, `--color-canvas-selection` at 30% opacity |
| Selected | 2px solid outline, `--color-canvas-selection` at 80% opacity, corner handles |
| Multi-selected | Same as selected, plus bounding box around group |

### 7.7 Status Bar (32px)

**Background:** `--color-bg-tertiary`.  
**Border:** 1px top, `--color-border-default`.  
**Layout:** Flex row, space-between.

**Left section:**
- ERC/DRC status: colored dot (8px, green/yellow/red) + "ERC: 0 errors, 2 warnings" text
- Click to expand error drawer (see Section 12)

**Center section:**
- Current zoom: "Zoom: 100%" (clickable — opens input for exact value)
- Grid size: "Grid: 50mil" (clickable — opens grid settings dropdown)

**Right section:**
- Save status: "Saved 2s ago" or "Saving..." or "Unsaved changes"
- Version snapshot button: small clock icon, opens version history panel

---

## 8. View 3: Knowledge Base

### 8.1 Purpose

Notion-like pages for project documentation, research notes, design decisions, and reference material. Supports rich content with special embeds for schematic snippets and BOM tables.

### 8.2 Layout

```
┌────┬──────────┬──────────────────────────────────────┐
│RAIL│ Page Tree │           Editor Area                │
│    │           │                                      │
│    │  PAGES    │  Page Title                          │
│    │  [+]      │  Project / Last edited 2h ago        │
│    │           │                                      │
│    │  Project A│  ## Heading                          │
│    │   · Note 1│                                      │
│    │   · Note 2│  Body text with rich formatting...   │
│    │           │                                      │
│    │  Project B│  [Embedded schematic snippet]        │
│    │   · Note  │                                      │
│    │  ──────── │  [Embedded BOM table]                │
│    │  Global   │                                      │
│    │   · Note  │  More body text...                   │
│    │           │                                      │
│    │  160px    │         remaining width               │
└────┴──────────┴──────────────────────────────────────┘
```

### 8.3 Page Tree Sidebar (160px)

**Background:** `--color-bg-secondary`.  
**Border:** 1px right, `--color-border-default`.

**Header:** "PAGES" label + "+" button (creates new page).

**Tree structure:**
- **Project groups:** Bold text (`--text-sm`, weight 500). Clicking expands/collapses the group.
- **Page items:** Regular text (`--text-sm`, weight 400), 16px left indent under project. Click opens page in editor.
- **Separator:** 1px horizontal line between project groups and "Global notes" section.
- **Global notes:** A special section at the bottom for notes not tied to any project.

**Active page:** Left 2px accent border (`--color-brand`), `--color-text-primary` text.

**Context menu (right-click page):** Rename, Move to project, Duplicate, Delete, Open in split view.

### 8.4 Editor Area

**Max width:** 720px, centered horizontally. This creates a comfortable reading/writing column with whitespace on both sides (like Notion).

**Page header:**
- Title: `--text-2xl`, editable inline, placeholder "Untitled"
- Metadata line: "Project name / Last edited [relative time]", `--text-sm`, `--color-text-tertiary`

**Editor features (rich but focused):**

| Block type | Trigger | Rendering |
|------------|---------|-----------|
| Heading 1 | `# ` | `--text-xl`, weight 500, 24px top margin |
| Heading 2 | `## ` | `--text-lg`, weight 500, 20px top margin |
| Heading 3 | `### ` | `--text-md`, weight 500, 16px top margin |
| Body text | Default | `--text-md`, weight 400, `--color-text-primary` |
| Bullet list | `- ` or `* ` | 16px left indent, 6px disc marker |
| Numbered list | `1. ` | 16px left indent, auto-numbered |
| Code block | ` ``` ` | `--font-mono`, `--color-bg-input` background, `--radius-md`, 12px padding |
| Inline code | `` ` `` | `--font-mono`, `--color-bg-input` background, `--radius-sm`, 2px 4px padding |
| Image | Drag/drop or paste | Max-width 100%, `--radius-md`, click to zoom |
| Divider | `---` | 1px line, `--color-border-default`, 16px vertical margin |
| Schematic embed | `/schematic` | Live preview block (see Section 16) |
| BOM embed | `/bom` | Auto-updating table (see Section 16) |
| Component link | `@ComponentRef` | Clickable link that navigates to component on canvas |

**Slash commands:** Typing `/` opens a dropdown of available block types. Filtered as user types. Select with arrow keys + Enter.

**Toolbar (floating, appears on text selection):** Bold, italic, strikethrough, code, link. Compact floating bar positioned above the selection, 32px height, `--color-bg-elevated`, `--elevation-2`.

---

## 9. View 4: Chat

### 9.1 Purpose

Full-page AI conversations for brainstorming, component research, design planning, and technical questions. Separate from the slim in-editor copilot — this is for longer, deeper conversations.

### 9.2 Layout

```
┌────┬──────────┬──────────────────────────────────────┐
│RAIL│ Chat List │           Chat Area                  │
│    │           │                                      │
│    │ [+ New]   │  ┌──────────────────────────────┐   │
│    │           │  │ AI message bubble             │   │
│    │ Project A │  │ with formatted response       │   │
│    │  · Chat 1 │  └──────────────────────────────┘   │
│    │  · Chat 2 │                                      │
│    │           │  ┌──────────────────────────────┐   │
│    │ Global    │  │ User message                  │   │
│    │  · Chat 3 │  └──────────────────────────────┘   │
│    │           │                                      │
│    │           │  ┌──────────────────────────────┐   │
│    │           │  │ AI response with actionable   │   │
│    │           │  │ buttons: [Place] [Explain]    │   │
│    │           │  └──────────────────────────────┘   │
│    │           │                                      │
│    │           │  ┌──────────────────────────────┐   │
│    │           │  │ 💬 Ask anything...        [↑] │   │
│    │           │  └──────────────────────────────┘   │
│    │  160px    │         remaining width               │
└────┴──────────┴──────────────────────────────────────┘
```

### 9.3 Chat List Sidebar (160px)

Same background and border treatment as the Notes page tree.

**Header:** "+ New chat" button (full width, `--radius-md`).

**Organization:** Grouped by project (with a "Global" section for project-independent chats). Each chat shows: title (auto-generated from first message, editable) + relative timestamp.

**Active chat:** Same left accent border as Notes.

### 9.4 Chat Area

**Max width:** 680px, centered horizontally.

**Message bubbles:**

| Type | Background | Alignment | Text color |
|------|-----------|-----------|------------|
| User | `--color-bg-input` | Right-aligned | `--color-text-primary` |
| AI | `--color-bg-elevated` | Left-aligned, full width | `--color-text-primary` |

**AI message features:**
- Markdown rendering (headings, lists, code blocks, tables)
- Action buttons: Compact buttons (24px height, `--radius-sm`) for actionable suggestions like "Place on schematic", "Show alternatives", "Explain more"
- Component cards: When AI suggests a component, render as an inline card showing: name, MPN, price, stock, footprint preview
- Streaming: Messages stream in token-by-token with a blinking cursor indicator

**Input area:** Fixed at bottom of chat area. Textarea (auto-expanding, min 40px, max 200px height), `--color-bg-input`, `--radius-lg`, 12px padding. Send button (arrow-up icon, `--color-brand` background, 28px circle) on the right.

**Context awareness:** When a chat is project-linked, the AI has access to the project's schematic, component list, and design rules. A small label above the input shows: "Chatting about: Sensor board v2".

---

## 10. View 5: Component Library & Editor

### 10.1 Library Browser Layout

```
┌────┬──────────────────────────────────────────────────┐
│RAIL│  ┌─ Header ──────────────────────────────────┐  │
│    │  │ Component Library     [Search]  [+ New]   │  │
│    │  └───────────────────────────────────────────┘  │
│    │  ┌─ Filters ─────────────────────────────────┐  │
│    │  │ [All] [My parts] [Built-in] [Community]   │  │
│    │  │ Category: [All ▼]  Package: [All ▼]       │  │
│    │  └───────────────────────────────────────────┘  │
│    │  ┌─ Results Grid ────────────────────────────┐  │
│    │  │ ┌────────┐ ┌────────┐ ┌────────┐         │  │
│    │  │ │CompCard│ │CompCard│ │CompCard│ ...      │  │
│    │  │ └────────┘ └────────┘ └────────┘         │  │
│    │  │ ┌────────┐ ┌────────┐ ┌────────┐         │  │
│    │  │ │CompCard│ │CompCard│ │CompCard│ ...      │  │
│    │  │ └────────┘ └────────┘ └────────┘         │  │
│    │  └───────────────────────────────────────────┘  │
└────┴──────────────────────────────────────────────────┘
```

**Search bar:** Full-width, 36px height, `--radius-md`, `--color-bg-input`. Supports natural language ("10k resistor 0402"), MPN search ("RC0402FR"), and parametric queries ("capacitor 100uF 25V").

**Filter pills:** Horizontal row of toggleable pills. Active: `--color-brand-bg` background, `--color-brand` text. Inactive: `--color-bg-input` background, `--color-text-tertiary` text.

**Component card:** 180px wide, auto height (approximately 160px).

```
┌──────────────────────┐
│ ┌──────────────────┐ │
│ │ Symbol preview    │ │  ← 80px tall, centered schematic symbol
│ └──────────────────┘ │
│ 10kΩ Resistor        │  ← Name, --text-md, weight 500
│ RC0402FR-0710KL      │  ← MPN, --text-mono-sm, --color-text-tertiary
│ Yageo · 0402         │  ← Manufacturer + package
│ $0.002 · 45K in stock│  ← Price + stock, --text-sm
│ ★★★★★ verified       │  ← Quality rating
└──────────────────────┘
```

**Card actions (hover):** "Add to project" button appears overlaying the bottom of the card. "Edit" and "View details" appear as icon buttons in the top-right corner.

### 10.2 Component Editor Wizard

Triggered by clicking "+ New component" or "Edit" on an existing component. Opens as a full content area (replaces the library browser).

**Wizard progress bar:**

```
[1. Symbol ✓] ─── [2. Footprint ●] ─── [3. 3D model ○] ─── [4. Specs ○]
   completed        current              upcoming             upcoming
```

**Progress segments:** Equal-width horizontal bars. Completed: `--color-success`. Current: `--color-brand`. Upcoming: `--color-bg-input`. Step labels above each segment. Clicking a completed step navigates back to it.

#### Step 1: Symbol Editor

```
┌────────────────────────────┬──────────────────────────┐
│     Symbol Canvas          │  Properties Panel        │
│                            │                          │
│  Grid-based drawing area   │  Component name: [    ]  │
│  for placing pins and      │  Reference prefix: [  ]  │
│  drawing the symbol body   │  Pin count: [    ]       │
│                            │                          │
│  Tools: Pin, Line, Rect,   │  Pin Table:              │
│  Arc, Text                 │  [#] [Name] [Type] [Side]│
│                            │  [1] [VCC]  [Pwr]  [Top] │
│  280px min                 │  [2] [GND]  [Pwr]  [Bot] │
│                            │  [3] [IN]   [Input][Left] │
│                            │  240px                    │
└────────────────────────────┴──────────────────────────┘
```

**Canvas:** Small grid-based editor (same rendering as main schematic canvas but scoped to one symbol). Toolbar at top: Pin tool, Line, Rectangle, Arc, Text.

**Pin table:** Editable table listing all pins. Columns: Number, Name, Electrical Type (Input/Output/Bidirectional/Power/Passive), Side (Top/Bottom/Left/Right). Add/remove rows with +/- buttons.

**Templates:** "Start from template" dropdown offering common shapes: DIP, QFP, connector, discrete 2-pin, op-amp, etc.

#### Step 2: Footprint Editor

```
┌────────────────────────────┬──────────────────────────┐
│     Footprint Canvas       │  Pad Configuration       │
│                            │                          │
│  Grid-based drawing area   │  Pad shape: [Rect ▼]    │
│  for placing pads and      │  Width:     [1.2mm   ]  │
│  drawing courtyard/silk    │  Height:    [0.6mm   ]  │
│                            │  Pitch:     [2.54mm  ]  │
│  Tools: SMD Pad, TH Pad,  │  Rows:      [2       ]  │
│  Line, Arc, Courtyard      │  Columns:   [4       ]  │
│                            │                          │
│  Real-time pad array       │  Courtyard margin:       │
│  preview as params change  │  [0.25mm   ]             │
│                            │  240px                    │
└────────────────────────────┴──────────────────────────┘
```

**Parametric pad placement:** Entering pitch, rows, and columns auto-generates a pad array on the canvas. User can manually adjust individual pads afterward.

**Live validation:** Show warnings if pads overlap, courtyard is missing, or pad sizes are below manufacturing minimums.

#### Step 3: 3D Model

```
┌────────────────────────────┬──────────────────────────┐
│     3D Preview             │  Model Source             │
│                            │                          │
│  Three.js viewport showing │  ○ Upload STEP file      │
│  the 3D model on the       │  ○ Generate from params  │
│  footprint                 │  ○ No 3D model (skip)    │
│                            │                          │
│  Orbit/zoom controls       │  Offset X: [0mm ]        │
│                            │  Offset Y: [0mm ]        │
│                            │  Rotation: [0°  ]        │
│                            │  Scale:    [1.0 ]        │
│                            │  240px                    │
└────────────────────────────┴──────────────────────────┘
```

**"Generate from params":** For simple components (resistors, capacitors, SOICs), auto-generate a box/cylinder 3D model from the footprint dimensions. Not available for complex ICs.

**STEP upload:** Drag-and-drop zone. Accepted formats: .step, .stp. Max file size: 10MB.

#### Step 4: Specs & Metadata

```
┌──────────────────────────────────────────────────────┐
│  Component Information                               │
│                                                      │
│  Name:            [10kΩ Chip Resistor            ]   │
│  Description:     [Thick film, ±1%, 1/16W        ]   │
│  Category:        [Resistors > Chip Resistor  ▼  ]   │
│  MPN:             [RC0402FR-0710KL               ]   │
│  Manufacturer:    [Yageo                         ]   │
│  Datasheet URL:   [https://...                   ]   │
│                                                      │
│  Parameters:                                         │
│  ┌──────────────┬────────────────┐                   │
│  │ Resistance   │ [10kΩ       ]  │  [+ Add param]   │
│  │ Tolerance    │ [1%         ]  │                   │
│  │ Power rating │ [0.0625W    ]  │                   │
│  │ Voltage      │ [50V        ]  │                   │
│  └──────────────┴────────────────┘                   │
│                                                      │
│  Tags: [resistor] [smd] [0402] [+ Add]               │
│                                                      │
│             [Back]                [Save Component]   │
└──────────────────────────────────────────────────────┘
```

**Max-width:** 560px, centered. Standard form layout with labels above inputs.

**Parameter table:** Dynamic rows. Each row: parameter name (editable text input) + value (editable text input). "+ Add parameter" button below.

**Tags:** Pill-shaped tags with "x" to remove. "+ Add" opens a text input inline.

**Save button:** `--color-brand` background, white text, full width at bottom. On save: validates all 4 steps, shows any warnings, saves to user library.

---

## 11. Component Properties Popover

### 11.1 Trigger

- Double-click any component on the schematic or PCB canvas.
- Or: single-click to select, then press `Enter`.

### 11.2 Positioning

Appears adjacent to the selected component, offset 8px from the component's bounding box. Prefers right side; falls back to left, top, or bottom if right side would overflow the viewport. Arrow/caret points toward the component.

### 11.3 Dimensions

Width: 240px. Height: auto (content-driven), max 360px with scroll.

### 11.4 Content Layout

```
┌──────────────────────────────────┐
│ U1 — ESP32-S3-WROOM-1           │  ← Title: ref + part name
│ ─────────────────────────────── │
│ Reference:  [U1           ]     │  ← Editable inline
│ Value:      [ESP32-S3  ▼  ]     │  ← Dropdown for common values
│ Footprint:  [QFN-56   ▼  ]     │  ← Visual footprint picker
│ ─────────────────────────────── │
│ ● In stock: 12,400  · $2.85    │  ← Live supply chain
│ ─────────────────────────────── │
│ [Datasheet] [Alternatives] [AI] │  ← Action buttons
└──────────────────────────────────┘
```

### 11.5 Styling

- Background: `--color-bg-elevated`
- Border: `--elevation-2`
- Radius: `--radius-lg`
- Padding: 12px
- Title: `--text-md`, weight 500
- Labels: `--text-sm`, `--color-text-secondary`
- Input fields: `--text-mono-md`, `--color-bg-input`, `--radius-sm`
- Stock indicator: green dot (8px, `--color-success`) if >100 units, yellow if >0, red if 0
- Action buttons: compact, 24px height, `--radius-sm`, `--color-bg-input` background

### 11.6 Dismiss Behavior

- Click outside the popover → close
- Press `Escape` → close
- Click another component → close current, open new popover on the new component
- Scroll canvas → popover follows the component (stays anchored)

---

## 12. Error & DRC System

### 12.1 Inline Canvas Markers

**Error marker:** Small circle (12px diameter) with exclamation mark. Positioned at the violation location on the canvas. Red (`--color-danger`) for errors, amber (`--color-warning`) for warnings.

**Hover behavior:** Hovering a marker shows a compact tooltip (max 200px wide) with the error description and a "Click to fix" action.

**Glow effect:** A subtle radial glow (16px radius, 10% opacity) around the marker ensures it's visible even on busy schematics.

### 12.2 Error Drawer

**Trigger:** Click the ERC/DRC status in the status bar, or press `Ctrl+Shift+E`.

**Position:** Slides up from the bottom of the canvas area, above the status bar.

**Height:** 200px default, resizable by dragging the top edge. Min 100px, max 50% of canvas height.

**Background:** `--color-bg-secondary`.  
**Border:** 1px top, `--color-border-default`.

**Header:** "Issues" title + badge counts (red pill for errors, amber pill for warnings) + collapse button.

**Error list:**

```
┌──────────────────────────────────────────────────────┐
│ Issues  [1] [1]                          [Collapse]  │
│ ─────────────────────────────────────────────────── │
│ ● ERC: Pin 2 of R1 is unconnected          Sheet 1  │
│ ▲ ERC: C3 missing power flag on net VCC     Sheet 1  │
└──────────────────────────────────────────────────────┘
```

**Error row:** 32px height. Click → canvas zooms to and centers the violation, selects the relevant component. Red circle for errors, amber triangle for warnings.

**Sortable by:** Severity (default), location, type.

---

## 13. 3D Picture-in-Picture

### 13.1 Visibility

Appears only in PCB view (not Schematic, BOM, or other views).

### 13.2 Dimensions & Position

**Default:** 140x90px, bottom-right corner of the canvas area, 12px padding from edges.  
**Resizable:** Drag corner to resize. Min 100x65px, max 320x200px.  
**Draggable:** User can drag to any corner of the canvas.

### 13.3 Content

Real-time Three.js render of the PCB board with placed components. Matches the current state of the PCB layout. Updates automatically when components are moved or traces are routed.

### 13.4 Controls

**Header bar (16px):** "3D preview" label + "Max" button (expands to full-screen 3D tab).

**Interaction within PiP:** Orbit rotation only (click+drag inside the PiP). No zoom within PiP.

### 13.5 Styling

Background: `--color-bg-secondary`.  
Border: `--elevation-1`.  
Radius: `--radius-md`.  
Opacity: 95% (slightly transparent so canvas beneath is barely visible).

---

## 14. AI Copilot Panel (In-Editor)

### 14.1 Purpose

A slim chat panel inside the Design Editor view for quick, context-aware assistance. Different from the full-page Chat view — this is for rapid, task-specific queries while designing.

### 14.2 Toggle

Click the "AI" button in the editor header, or press `Ctrl+/`.

### 14.3 Dimensions

**Collapsed:** 0px (hidden, button only in header).  
**Slim (default when opened):** 92px — shows last AI message preview + input field.  
**Expanded:** 280px — shows full conversation history.  
**Expand trigger:** Click on the slim panel, or start typing a long message.

### 14.4 Layout (Expanded)

```
┌────────────────────────────────┐
│ AI Copilot             [Close] │
│ ─────────────────────────────  │
│                                │
│ User: Add USB-C power input    │
│                                │
│ AI: I'd suggest the            │
│ AMS1117-3.3 LDO regulator.    │
│ It takes 5V USB input and      │
│ outputs stable 3.3V at 1A.    │
│                                │
│ [Place on Schematic]           │
│ [Show Alternatives]            │
│ [Explain Circuit]              │
│                                │
│ ─────────────────────────────  │
│ 💬 [Ask the copilot...     ]  │
└────────────────────────────────┘
```

### 14.5 Context Awareness

The copilot automatically sees:
- Current view (Schematic vs PCB)
- Selected component (if any)
- Recent DRC/ERC violations
- Current project's component list and netlist

When the user selects a component and asks a question, the copilot knows which component is selected without the user needing to specify.

---

## 15. Split View System

### 15.1 Purpose

Allows users to view notes or chats alongside the design canvas. Optional, power-user feature.

### 15.2 Activation

- From the Design view: press `Ctrl+\` or click the "Open in split" icon on any note/chat.
- From the Notes/Chat views: "Open alongside design" button in page/chat header.
- Drag a note or chat from the rail flyout into the right side of the editor.

### 15.3 Layout

```
┌────┬──────┬───────────────────┬──────────────────┐
│RAIL│Left  │   Design Canvas   │  Split Panel     │
│    │Panel │                   │  (Notes or Chat) │
│    │      │                   │                  │
│    │180px │   flexible        │  min 240px       │
│    │      │                   │  max 400px       │
│    │      │                   │  default 300px   │
└────┴──────┴───────────────────┴──────────────────┘
```

### 15.4 Resize Behavior

A 4px drag handle between the canvas and split panel. Cursor changes to `col-resize` on hover. Dragging adjusts the split position. Double-clicking the handle resets to default (300px).

### 15.5 Split Panel Header

12px height mini-header showing: page/chat title + close button ("×"). Clicking close returns to full-canvas mode.

### 15.6 Content

The split panel renders the full Notes editor or Chat interface (minus their own sidebars — only the content area). This keeps the panel compact while fully functional.

---

## 16. Cross-Linking & Embeds

### 16.1 Schematic Snippet Embed

**In Notes:** Type `/schematic` to insert. A dialog lets the user select which project and which region of the schematic to embed. The embed renders as a live, read-only preview of that schematic region.

**Rendering:** Static SVG snapshot of the selected schematic area, 100% width, auto height, `--color-bg-input` background, `--radius-md`. A "View in editor" link in the corner opens the full schematic at that location.

**Updates:** The snapshot refreshes when the note is opened if the source schematic has changed. A small "Updated" badge appears briefly.

**Size:** Width fills the note column (max 680px). Height is proportional to content, max 400px with scroll for larger regions.

### 16.2 BOM Table Embed

**In Notes:** Type `/bom` to insert. A dialog lets the user select which project. The embed renders the project's current BOM as a formatted table.

**Columns:** Reference(s), Value, Footprint, MPN, Qty, Unit Price, Total Price.

**Styling:** `--font-mono` for data cells. `--color-bg-input` header row. Alternating row tints for readability. Right-aligned for numeric columns.

**Updates:** Live — reflects the current project BOM whenever the note is viewed. A small "Live from [Project Name]" label appears above the table.

### 16.3 Component Links

**In Notes:** Type `@` followed by a component reference (e.g., `@U1` or `@ESP32-S3`). Auto-complete dropdown shows matching components from the linked project.

**Rendering:** Inline pill with component icon + reference text. Purple tint (`--color-brand-bg`). Clicking navigates to the Design view and selects that component on the canvas.

**In Design (reverse):** Right-clicking a component on the canvas shows "Linked notes (2)" in the context menu. Clicking opens a list of notes that reference this component.

---

## 17. Keyboard Shortcuts

### 17.1 Global Shortcuts (Work in Any View)

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open command palette |
| `Ctrl+1` | Switch to Home |
| `Ctrl+2` | Switch to Design |
| `Ctrl+3` | Switch to Notes |
| `Ctrl+4` | Switch to Chat |
| `Ctrl+5` | Switch to Library |
| `Ctrl+\` | Toggle split view |
| `Ctrl+,` | Open settings |
| `Ctrl+Z` | Undo |
| `Ctrl+Shift+Z` | Redo |

### 17.2 Design View Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `A` | Add component (opens search) |
| `W` | Wire tool |
| `L` | Place net label |
| `P` | Place power symbol |
| `R` | Rotate selected (90° CW) |
| `F` | Flip selected (mirror) |
| `Delete` / `Backspace` | Delete selected |
| `Escape` | Deselect / cancel tool |
| `Ctrl+A` | Select all |
| `Ctrl+C` / `Ctrl+V` | Copy / paste |
| `Ctrl+D` | Duplicate selected |
| `Ctrl+G` | Group selected |
| `Ctrl+B` | Toggle left sidebar |
| `Ctrl+/` | Toggle AI copilot panel |
| `Ctrl+Shift+E` | Toggle error drawer |
| `Ctrl+0` | Zoom to fit |
| `+` / `-` | Zoom in / out |
| `Space + drag` | Pan canvas |
| `?` | Show keyboard shortcut overlay |

### 17.3 PCB-Specific Shortcuts

| Shortcut | Action |
|----------|--------|
| `X` | Start interactive routing |
| `V` (during routing) | Insert via |
| `B` | Refill all copper zones |
| `M` | Measure tool |
| `Ctrl+Shift+D` | Run DRC |

### 17.4 Notes View Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New page |
| `Ctrl+Shift+8` | Toggle bullet list |
| `Ctrl+Shift+7` | Toggle numbered list |
| `Ctrl+Shift+K` | Insert code block |
| `/` | Open slash command menu |

### 17.5 Shortcut Overlay

Pressing `?` in the Design view shows a semi-transparent overlay (80% viewport, centered, `--color-bg-elevated` at 95% opacity) listing all available shortcuts organized by category. Pressing `?` again or `Escape` dismisses it.

---

## 18. Onboarding System

### 18.1 First-Run Experience

**Step 1: Welcome modal** (centered, 480px wide, `--color-bg-elevated`, `--elevation-3`)

```
Welcome to OpenPCB!

Design your first PCB in minutes.

[Start guided tutorial]  ← Primary CTA, --color-brand
[Create blank project]   ← Secondary
[Import existing design] ← Tertiary
```

**Step 2: Interactive tutorial** (if selected)

A guided walkthrough that builds a "Blink LED" board. The tutorial uses a **spotlight + tooltip** pattern:
- A dark overlay covers the entire interface (60% opacity black)
- A "spotlight" cutout highlights the relevant UI element
- A tooltip (280px max, `--color-bg-elevated`, `--radius-lg`) appears near the spotlight with instructions
- "Next" / "Skip tutorial" buttons in the tooltip

**Tutorial steps:** (8 steps, approximately 12 minutes)

1. **Navigate the workspace** — Spotlight the icon rail, explain each icon
2. **Open a template project** — Click on "Blink LED" template
3. **Explore the schematic** — Pan and zoom the canvas, hover components
4. **Place a component** — Drag an LED from the library sidebar
5. **Wire it up** — Use the wire tool to connect the LED
6. **Run ERC** — Click the ERC button, see green checkmark
7. **Switch to PCB** — Click the PCB tab, see the board
8. **Export Gerber** — Click Export, download the ZIP

### 18.2 Tooltip Hints

On first use of each tool, a one-time tooltip appears near the tool button explaining what it does. These are tracked per-user and only appear once. Users can reset all hints in Settings.

**Tooltip format:** 200px max width, `--color-bg-elevated`, `--radius-md`, 8px 12px padding. Small "Got it" dismiss button. Auto-dismiss after 8 seconds if not interacted with.

### 18.3 AI-Guided First Project

Alternative to the spotlight tutorial. The AI copilot panel opens automatically and says:

> "Welcome! I'm your AI copilot. Want me to guide you through designing your first PCB? Just tell me what you'd like to build, or say 'walk me through the basics.'"

The AI then provides step-by-step conversational guidance, adapting to the user's pace and questions.

---

## 19. Responsive Behavior

### 19.1 Breakpoints

| Breakpoint | Width | Behavior |
|-----------|-------|----------|
| Desktop XL | >1440px | All panels open by default, comfortable spacing |
| Desktop | 1024-1440px | Left sidebar collapsed by default in Design view |
| Tablet | 768-1023px | Icon rail collapses to icon-only (no labels), left sidebar hidden |
| Mobile | <768px | Show "Desktop recommended" message, basic read-only note/chat access |

### 19.2 Panel Priority (Narrow Screens)

When space is constrained, panels collapse in this order:
1. AI copilot panel (first to go)
2. Split view panel
3. Left sidebar
4. Icon rail labels (icons remain)

The canvas never gets smaller than 400px wide.

---

## 20. Accessibility

### 20.1 Requirements

- **WCAG 2.1 AA compliance** for all UI chrome (panels, buttons, text)
- **Keyboard navigable:** All interactive elements reachable via Tab key. Focus rings (2px, `--color-brand`, 2px offset) on all focusable elements
- **Screen reader labels:** All icon buttons have `aria-label`. Canvas objects have `aria-description` for component type and reference
- **Color contrast:** All text meets 4.5:1 minimum contrast ratio against its background. Canvas colors exempt (creative tool exception) but adjustable in settings
- **Reduced motion:** `prefers-reduced-motion` media query disables all animations and transitions
- **Font scaling:** UI respects browser font size settings up to 150% without layout breaks

### 20.2 Focus Management

- When a modal opens, focus moves to the first focusable element inside
- When a modal closes, focus returns to the trigger element
- Tab order follows visual reading order (left to right, top to bottom)
- The canvas traps keyboard input when focused (for tool shortcuts) but releases on `Tab`

---

## 21. Component Inventory

Every reusable UI component that needs to be built, organized by complexity:

### Atoms (Primitive Elements)

| Component | Props | Usage |
|-----------|-------|-------|
| `Button` | variant (primary/secondary/ghost), size (sm/md/lg), disabled, icon | Everywhere |
| `IconButton` | icon, ariaLabel, size, active | Toolbar, panel headers |
| `Input` | type, placeholder, value, onChange, size | Forms, search |
| `Textarea` | placeholder, value, autoExpand, maxHeight | Chat input, notes |
| `Badge` | count, color (danger/warning/info) | Error counts, notifications |
| `Pill` | label, onRemove, color | Tags, filters |
| `Toggle` | checked, onChange, label | Settings, layer visibility |
| `Avatar` | initials, imageUrl, size (sm/md/lg) | User display |
| `Tooltip` | content, position, delay | Toolbar hints |
| `Divider` | orientation (h/v) | Separators |
| `Spinner` | size | Loading states |

### Molecules (Composite Elements)

| Component | Composed of | Usage |
|-----------|------------|-------|
| `SearchInput` | Input + icon + clear button | Component search, command palette |
| `TabBar` | Array of tab buttons | Schematic/PCB/3D/BOM switching |
| `TreeItem` | Chevron + label + icon + indent | Sidebar trees |
| `LayerRow` | ColorSwatch + label + Toggle | Layer panel |
| `ComponentCard` | Preview + name + MPN + price + rating | Library browser |
| `ErrorRow` | Severity icon + description + location | Error drawer |
| `ChatMessage` | Avatar + bubble + timestamp + actions | Chat and copilot |
| `ProgressBar` | Segmented bar + step labels | Wizard progress |
| `PopoverWrapper` | Positioning logic + arrow + content slot | Properties popover |

### Organisms (Complex Sections)

| Component | Description |
|-----------|-------------|
| `IconRail` | Global navigation rail with icons, logo, user avatar |
| `LeftSidebar` | Collapsible panel with Components/Layers/Tree sections |
| `EditorToolbar` | Context-sensitive toolbar that changes per view |
| `StatusBar` | ERC status + zoom + grid + save status |
| `PropertiesPopover` | Floating component properties editor |
| `ErrorDrawer` | Expandable bottom panel with error list |
| `PiP3DViewer` | Draggable/resizable Three.js miniview |
| `CopilotPanel` | Slim/expanded AI chat panel |
| `SplitViewContainer` | Resizable two-pane layout |
| `PageEditor` | Block-based rich text editor (Notes) |
| `WizardFlow` | Multi-step component creation flow |
| `CommandPalette` | Global fuzzy search modal |

### Pages (Full Views)

| View | Route | Primary Organisms |
|------|-------|-------------------|
| Home | `/` | ProjectGrid, QuickActions, RecentLists |
| Design | `/project/:id` | EditorToolbar, LeftSidebar, Canvas, CopilotPanel, StatusBar |
| Notes | `/notes` | PageTree, PageEditor |
| Chat | `/chat` | ChatList, ChatArea |
| Library | `/library` | SearchInput, FilterBar, ComponentGrid, WizardFlow |

---

## 22. State Management Map

### 22.1 Global State (Zustand Store)

```typescript
interface GlobalState {
  // Navigation
  activeView: 'home' | 'design' | 'notes' | 'chat' | 'library';
  
  // Theme
  theme: 'dark' | 'light';
  
  // User
  user: { id: string; name: string; email: string; avatar?: string; plan: string; } | null;
  
  // Notifications
  unreadChatCount: number;
}
```

### 22.2 Design Editor State

```typescript
interface DesignState {
  // Project
  projectId: string;
  projectName: string;
  isDirty: boolean;
  lastSaved: Date;
  
  // View
  activeTab: 'schematic' | 'pcb' | '3d' | 'bom';
  activeTool: 'select' | 'add' | 'wire' | 'label' | 'power' | 'route' | 'via' | 'zone' | 'measure';
  
  // Canvas
  zoom: number;                    // 0.05 to 50.0
  panOffset: { x: number; y: number };
  gridSize: number;                // nanometers
  snapToGrid: boolean;
  
  // Selection
  selectedIds: string[];           // UUIDs of selected objects
  hoveredId: string | null;
  
  // Panels
  leftSidebarOpen: boolean;
  leftSidebarWidth: number;        // 0 (collapsed) or 180+
  copilotOpen: boolean;
  copilotWidth: number;            // 92 (slim) or 280 (expanded)
  errorDrawerOpen: boolean;
  errorDrawerHeight: number;
  splitViewOpen: boolean;
  splitViewWidth: number;
  splitViewContent: { type: 'note' | 'chat'; id: string } | null;
  
  // Properties popover
  popoverTarget: string | null;    // UUID of component showing popover
  popoverPosition: { x: number; y: number };
  
  // 3D PiP
  pip3dVisible: boolean;
  pip3dPosition: { x: number; y: number };
  pip3dSize: { width: number; height: number };
  
  // Undo/Redo
  undoStack: Command[];
  redoStack: Command[];
}
```

### 22.3 Notes State

```typescript
interface NotesState {
  pages: PageMeta[];               // All page metadata (id, title, projectId, updatedAt)
  activePage: string | null;       // UUID of currently viewed page
  pageTree: TreeNode[];            // Hierarchical tree structure
  editorContent: Block[];          // Current page content blocks
}
```

### 22.4 Chat State

```typescript
interface ChatState {
  conversations: ConversationMeta[]; // All conversation metadata
  activeConversation: string | null;
  messages: Message[];               // Messages for active conversation
  isStreaming: boolean;              // AI is currently generating
  inputDraft: string;               // Current unsent message text
}
```

### 22.5 Library State

```typescript
interface LibraryState {
  searchQuery: string;
  activeFilters: {
    source: 'all' | 'user' | 'builtin' | 'community';
    category: string | null;
    package: string | null;
    inStock: boolean;
  };
  results: ComponentSummary[];
  
  // Wizard
  wizardOpen: boolean;
  wizardStep: 1 | 2 | 3 | 4;
  wizardData: Partial<ComponentDraft>;
}
```

### 22.6 Persistence Rules

| State | Persistence | Method |
|-------|-------------|--------|
| Global (theme, activeView) | Persisted | localStorage |
| Design (zoom, pan, panel sizes) | Per-project, persisted | localStorage keyed by projectId |
| Design (selection, tool) | Ephemeral | Memory only, reset on project close |
| Notes (page tree, content) | Cloud-synced | API + auto-save |
| Chat (conversations) | Cloud-synced | API + auto-save |
| Library (search, filters) | Ephemeral | Memory only |
| Wizard (draft data) | Session | sessionStorage (survives refresh, not tab close) |

---

*End of UI Specification. This document should be used alongside the Product Specification (v1.0) for complete implementation context. All measurements are in CSS pixels unless otherwise noted. All color values use the token system — never hardcode hex values in components.*