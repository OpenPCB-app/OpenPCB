# OpenPCB Roadmap

What is shipped, what is coming next, and what OpenPCB is deliberately not going to be. This is a
living document and the ordering reflects current priorities rather than commitments — dates are
not promised anywhere on this page.

For how to run and build the app, see [`DEVELOPER.md`](DEVELOPER.md). For the day-to-day open work,
see [`TODO.md`](TODO.md); this roadmap stays at the level of features a user would notice.

## Shipped

### 0.1.0-beta — the first public beta

The first release established the whole path from idea to fabrication output.

**Schematic capture** arrived complete enough to draw real circuits: symbol placement, Manhattan
wire routing, net labels, junction detection, nets extracted from geometry rather than
hand-maintained, ERC scaffolding, and undo/redo that survives a restart because every edit is a
command with an inverse patch.

**PCB layout** shipped with trace routing in Manhattan and 45° modes, via placement with a layer
switch, pad rendering, an MST ratsnest, board outline drawing, component placement synced from the
schematic, live design rule checking, and IPC-2221B-aware net classes.

**The component library** shipped with symbols, footprints from both an IPC-7351B preset generator
and a drawn editor, KiCad `.kicad_sym` and `.kicad_mod` import, seeded built-in components, and
STEP-to-GLB conversion for 3D preview.

**Manufacturing export** shipped in the same release: Gerber X2, Excellon drill, bill of materials
and pick-and-place, bundled as a single ZIP.

Underneath, the module runtime shipped with dynamic discovery, topological boot, per-module SQLite
with automatically applied migrations, and code-generated SDK and module registries. Desktop builds
covered macOS (arm64 and x64), Windows x64 and Linux x64 — unsigned, as they still are.

### 0.1.1-beta — the second public beta

The bundled component library grew from seventeen parts to more than two hundred, with symbols,
footprints and 3D models pre-baked into the pack rather than converted at runtime, and verified for
integrity and signature when the app builds.

PCB work in this release centred on the routing experience and on custom board shapes with
dimensioned sketching: finish-anywhere routing, a live heads-up display, keymap fixes, bundle
routing, diagonal meanders, tuning and walkaround, a route layer auto-picked from the pad you
clicked, and a decluttered toolbar.

Design rule checking went through a production-hardening pass covering measurement epsilons,
net-class and stackup resolution, stable violation identities that keep waivers valid across edits,
fabricator profiles, electrical checks, and signal-integrity checks for differential pairs and
length matching. The same work lifted the underlying type model to arbitrary stackups.

The manufacturing export overhaul landed **silkscreen text rasterization** — silk text is now
rendered into the Gerber output rather than dropped — alongside export handling for both 2- and
4-layer stackups.

Schematic wiring was overhauled off the back of a full audit: draggable wire segments, a robust drag
lifecycle, and fixes for phantom-wall re-routing.

A new **Knowledge module** brought documentation pages into the app: a page tree with a rich-text
editor, PDFs stored as pages, and text or markdown import. The library surfaced pack metadata
end-to-end — subcategory, datasheet links, keywords and manufacturer part numbers.

Releases began publishing `SHA256SUMS.txt`, and the auto-update feed was pointed at the correct
repository.

**Crash reporting** is integrated and **opt-in**: it is off by default, and nothing is sent unless
you turn it on.

## Next minor releases

**Trace segment drag-editing** — moving an existing trace segment with vertex handles, rather than
deleting and re-routing it.

**Net-class-aware width and clearance while routing.** Net classes already resolve clearance for
DRC; the route tool should honour per-class trace width and via geometry as you draw, not only when
you check.

**Differential pair routing**, using the `_P` / `_N` suffix convention, and the length-tuning and
bundle-routing tools graduating out of development flags once they clear manual QA on real boards.

