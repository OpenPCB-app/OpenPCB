# PCB standards reference

The durable standards half of a deep-research report that used to live at
`docs/PCB_Improvement_Planning/PCB_research.md`. That file is gone; this is what survives of it.

**The architecture half was dropped deliberately.** Its rendering recommendation — PixiJS over
WebGL2, with a Canvas2D fallback — contradicts a hard house rule: editor rendering in this
repository is **React Three Fiber only**, never Canvas2D, never PixiJS. Keeping a superseded
renderer proposal next to a live one is how an agent ends up implementing the wrong one, so the
Part 3 canvas sections, the Part 4 competitive teardown and the hybrid layer-model proposal went
with it. Nothing below depends on them.

What is here is the vocabulary and the numbers that fab data has to satisfy, plus the reasoning
behind two repo-wide invariants and the research's own record of what it was not sure about.

**Thresholds are not here.** The JLCPCB capability numbers the original quoted conflict with the
live JLCPCB capabilities page, and with the values in code, in more than one direction.
[`docs/drc/OPEN_FINDINGS.md`](../drc/OPEN_FINDINGS.md) carries the three-way conflict table and
the resolution rule that settles it. Read that rather than restating a number from here; no
manufacturing threshold is repeated in this document.

---

## 1. IPC-4761 — via protection

*Design Guide for Protection of Printed Board Via Structures.*

Seven covering types. Each one changes what the soldermask layer must contain for that via and
what fabrication flag has to travel with it — the hole geometry alone does not determine the
output.

| Type | Description | Soldermask / fab consequence |
|---|---|---|
| I-a / I-b | Tented, one- or two-sided — dry-film mask stretched over the via | Soldermask opening **suppressed** over the via pad |
| II-a / II-b | Tented and covered — mask plus a liquid mask print | Mask suppressed, plus a secondary mask pass |
| III-a / III-b | Plugged — partial fill with non-conductive paste | Mask present, plus a plug operation flag |
| IV-a / IV-b | Plugged and covered | Plug, plus mask suppressed |
| V | Filled — full non-conductive fill | Plug-fill flag |
| VI | Filled and covered | Plug-fill, plus mask suppressed |
| **VII** | **Filled and capped with copper** | Plug-fill, plus copper cap, plus a flat surface requirement |

**Why Type VII is the one that forces a data-model change.** Via-in-pad — putting the via inside
the component land rather than beside it — is unavoidable below **0.65 mm BGA pitch**, because
there is no room left between lands to escape a signal any other way. A via inside a pad that is
merely tented or plugged still leaves a depression, and solder wicks down it during reflow: the
joint starves, and the part sits crooked or open. Type VII fills the barrel and plates a copper
cap over it, which gives the pad a flat, solderable surface again. So at fine pitch the
protection type stops being a fab preference and becomes a functional requirement of the design.

**The consequence for the Via primitive:** it must carry a protection enum,

```
viaProtection ∈ { none, I-a, I-b, II-a, II-b, III-a, III-b, IV-a, IV-b, V, VI, VII }
```

because **the same hole geometry produces a different soldermask Gerber and a different
fabrication flag depending on protection type.** A via without this field cannot be exported
correctly; it can only be exported with a guess.

One scope limit worth recording: IPC-4761 covers **mechanically drilled vias only**. Microvias
are copper-filled by industry default, so the enum does not need to express a choice for them.

---

## 2. IPC-7351B — land patterns, courtyard, orientation

*Generic Requirements for Surface Mount Design and Land Pattern Standard.*

### 2.1 Density levels

One footprint geometry has three legitimate sizes, selected by the assembly context rather than
by the part. The level is a per-footprint (or per-design) choice, not a constant.

| Level | Name | Pads | Intended for |
|---|---|---|---|
| A | Most | Largest | High-vibration, aerospace, robust solder joints |
| B | Nominal | Middle | Consumer products — the default |
| C | Least | Smallest | HDI and fine pitch, where board area is the constraint |

Courtyard excess — the margin added around the union of component body and pads to produce the
courtyard rectangle — follows the level:

| Density level | Courtyard excess |
|---|---|
| A (Most) | 0.50 mm |
| B (Nominal) | 0.25 mm |
| C (Least) | 0.10 mm |

Chip parts of 1 × 0.5 mm and smaller take smaller excess values than the table.

The standard's One-World CAD Library naming convention encodes the geometry and the density
level in the footprint name — `RESC1608X55N` is a 1608 metric (0603 imperial) chip resistor at
Nominal density — which is why footprint names are worth generating rather than typing.

### 2.2 The RMS land-pattern formulas

Land dimensions are computed from datasheet extremes and tolerances, with the tolerance terms
combined in quadrature rather than summed. `Jt`, `Jh` and `Js` are the solder-fillet goals at
toe, heel and side, and they are what the density level actually selects.