**The layer-count picker.** This is a user-interface gap rather than a capability gap, and the
previous version of this roadmap described it wrongly. The board type model supports stackups from
2 to 32 layers, and the Gerber and drill export path handles 2- and 4-layer boards today. What is
missing is the front end: the board panel still renders a fixed "2-layer" label that is not bound
to the board's real layer count, board thickness is fixed at 1.6 mm rather than per design, and
inner-layer output still needs validation coverage. Until the picker ships, 4-layer boards arrive
by importing a KiCad project rather than by being created in the app.

**Copper zones and keepouts.** Also narrower than previously described. Whole-layer copper fill
renders and exports to Gerber region primitives today. Bounded zones exist only as data imported
from KiCad projects — there is no zone drawing tool, and keepout regions are not implemented. The
work is a zone authoring tool plus keepout support, not a fill engine.

**MCP server and Claude Code.** OpenPCB's tools over the Model Context Protocol, so an external
agent — above all Claude Code on the user's own Claude subscription, also Claude Desktop and Codex —
can do everything the in-app Assistant does, plus PCB placement, routing, board outline, rules,
zones, keepouts, waivers, design management and undo. Setup is one click in Settings (a local
Claude Code plugin with workflow skills, or the MCP server alone); the server and writes are both
off until the user enables them, and deletions and rule changes wait for approval in the app.
Implemented; awaiting a packaged-build smoke test on each desktop platform before release (see
`TODO.md` §3).

**Drill slot authoring**, project export and import for backup and portability, and mapping
manufacturer part numbers from KiCad symbol fields on import.

## Production readiness

These are the things standing between the beta line and a 1.0 that a stranger can trust.

**Code signing and notarization.** macOS Developer ID, and a Windows individual-validation
certificate — EV certificates are not available to individual developers. This is deferred while
the project is a solo beta, and revisited at 500 downloads per month, on the first commercial
licence enquiry, or if the macOS download share overtakes Windows. Until then, `SHA256SUMS.txt` is
the verification path.

**macOS auto-update** is blocked behind that same decision: Squirrel.Mac rejects an ad-hoc
signature, so macOS falls back to a notify-only check. Windows and Linux auto-update already ship.

**Error handling and recovery.** Global error boundaries, graceful shutdown that closes the server
and database cleanly, and translating machine-readable backend problems into messages a user can
act on.

**Trustworthy DRC results.** The check set is broad; the remaining work is removing the checks that
report false results, making the whole engine fast enough to stay live on large boards, and giving
rules and severities a real editing surface instead of leaving them backend-only.

**Test coverage.** Frontend unit coverage is thin, and the end-to-end suite needs a flagship
scenario that walks capture, routing, DRC, export and undo in one pass, plus import and export
validation harnesses.

**Accessibility.** A baseline pass: labelled controls, keyboard navigation on the canvas, and a
screen-reader review.

**Compile-time layer enforcement.** The layer model is documented and reviewed but not enforced by
tooling; boundary linting would make a violation impossible rather than merely discouraged.

## Out of scope for v1.0

**Cloud and collaboration features are not part of v1.0.** Cloud sync, shared workspaces, presence,
comments and cloud-assisted layout exist in the codebase behind development flags and are absent
from release builds. When they ship they will be opt-in, and the local-first behaviour described
above will remain the default — a design that is not shared never contacts a server. Anything
currently behind a development flag is likewise outside the v1.0 commitment until it graduates,
which is a deliberate position rather than an oversight.

**Autorouting beyond manual routing with DRC assistance.** Interactive assistance, length tuning
and bundle routing are in scope; a full autorouter is not.

**Schematic-wire-to-PCB-trace auto-sync.** The bridge between schematic and layout is the netlist.
The ratsnest plus manual routing replaces it, and that is a design decision rather than a missing
feature.

**Circuit simulation.** No SPICE, no signal simulation beyond the geometric signal-integrity checks
DRC already performs.

**A web or mobile version.** OpenPCB is a desktop application.

## Influencing the roadmap

Open a GitHub issue with the `discussion` or `feature_request` label and explain the use case — the
board you are trying to build matters more than the feature you have in mind. Items are weighted by
user demand, technical risk and licence compatibility.