| Output | Formula | Meaning |
|---|---|---|
| Z | `Z = Lmax + 2·Jt + √(Ltol² + 4F² + 4P²)` | Outer span of the land pair (toe to toe) |
| G | `G = Smin − 2·Jh − √(Stol² + 4F² + 4P²)` | Inner gap between lands (heel to heel) |
| Y | `Y = Wmax + 2·Js + √(Wtol² + 4F² + 4P²)` | Land width |

Inputs: `Lmax`/`Ltol` component length and its tolerance, `Smin`/`Stol` inner lead span and its
tolerance, `Wmax`/`Wtol` lead width and its tolerance, `F` fabrication tolerance, `P` placement
tolerance.

The consequence for a footprint editor is that pad sizes should be **recomputed from datasheet
inputs when the density level changes**, not stored as unrelated numbers per level. Note the
sign asymmetry: `Z` and `Y` grow with the fillet goal, `G` shrinks — heel fillet is subtracted.

### 2.3 Silkscreen placement rules

| Rule | Reason |
|---|---|
| Never under the component body | It is covered at assembly and cannot be read afterwards |
| Always inside the courtyard | Silk outside the courtyard collides with the neighbouring part's legend |
| Polarity dot visible after assembly | It exists to be checked on a populated board |
| Pin-1 marker visible after assembly | Same, and it is the last defence against a rotated part |

### 2.4 Zero-Component-Orientation and why it decides pick-and-place correctness

IPC-7351B fixes a **standard pin-1 rotation for every package family** — the Zero-Component
Orientation. It is a convention about what "rotation = 0" means for a given package, and on its
own it looks like a cosmetic choice about how footprints are drawn.

It is not cosmetic, because the pick-and-place file exports each part as a position and a
rotation, and the assembly machine applies that rotation to the part as it comes off the reel.
The reel orientation is standardised; the rotation in the file is interpreted against ZCO. If a
footprint's pin 1 sits at a non-ZCO angle, every instance of that part is placed at an offset
angle — commonly 90 degrees out — and the error is silent in the design and uniform on the
finished board. It is not caught by DRC, because nothing about the copper is wrong. It is caught
by a reflowed board full of rotated parts.

So ZCO conformance is a correctness property of the footprint library, and pick-and-place
rotation output must follow it rather than whatever angle the symbol happened to be drawn at.

---

## 3. Gerber X2 — file and aperture attributes

Gerber X1 (RS-274X) is a pure image format: one file per layer, and nothing in the file says
which layer it is. X2 (2014) adds attribute commands — `TF` (file), `TA` (aperture), `TO`
(object), `TD` (delete) — that carry metadata without changing the image. X2 is
backward-compatible: an X1 reader produces the same image and warns on the attributes it does
not know.

The attributes are what let a fab identify layers without a README, which is why they are a
must-have rather than a refinement.

### 3.1 `.FileFunction` — the per-layer vocabulary

| Attribute | Layer it identifies |
|---|---|
| `%TF.FileFunction,Copper,L1,Top,Signal*%` | Top copper, signal |
| `%TF.FileFunction,Copper,L2,Inr,Signal*%` | Inner copper, signal |
| `%TF.FileFunction,Copper,L3,Inr,Plane*%` | Inner copper, plane |
| `%TF.FileFunction,Copper,L4,Bot,Signal*%` | Bottom copper, signal |
| `%TF.FileFunction,Soldermask,Top*%` | Top soldermask |
| `%TF.FileFunction,Soldermask,Bot*%` | Bottom soldermask |
| `%TF.FileFunction,Legend,Top*%` | Top silkscreen |
| `%TF.FileFunction,Legend,Bot*%` | Bottom silkscreen |
| `%TF.FileFunction,Paste,Top*%` | Top solder paste (stencil) |
| `%TF.FileFunction,Paste,Bot*%` | Bottom solder paste |
| `%TF.FileFunction,Profile,NP*%` | Board outline, non-plated |

Two companions travel with them: `%TF.FilePolarity,Positive*%` and `%TF.Part,Single*%`.

Note that silkscreen is `Legend` in this vocabulary — the Gerber name and the editor name differ,
and the mapping has to be explicit.

### 3.2 `.AperFunction` — the per-primitive vocabulary

Aperture attributes (`%TA.AperFunction,…*%`) classify each D-code, which is how a fab tells a via
pad from a BGA pad when both are copper on the same layer.

| Class | Applies to |
|---|---|
| `Conductor` | Traces and other routed copper |
| `ViaPad` | Via lands |
| `ComponentPad` | Through-hole component lands |
| `WasherPad` | Copper ring around a NON-plated hole, no electrical function (S11, contract 10 §6.4; Ucamco spec 2022.02 §5.6.10 — such a pad carries no `.P` object attribute) |
| `SMDPad,CuDef` | Surface-mount pad, copper-defined |
| `SMDPad,SMDef` | Surface-mount pad, soldermask-defined |
| `NonConductor` | Non-conducting artwork on a copper layer |
| `Fiducial` | Fiducial marks |

### 3.3 The rule

**Every layer in the stackup carries a fixed `.FileFunction`, and every primitive carries an
`.AperFunction` derived from its type.** Both are properties of the layer model and the primitive
model respectively, not decisions made at export time. If the export code has to infer either
one, the model is missing a field.

---

## 4. Integer nanometres — the recorded reasoning

This is the "why" behind a repo-wide invariant: world coordinates are **integer nanometres**, and
floating-point storage units are not permitted (see the coordinate contract in `CLAUDE.md`). The
reasoning was recorded from KiCad's own source and is preserved verbatim rather than paraphrased,
because a paraphrase of "avoids rounding issues" loses the specific properties being bought.

KiCad `include/base_units.h`, verbatim comment in source:

> "The next choice is what to use for internal units (IU), sometimes called world units. If
> nanometers, then the virtual space must be limited to about 1.5 × 1.5 meters square. This is
> 1518500251 divided by 1e9 nm/meter. The maximum zoom factor then depends on the client window
> size. … Pcbnew uses nanometers because we need to convert coordinates and size between
> millimeters and inches. Using a iu = 1 nm avoids rounding issues. Gerbview uses iu = 10 nm
> because we can have coordinates far from origin, and 1 nm is too small to avoid int overflow."

The KiCad user manual states the same constraint from the user's side:

> "The internal measurement resolution of all objects in KiCad is 1 nanometer, and measurements
> are stored as 32-bit integers. This means it is possible to create boards up to approximately
> 4 meters by 4 meters."

And the research report's own summary of why integer, in its own words:

> **Why integer**: rounding-error-free Boolean polygon operations (Clipper/boost-polygon is exact
> on integers), exact transform composition, lossless save/load, deterministic DRC results across
> machines.

Those four properties are the whole argument, and each is load-bearing:

| Property | What is lost without it |
|---|---|
| Exact Boolean polygon operations | Pour clearance halos and zone fills produce slivers and self-intersections that vary run to run |
| Exact transform composition | Rotating and moving a footprint repeatedly drifts its pads off their own grid |
| Lossless save/load | A file that round-trips through save and reload is not the file that was saved |
| Deterministic DRC across machines | Two engineers on the same board get different violation sets, and no violation id is stable |

The last one is why this is a hard invariant rather than a preference. Determinism across
machines is a property that cannot be recovered later by rounding at the boundary: once a float
has entered the persisted state, every downstream check inherits its error.

For completeness, the other tools' units, since importers have to reconcile them:

| Tool | Internal unit |
|---|---|
| KiCad | 1 nm, signed int32; board bound approximately 4 × 4 m |
| Altium | 1/10 000 mil = 0.254 µm = 254 nm, 32-bit integer; range approximately 52 × 52 m |
| EasyEDA Standard | 10 mil base increments — coarse, an artefact of the editor's origins, and a source of rounding mismatch on import |
| EasyEDA Pro | Closer to 1 nm |
| Flux | JavaScript doubles (inferred, not documented) |

---

## 5. Format adoption — what is actually required

The design consequence of this section is scope: it says which exporter is non-negotiable and
which ones are optional, and it is the reason the export bundle looks the way it does.

| Format | Status | Detail |
|---|---|---|
| **Gerber X2 + Excellon drill + `.gbrjob`** | **The only must-have** | This is the bundle a fab consumes. X2 attributes are what identify the layers; the Gerber Job file (JSON, 2018+) describes layer order, thickness, finish, materials and RoHS, and replaces the README or fab-drawing PDF |
| Gerber X3 | Limited adoption | Published 2020, adds component and assembly attributes so pick-and-place data travels inside the Gerber package. Practitioner reports as of 2026 still describe adoption as limited relative to X2. Nice-to-have |
| ODB++ | Dominant in Asian fabs | Single archive (`.tgz`/`.zip`) of per-layer directories plus a `matrix` file that is the stackup, each row a physical layer with a role (`SIGNAL`, `POWER_GROUND`, `MIXED`, `SOLDER_MASK`, `SILK_SCREEN`, `SOLDER_PASTE`, `DRILL`, `ROUT`, `DOCUMENT`). Proprietary to Siemens but openly documented |
| IPC-2581 | Supported but rarely required | Open, vendor-neutral single-XML exchange format with broad consortium backing. Revision C (2020) adds DfX/DFM data, controlled impedance, net-level differential-pair identification and embedded components. Adoption has been slower than its technical merits predicted; most fabs still default to Gerber plus an IPC-356 netlist |

The short version: **ship Gerber X2 plus drill plus job file first and correctly.** ODB++ and
IPC-2581 buy compatibility with fabs that mostly accept Gerber anyway.

---

## 6. Two foot-guns to keep designing against

These are other tools' mistakes, recorded because they are easy to reproduce accidentally.

### 6.1 EasyEDA: hiding a layer does not stop it being exported

From the EasyEDA Standard documentation:

> "Hiding a layer in the UI does not suppress it from Gerber output … the objects of the hidden
> layer still exist; when you generating the Gerber, they will appear."

The Pro documentation repeats the warning, adding that the layer "will still be exported during
photo preview, 3D preview and Gerber export."

The failure mode is specific and expensive. A user hides a documentation or mechanical layer to
get it out of the way, reads the canvas as the truth about what will be manufactured, and
receives boards with that artwork printed on them. Nothing in the tool ever told them otherwise,
because the tool's own model conflates two different questions.

**The rule this yields: visibility and export inclusion are orthogonal properties, and the
difference must be surfaced.** Every layer needs a canvas-visibility state and a separate
export-inclusion flag; documentation layers default to not exported; and the UI has to make the
divergence visible — a layer that is hidden but still exported, or visible but excluded, is
exactly the state a user cannot infer and must be told about. Silently deriving one from the
other reproduces the bug in a new tool.

### 6.2 KiCad: only one dielectric between copper layers

Community-reported and worked around in practice, from the maintainer of an auto-generated
stackup script:

> "KiCAD does not properly support multiple dielectric layers between copper layers."

The workaround in the field is to combine adjacent dielectrics into a single item, which loses
the real construction.

This matters for impedance-controlled 4-layer and 6-layer stackups, where the dielectric between
two copper layers is genuinely built from several prepreg sheets — a "7628 ×2" build is two
sheets of 7628 prepreg, not one thicker layer. Modelling it as one item makes the total thickness
right and everything derived from the construction wrong: impedance solving, via-height
computation for length tuning, and what the stackup pane tells the fab.

**The rule: the stackup model must accept a sequence of dielectric items between two copper
layers, each with its own thickness, material, Dk and Df.** This is a place to be better than
KiCad rather than compatible with it.

---

## 7. Uncertainty log

The original report kept its own record of what it was not certain about, and it is preserved as
an uncertainty log rather than folded into the assertions above. Confidence levels are the
original's.

| Claim | Status | Confidence |
|---|---|---|
| KiCad has "60+ layers" | **Misleading — do not repeat.** The figure is the cardinality of the `PCB_LAYER_ID` enum, which in KiCad 9 exceeds 200 entries, most of them GAL virtual layers (cursor, grid, DRC markers, selection shadows, ratsnest, per-net colouring). Physical board layers are the copper count plus roughly 25 fixed technical, silk, mask, paste, courtyard, fab, edge and user layers | High |
| KiCad supports 32 copper layers, even counts only | Consistent across KiCad 6 through 9 documentation; forum threads reference experiments with higher counts in 9.x master. Treat anything above 32 as experimental | Medium-high |
| KiCad's ratsnest is Delaunay triangulation plus MST with a per-net cache | **Inferred**, from the `pcbnew/ratsnest/*` source-tree filenames and the connectivity-algorithm Doxygen. No single authoritative published paragraph was found | Medium |
| Flux's renderer and internal coordinate precision | **Not publicly documented.** WebGL was inferred from observed performance characteristics; it could equally be Canvas2D with offscreen-canvas techniques. Coordinates are assumed to be JavaScript doubles | Low-medium |
| Flux's file format | Cloud-only, no published schema. Flux cannot import layouts itself, so there is no interchange path to reverse-engineer | High that no path exists |
| **EasyEDA Standard and Pro swap two layer numbers** | **Sources differ, and importers must distinguish the format version.** Per KiCad's importer developer documentation: in Standard, paste = 5/6 and mask = 7/8; in **Pro these are swapped** — mask = 5/6, paste = 7/8. An importer that assumes one numbering will silently produce a board whose stencil and mask artwork are exchanged | Documented divergence; version detection is mandatory |
| Gerber X3 adoption | Spec published by Ucamco in 2020; practitioner sources report adoption still limited relative to X2 | Medium-high |
| ODB++ versus IPC-2581 among Asian fabs | Multiple independent sources agree ODB++ is more prevalent today and IPC-2581 is the "preferred future" with slow uptake | Medium-high |
| Altium's maximum mechanical layer count | 32 in pre-AD17 documentation, 1024 from Altium Designer 17.0. **Both are correct, for different versions** | High |
| KiCad cannot model multiple sequential dielectrics between copper layers | Community-reported, worked around in a public stackup-generation script. See §6.2 | High |

Renderer- and GPU-related uncertainties from the original log were dropped along with the
architecture sections; they concerned a rendering stack this repository does not use.
