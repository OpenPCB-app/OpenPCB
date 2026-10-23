# Electrical validation: capabilities and acceptance contracts

This reference describes the electrical review against baseline commit
`0182502ab11cc5ba4e910f6e1caec2f0ac603db2`, reviewed on 2026-10-22, and the associated working-tree
corrections. It is a code-coupled technical reference, not a backlog or a declaration that OpenPCB is
ready for professional sign-off. Future work and prioritization belong in the existing Plane project.

## Scope and evidence boundary

The review covers schematic net derivation and ERC, KiCad electrical-marker import, report ownership,
PCB rule resolution, effective nets, scalar constraints, length and differential-pair checks, and the
meaning of electrical/manufacturing claims. Relevant implementation lives in
`src/modules/designer/backend/erc/`, `backend/import/kicad-project/`, `backend/projection-*.ts`,
`frontend/stores/erc-store.ts`, `src/shared/drc/`, and `src/shared/pcb-connectivity/`.

Code inspection and targeted regressions establish only their stated cases. A clean test suite does
not establish correctness for every imported design, manufactured board, operating mode, or safety
standard. Bench measurements, fabrication verification, and qualified product-specific review remain
separate evidence. The final validation section records executed checks; test filenames alone are not
proof that those checks passed.

Existing contracts remain authoritative for their algorithms:
[connectivity](01-connectivity-contract.md), [rule semantics](05-rule-semantics-contract.md),
[batch reporting](06-batch-drc-contract.md), [live parity](07-live-parity-contract.md),
[manufacturability](10-manufacturability-contract.md), [DFM](11-dfm-contract.md),
[electrical estimates](13-electrical-contract.md), [geometric SI](14-si-contract.md), and
[high-speed extension boundaries](15-high-speed-runway.md).

## Capability inventory

External comparison uses KiCad 10.0.7, ngspice 47, and Altium's current, unversioned documentation.
KiCad 10.0.8 was a release candidate on the review date. Altium features can require extensions or
subscriptions; Open Beta features are identified below. Sources are listed at the end.

| Capability | OpenPCB baseline and correction boundary | Professional reference |
| --- | --- | --- |
| Schematic ERC | Baseline checks disconnected input-like pins, conflicting output drivers, and connected `no_connect` pin types. Connection existence is not proof of a driver. | KiCad provides configurable pin conflicts, drive checks, hierarchy/bus checks, NC intent, and library consistency. Altium combines connection-matrix and project validation. [K1, A1] |
| Power and NC intent | Power primitives name nets. Placed pins now support intentional NC and external-source assertions, with inspector controls and distinct schematic markers. Imported KiCad assertions remain unsupported. | KiCad distinguishes `PWR_FLAG`, normal power symbols, NC flags, and unconnected pin types. Power does not automatically propagate through passive parts. [K1] |
| PCB geometry and DFM | Shared connectivity, rounded-pad geometry, copper/edge/hole rules, annular rings, zones, mask, silk and courtyard checks exist. Coverage exceptions remain below. | Both tools cover connectivity and manufacturing constraints; Altium also organizes testpoint and placement constraints. [K2, A2] |
| Rule reporting | Scoped rules, severity, ignores, waivers, deterministic IDs, worker runs and live subsets exist. A live pass is not a full batch pass. | KiCad offers rule-resolution inspection and exclusion comments. Altium records waiver author, date and reason in reports. [K2, A3] |
| Voltage and current | `CREEPAGE_DISTANCE` measures same-layer straight-line copper spacing against an IPC-2221B transcription. `TRACE_CURRENT_WIDTH` is an empirical width estimate. | These are narrower than surface creepage, insulation coordination, or thermal/PI simulation. See standards below. |
| Geometric SI | Copper-path length, same-layer differential gap, uncoupled length and chain skew exist. Undefined paths are not arbitrary trace-length sums. | KiCad 10 adds stackup-based tuning profiles and delay tuning. Altium supports impedance profiles, delay/length, stubs and return-path rules. [K2, A4, A5] |
| Circuit simulation | No integrated SPICE execution/model workflow was identified in the reviewed implementation. | KiCad exposes OP/DC/AC/transient/PZ/noise/S-parameters/FFT/custom analysis. Altium additionally documents transfer, sweeps, Monte Carlo and sensitivity workflows. [K1, A6] |
| SI, PI and thermal solving | Geometric SI does not establish impedance, channel performance, power delivery or temperature. | Altium's legacy SI handles reflections/crosstalk. Keysight SI is Open Beta; Keysight PI is DC analysis. Ansys CoDesigner transfers designs to external analysis. [A7–A10] |

KiCad's routing preferences do not automatically enforce every DRC constraint: differential gap
bounds require rules, and tuning-profile geometry checks default to ignored. Altium likewise documents
rule scopes that its interactive router cannot enforce. A release gate must state what actually ran.

Additional professional benchmark dimensions below are requirements to assess, not newly established
OpenPCB defects:

- **Design consistency:** KiCad checks bus membership/aliases, shared pins and missing units,
  case-confusable labels and library mismatches. Schematic/PCB parity includes missing or extra
  footprints and differing Value, DNP and BOM attributes. Fixtures need stable identity and metadata.
  [K1, K2]
- **Test access:** Altium separates bare-board fabrication tests from assembled-board tests. Rules
  cover net/branch coverage, probe dimensions, spacing, side and accessibility; these require explicit
  testpoint intent and assembly state. [A11]
- **Assembly-aware routing:** Altium checks SMD entry direction, first-corner distance, neckdown and
  distance to a plane connection. Some coupled routing bypasses these constraints, reinforcing the
  need for batch checks. [A12]
- **Mechanical clearance:** Altium supports placement regions, height and horizontal/vertical
  component clearance. Its component-clearance rule excludes body-versus-board-surface checks.
  Courtyard checks alone do not establish these results. [A13]
- **Simulation results:** Analysis names are insufficient: waveform expressions, RMS/rise-time
  measurements, repeated-run statistics and digital X/Z behavior need explicit result contracts and
  reference fixtures. [A14]

Design-consistency checks belong with the identity foundation. Test access and mechanical analysis
depend on additional metadata. An equivalent KiCad testpoint or 3D rule suite was not verified here.

## Correction contracts and regression coverage

The following contracts describe the reviewed correction batch. Final execution results belong in
the validation section, not in the presence or names of these regressions.

| Defect or omission | Required corrected behavior | Regression source |
| --- | --- | --- |
| KiCad `PWR_FLAG` interpreted as a named rail | Identify `power:PWR_FLAG` by library identity, independent of display value; omit the unsupported assertion rather than joining unrelated supplies. Inspect emits `kicad_power_flag_unsupported` at warning severity. | `src/core/backend/tests/kicad-electrical-markers-import.test.ts` |
| Imported NC intent disappeared silently | Inspect emits `kicad_no_connect_unsupported` and the marker count. Import still omits these markers; this is disclosure of unsupported intent, not NC support. | Same marker-import regression. |
| Connected inputs could lack a driver | Check signal and power drive independently of graphical attachment. A wire, junction, label, or named power primitive does not itself prove a source. Preserve isolated-pin diagnostics without duplicates. | `src/core/backend/tests/erc-hardening.test.ts` |
| Net naming/attachment evidence was not surfaced in ERC | Preserve conflicting power-rail and ground-label diagnostics through both projection paths; report unattached labels and named ports with precise anchors. | `src/core/backend/tests/erc-net-diagnostics.test.ts`, `erc-hardening.test.ts` |
| Unsupported symbol metadata could appear checked | Emit `MULTI_UNIT_SYMBOL_UNSUPPORTED` when one placement contains multiple positive pin units and `PIN_ELECTRICAL_TYPE_UNKNOWN` for unsupported types. These diagnostics expose unreliable or unassessed connectivity; they do not repair it. | `src/core/backend/tests/erc-hardening.test.ts` |
| An old ERC request could overwrite a new design | A generation change invalidates old successes and failures. Reset design scope in a layout effect before panel passive effects start a new run. | `src/modules/designer/frontend/stores/erc-store.test.ts`, `use-erc-design-scope.test.ts` |
| Explicit DRC override cancelled the route | Restore canvas focus before removing the clicked override button. Keep the active gesture and explicit override; Enter still uses the normal commit gate. Apply the same focus handling to Tune. | `tests/e2e/pcb-drc.spec.ts`, `pcb-live-parity.spec.ts`; Tune hotkey focus is covered in `pcb-routing.spec.ts`. |
| A fast PCB click could leave a selection gesture active | Finish marquee selection through the hook's queued state updater even if pointer-up precedes the render exposing pointer-down. Preserve existing drag ordering and shortcut scope. | `tests/e2e/pcb-routing.spec.ts` sends pointer-down/up in one task, then verifies one Escape exits idle Tune. |
| Batch DRC could not start in the Node source backend | Select a module-relative source bootstrap that registers tsx before loading the TypeScript worker. Preserve Bun's native entry and compiled/Electron entry overrides. Retain original startup errors, exit codes and timeout causes; queued runs must recover. | `src/core/backend/tests/drc-worker-node.test.ts`, `drc-worker.test.ts`, worker golden smoke and browser batch DRC. |
| Scalar scopes missed physically connected unassigned copper | Resolve width, via size/drill/ring, edge and hole-pair scopes through effective nets. Plated holes retain their copper owner; mechanical holes remain unassigned. Rejudge affected existing copper during pending connections and replacements. | `src/core/backend/tests/drc-effective-scalar.test.ts` |
| Exact SI tolerance boundaries failed through floating error | Use the shared lower/upper comparison policy at target endpoints; retain violations outside the grace interval. | `src/core/backend/tests/drc-si-rule-validity.test.ts` |
| Missing SI members became silently ineffective | Emit `DRC_RULE_INEFFECTIVE` for missing length-group or differential-pair net references. Keep valid group members checked; do not reinterpret a missing partner as uncoupled copper. | Same SI-validity regression. |

## Remaining version-specific hazards

These distinctions prevent a deliberate limited contract from being confused with a repaired defect.

| Boundary | Classification and consequence |
| --- | --- |
| Imported NC and power-source assertions | Native pin-bound assertions are supported; imported KiCad markers are still warned about and omitted. Assertions on arbitrary wire locations need a faithful mapping before import can preserve them. Named rails remain naming intent, not proof of a source. |
| Multi-unit symbols | Correctness hazard in placement and import. Unit/part/pin mapping can introduce artificial shorts when pins from multiple units share one placement. ERC now reports mixed positive units as unsupported. Separate unit instances and package pin identity remain unresolved; the diagnostic cannot repair a corrupted graph. |
| Hierarchical import | Representation gap with correctness consequences. Sheets are flattened; local/hierarchical scope is not faithfully preserved. Equal labels in separate instances can acquire unintended shared identity. |
| Same-footprint pad pairs | Deliberate exemption with incomplete coverage. `checks/clearance-judge.ts` uses `shortTierOnly` for exact intra-footprint pairs, bypassing ordinary clearance/fab tiers; inexact pairs have a broader exception. Replace blanket provenance exemptions with explicit supported intent, not silently with a new threshold. |
| Custom and degenerate pads | Geometry coverage gap. Bounding-shape approximations and skipped/inexact shapes cannot establish exact shorts, clearance, or connectivity. Unsupported geometry requires visible coverage diagnostics before a clean report can be interpreted broadly. |
| Legacy rule input parsing | New SI writes are validated atomically. Stored malformed or unsupported rule data produces non-overridable diagnostics. Existing explicit-write normalization still replaces malformed known optional values and can drop non-record array entries; preserving unknown fields does not imply preserving every invalid known value. |
| Persisted SI net IDs | Identity boundary. Derived net IDs can change after edits. Missing-member warnings reveal some stale references; stable pin/pad endpoint bindings and re-resolution are still needed. |
| Existing unrouted/terminal-less nets | Deliberate SI boundary. Length checks leave `open` and `terminals` to connectivity/coverage semantics. They are not equivalent to a stale rule reference or a measured zero-length route. |
| Active-tool/dock focus | Interaction hazard. Leaving an active Route tool can remove its parameter row during a pointer click and shift dock controls before mouseup. The batch smoke waits for client commit completion and exits Route before opening DRC; broader pointer/layout stability remains unresolved. |
| Electrical estimates | Deliberate bounded model. Undeclared voltages use the reference-potential assumption; effective-net derivation excludes pours and uncertain contacts. Current sharing, finished copper and via/pour ampacity are unassessed. |
| Stackup, insulation and simulation | Missing analysis foundations. Geometry alone cannot supply material properties, source/load behavior, insulation intent, valid device models, or operating conditions. |

## Native intent and report contracts

`DesignerPin.electricalIntent` belongs to the stable placed-pin identity, not a derived net ID or
library pin type. `set_pin_electrical_intent` accepts `no_connect`, `power_source`, or `null` to clear
the assertion. Unknown stored strings survive database/world round trips and unrelated edits; ERC
reports them as unsupported instead of interpreting them. A library `no_connect` pin cannot declare
a power source.

Intentional NC suppresses only that isolated pin's unconnected diagnostic. Connecting the pin emits
`NO_CONNECT_INTENT_VIOLATION`; the command remains valid so ERC can describe the actual inconsistent
design. External-source intent supplies the pin's current net without naming or joining nets, and
does not add another physical output driver. It does not prove voltage compatibility or current
capacity. Move, rotation, mirroring, footprint refresh, delete/undo, and reopen preserve the assertion.

`duplicate_part` copies the placed snapshot rather than resolving the current library entry. It
preserves pin intent, symbol, footprint, value, properties and pose, allocates fresh part/pin IDs and
a fresh reference, and recomputes pin positions. Wires are not copied. Duplication is one revision
and one undo entry; batch failures roll it back. Supplied and transformed positions must remain safe
integer nanometres.

Cloud transport has no verified capability to preserve these assertions. Outgoing link, seed,
snapshot and command mirroring therefore refuse designs containing any stored pin intent. Local
edits remain intact and the link records an explicit failure. Checks surround asynchronous linking;
an older acknowledgment cannot clear a newer unsupported-intent failure or move the acknowledged
revision backwards. Clearing the final assertion permits a complete snapshot reseed. Incoming cloud
import checks raw pin data before creating a local design and refuses intent it cannot preserve.

New length-group and differential-pair writes reject malformed rows and parameters before lazy
settings creation, with the same command result through SDK and HTTP. Legacy readers remain
tolerant. Separate `ruleReadDiagnostics` describe losses in `lengthMatchGroups`, `diffPairs` and
`drcRules`, including unsupported kinds and defaulted numeric values. Batch DRC emits
`DRC_RULE_INVALID` for these diagnostics; ignore settings, severity overrides and waivers cannot
suppress them. Existing malformed board settings are recovered in memory without rewriting the raw
row. Required-field fallbacks are reported, and valid declared rules beside a malformed outline stay
in effect. This is not a complete schema audit of all board settings or a live-gate coverage claim.

Batch reports carry optional versioned `evidence`: executed stages, requested suppression settings,
severity overrides, waiver IDs, and explicit assessment limitations collected before suppression.
Older reports and live/pending finalization have no batch evidence. Stage execution is not proof
that every object, geometry or standard was assessed. Missing, stale, running, failed and cancelled
reports remain distinguishable from a current report; retained results are labeled as history.
Non-waivable codes remain visible in report counts and canvas markers even if a stored waiver list
contains their IDs.

Contract regressions include `designer-pin-electrical-intent.test.ts`,
`designer-duplicate-part.test.ts`, `erc-pin-electrical-intent.test.ts`,
`designer-cloud-pin-intent.test.ts`, `designer-si-rules-validation.test.ts`,
`drc-stored-rule-diagnostics.test.ts`, `drc-run-evidence.test.ts`,
`drc-report-evidence-persistence.test.ts`, and `tests/e2e/pin-electrical-intent.spec.ts`.
Execution results below distinguish the initial audit batch from later implementation validation.

Persisted findings are validated before display, including optional measurements, locations and
waiver flags. A malformed findings array makes that report unavailable; it is not converted into an
empty successful result. Counts are reconstructed from valid findings, and forged waiver flags on
non-waivable codes are discarded. Structurally valid future code names remain visible.

## Standards and interpretation

IPC-2221C, published in December 2023, is the generic printed-board design reference located in this
review. OpenPCB deliberately pins an older IPC-2221B spacing transcription; its existing contract
records that primary verification of those values is pending. Do not relabel that table as current
IPC compliance. IPC-2152 specifically addresses conductor size, current and allowable temperature
rise; the existing IPC-2221 empirical equation is not an IPC-2152 implementation. [S1, S2]

IEC 60664-1:2020+AMD1:2025, edition 3.1, distinguishes clearance, creepage and solid insulation. Its
catalogued scope covers low-voltage equipment up to AC 1,000 V/DC 1,500 V and frequencies up to
30 kHz, with altitude guidance. A voltage-only table cannot select a complete insulation requirement.
Selection needs the applicable product standard, insulation function, working and impulse stresses,
pollution degree, material/CTI, altitude, frequency and qualified protection conditions. [S3, S6]

Coating/potting provisions and higher-frequency stresses have separate IEC 60664-3 and IEC 60664-4
scopes. Soldermask presence does not establish qualified insulation protection. Actual surface paths,
slots, edges, cross-layer insulation, assembled leads and tolerances need distinct models. No current
OpenPCB check establishes IEC compliance, manufactured safety, or complete IPC compliance. [S4, S5]

Fabricator capability is process-specific. Presets must retain source, date, copper/layer/process
applicability, and whether a limit is a minimum capability or a recommendation. Do not silently widen
a published minimum to unsupported board types or replace project-selected limits after refresh. [F1]

## Acceptance contracts for extensions

The dependencies below define implementation boundaries, not an alternative task tracker. Extend
the existing designer SDK/command/projection pipeline and shared rule engine; do not create a second
connectivity model for ERC or simulation. Keep future work and delivery status in Plane.

| Extension boundary | Required data and implementation seam | Acceptance examples |
| --- | --- | --- |
| Electrical intent | Versioned pin-bound NC and local source assertions; explicit sheet instances, unit instances, and package-pin identity. Add command parsers, inverse patches, persistence, projections, import mapping and UI together. | NC on a wired pin fails; a source assertion on one supply never joins another supply; two instances of a local `SIG` stay separate; save/reopen and undo preserve intent. |
| Configurable ERC | One documented electrical-type matrix plus whole-net rules, rule severity, stable object anchors and reasoned waivers. Reuse canonical nets. | Exhaust all pin-type pairs; distinguish push-pull contention from open-drain buses; require declared external supply intent rather than treating a connector as a power output. |
| Check coverage | Revision-owned reports with per-check assessed/unsupported/disabled/failed/stale status and explicit scope. Audit footprint exemptions, custom geometry and rule input parsing. | An unsupported pad or malformed rule cannot yield an unqualified clean result; unchanged reports become stale after relevant edits; waived issues remain auditable. |
| Electrical ratings | Typed component/pin operating and absolute-maximum ranges, logic thresholds, drive/load limits, operating modes and source provenance. | Check declared output/input voltage compatibility and known stress; missing ratings remain unassessed. Static checks must not guess switch-node waveforms or current sharing. |
| DFM and release | Process-scoped fab profiles, supported copper/mask/drill geometry, netlist/footprint consistency and final-artwork verification. | Golden 2/4/multilayer fixtures, slots, mask openings, thermals, keepouts and net ties; equivalent batch/live/export facts; explicit unsupported export refusal. |
| Circuit simulation | Library model metadata and pin mapping; deterministic netlist export from stable connectivity; isolated engine adapter and versioned run/results API. | Analytic resistor divider, RC step, RLC AC and diode operating point fixtures; convergence errors, cancellation and stale results are visible. |
| Physical analysis | Stackup/material model, via span, source-to-load topology, reference conductors and model validity ranges. | Validate propagation delay and impedance against independent references; separate return-path heuristics, DC drop, AC PDN, channel SI and thermal results. |

1. **Electrical identity and ERC:** use canonical connectivity and stable pin/pad anchors; retain
   sheet-instance scope and multi-unit identity. Separate physical attachment, signal driving, power
   sourcing, NC intent, and voltage-domain compatibility. A configurable pin matrix needs exhaustive
   pair cases plus whole-net cases such as open-drain buses, passive connectors and mixed sources.
2. **Rules and coverage:** reject malformed writes without erasing stored requirements; preserve
   unsupported newer data without interpreting it. Distinguish failed, waived, disabled, unsupported,
   incomplete and stale checks. Reports need applicable rule, objects, layer, measured/required
   values, witness geometry and design/rule revision. Waivers must retain reason and scope.
3. **Geometry and manufacturing:** batch, live and export paths must consume the same geometry and
   rule resolution. Prove indexed/exhaustive parity, pending-edit/replacement parity, threshold
   boundaries, rigid transforms, save/reopen behavior and final-artwork agreement. Explicitly mark
   checks that are batch-only; incomplete geometry must not silently count as assessed.
4. **Electrical ratings and insulation:** require declared operating modes, voltage/current ranges,
   reference domains and component ratings before checking compatibility or stress. Missing data
   produces unassessed coverage. Keep standards selection separate from geometric measurement;
   require reviewed primary standards and applicability before standards-backed claims.
5. **SPICE:** define model assignment, pin mapping, deterministic netlists, reference nodes, model
   provenance, result ownership and convergence failures before adding analyses. Validate OP/DC/AC/
   transient against analytic fixtures; then add noise, transfer, PZ, FFT, sweeps and seeded statistical
   runs. Persist engine/model versions, hashes, tolerances and initial conditions with results.
6. **Simulation execution:** ngspice supports shell commands and file operations. Imported models
   and directives are untrusted input. Use constrained workers, approved include roots, generated
   command allowlists, cancellation and resource limits; never blindly execute imported `.control`.
7. **High-speed, PI and thermal:** extend the junction graph with declared stackup/materials and
   explicit source-to-load paths. Validate impedance/delay models within their supported geometry;
   keep return-path heuristics separate from field-solver results. DC PI, AC PDN, channel SI and
   thermal solving are separate analyses with separate inputs and validation fixtures.

Altium's documented limits are useful acceptance examples: legacy SI ignores small DC path losses;
Keysight SI is a subscribed Open Beta; Keysight PI is PI-DC and its guide excludes power-plane-layer
heatmap simulation. Parameter sweeps/Monte Carlo exclude subcircuit data, and sensitivity cannot be
combined with those sweeps. ngspice 47 supports statistical control loops and sensitivity, but that
does not imply every frontend exposes them. Never infer analysis coverage from an engine name alone.

## Sources

- [K0: KiCad releases](https://www.kicad.org/blog/).
- [K1: KiCad 10 schematic/ERC/simulation manual](https://docs.kicad.org/10.0/en/eeschema/eeschema.html).
- [K2: KiCad 10 PCB/rule/tuning manual](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html).
- [K3: KiCad CLI, including ERC/DRC JSON, exclusions and exit codes](https://docs.kicad.org/10.0/en/cli/cli.html).
- [A1: Altium schematic connectivity and validation](https://www.altium.com/documentation/altium-designer/schematic/creating-circuit-connectivity).
- [A2: Altium PCB rule catalogue](https://www.altium.com/documentation/altium-designer/pcb/design-rule-types).
- [A3: Altium violation review and waivers](https://www.altium.com/documentation/altium-designer/pcb/drc/interrogating-resolving-design-violations).
- [A4: Altium stackup and impedance profiles](https://www.altium.com/documentation/altium-designer/pcb/defining-layer-stack).
- [A5: Altium high-speed rules](https://www.altium.com/documentation/altium-designer/pcb/design-rule-types/high-speed).
- [A6: Altium simulation analyses and limits](https://www.altium.com/documentation/altium-designer/circuit-simulation/configuring-running).
- [A7: Altium legacy SI](https://www.altium.com/documentation/altium-designer/analyzing-pcb/si-analysis/si-analyzer-altium/configuring-running).
- [A8: Altium SI Analyzer by Keysight](https://www.altium.com/documentation/altium-designer/analyzing-pcb/si-analysis/si-analyzer-keysight).
- [A9: Altium Power Analyzer by Keysight](https://www.altium.com/documentation/altium-designer/analyzing-pcb/pi-analysis/power-analyzer-keysight/quickstart-guide).
- [A10: Altium Ansys CoDesigner](https://www.altium.com/documentation/altium-designer/analyzing-pcb/ansys-codesigner).
- [A11: Altium testpoint rules](https://www.altium.com/documentation/altium-designer/pcb/design-rule-types/testpoint).
- [A12: Altium SMT rules](https://www.altium.com/documentation/altium-designer/pcb/design-rule-types/smt).
- [A13: Altium placement rules](https://www.altium.com/documentation/altium-designer/pcb/design-rule-types/placement).
- [A14: Altium simulation results](https://www.altium.com/documentation/altium-designer/circuit-simulation/results).
- [N1: ngspice releases](https://ngspice.sourceforge.io/news.html) and [version 47 manual](https://ngspice.sourceforge.io/docs/ngspice-47-manual.pdf).
- [S1: IPC-2221C scope](https://www.electronics.org/TOC/IPC-2221C-TOC.pdf).
- [S2: IPC-2152 scope](https://www.ipc.org/TOC/IPC-2152.pdf).
- [S3: IEC 60664-1 edition 3.1](https://webstore.iec.ch/en/publication/107319).
- [S4: IEC 60664-3](https://webstore.iec.ch/en/publication/26148); [S5: IEC 60664-4](https://webstore.iec.ch/en/publication/2804).
- [S6: Vishay clearance/creepage applicability guidance](https://www.vishay.com/doc/?28962=).
- [F1: JLCPCB copper/process-dependent rules](https://jlcpcb.com/help/article/jlcpcb-copper-weight).

## Initial audit batch validation

Executed on 2026-10-22 before the native-intent, duplicate, stored-rule and execution-evidence
extensions. These counts do not validate the later extensions:

| Check | Result |
| --- | --- |
| `npm run test:backend` | 3,412 passed, 0 failed, 2,994,984 assertions across 275 files. This includes real Node source-worker startup, failure, timeout and recovery probes. The initial run caught a missing SI helper emit-site registration; registration was corrected and the complete suite rerun. |
| `npm run test:react` | 917 passed, 1 existing todo, 0 failed across 114 files. The theme-only library test now isolates unused rendering imports, eliminating import-time Troika font fetches and teardown errors without suppressing errors or mocking the theme hook. |
| `npx --no-install tsc -b --pretty false` | Passed. The root composite includes backend, frontend and module types; it does not include Electron typechecking. |
| `npm run gen:check` | Passed; generated registry/SDK output clean and all 13 generated contract files current. |
| `npm run test:drc-worker-smoke` | Passed. The bundled Node worker reproduced the two-layer golden report byte for byte: 85 violations, 27,190 characters. |
| Focused electrical regressions | 93 backend tests passed across ERC, marker import, scoped scalars, SI validity and the DRC census; 17 frontend ERC store/scope/navigation tests passed. These overlap the full-suite totals and must not be added to them. |
| Browser checks | 6 passed, 1 existing Bundle skip across `pcb-drc.spec.ts`, `pcb-live-parity.spec.ts` and `pcb-routing.spec.ts`. Covers asynchronous batch completion and stale reports, commit refusal and explicit override, NPTH blocking, Route/Tune scope and rapid pointer release. The rapid-release regression failed on the original guarded pointer-up and passed after correction without diagnostic instrumentation. |
| `git diff --check` | Passed. |

Browser validation uses installed Google Chrome with isolated temporary profiles and a separate
`/tmp` application database. The stock watch-mode launcher hit `EMFILE`; the temporary test config
starts Node without watch mode and enables Vite polling. Playwright's pinned browser was absent;
Chrome required execution outside the filesystem sandbox. These checks are browser validation,
not packaged Electron or fabrication qualification. Neither KiCad CLI nor ngspice was installed;
vendor comparisons are documentation research, not cross-tool runtime parity results. Manufacturing
and project-import quarantine remain enabled by default. No standard's licensed full text was
validated, and no compliance claim is made.

## Native intent, rule-input and report validation

Executed on 2026-10-22 after the extensions described above, before durable net-identity work:

| Check | Result |
| --- | --- |
| `npm run test:backend` | 3,591 passed, 0 failed, 2,996,505 assertions across 283 files. The preceding run found the expected catalog drift from migration `0021_pin_electrical_intent.sql`; review confirmed only the added column, migration entry and digest changed. The complete suite then passed. |
| `npm run test:react` | 971 passed, 1 existing todo across 123 files. The UI discipline check caught a native select in the new pin editor; it now uses the shared `Select` primitive, with no baseline exemption. |
| `npx --no-install tsc -b --pretty false` | Passed after correcting test-only literal inference and future-code comparisons. |
| `npm run gen:check` | Passed. No generated contract drift. |
| `npm run test:drc-worker-smoke` | Passed: 85 violations, 28,385 characters, byte-identical bundled-worker and in-thread reports, including execution evidence. |
| Focused backend checks | 203 passed across nine files, including the assistant native adapter outside the core backend suite. After test type corrections, both evidence suites passed again: 64 tests. These totals overlap the complete suite. |
| Browser checks | Seven relevant cases passed across DRC, live parity, routing and native pin intent; one existing Bundle case remains skipped. The first run passed six cases and failed an outdated stale-banner text assertion; the captured UI showed the correct stale state. The corrected DRC case then passed. Pin intent covers inspector edits, ERC, undo/redo, reopen, markers, stable geometry and native Duplicate. |
| `git diff --check` | Passed. |

An initial validation attempt was blocked by system-wide `ENFILE`, with 184,270 of 184,320 file
descriptors in use. After the old watchers exited, the count fell to 8,129 and the checks above ran
successfully. No signal was sent to the approved watcher PID; it had already exited. Browser and
standards limitations from the initial audit still apply; these checks do not qualify packaged
Electron, manufacturing output or electrical standards compliance.

## Durable identity foundation validation

The H08 foundation was independently reviewed and checked on 2026-10-22. These checks cover the
pure kernel, reference transformations and storage contracts. They do not establish that migration,
command/history integration, repair UI or export blocking is wired into the application.

- The successor kernel passed 50 tests and 6,156 assertions, including 200 seeded permutations,
  explicit-name priority, deterministic split/merge inheritance and allocation safeguards. Its
  focused strict TypeScript check passed.
- Storage and design deletion passed 42 tests and 188 assertions. Reads reject malformed state
  without rewriting raw rows; counters respect active and retired watermarks; backup replacement
  and design deletion roll back atomically. Migration `0022_net_identity.sql` adds four tables
  without initializing existing designs.
- Reference enumeration and rewriting passed 17 tests and 106 assertions. Unchanged malformed
  declarations remain unchanged; clearing a net scope cannot create a global rule; assignment
  collisions are deterministic; clearing a zone disables it.
- The legacy-fixture capture scripts passed an independent strict TypeScript check. Four frozen
  fixtures preserve raw schematic, PCB and history rows, including pin electrical intent. Their
  checksums cover exact payload bytes; source hashes record the capture boundary and must not be
  compared with later implementation files.

Migration evidence review reproduced concrete counterexamples against the frozen pour-only GND
fixture. A keepout isolates one of four vias; a board-spanning keepout leaves two vias on an island
without a schematic pad; `padConnection: none` disconnects all four vias from the pads. Each case
can still have a geometrically overlapping or `attached` pour. In addition, DRC's deliberate
invalid-layer clamping can give an invalid via a false positive contact. Positive migration proof
must therefore use fail-safe connectivity and a successful filled component reaching an independent
schematic pad. Region overlap, an island's `attached` flag, and DRC short-tier proximity are not
sufficient proof.

The next independent checks covered the binder and migration prerequisites:

- Binder, frozen derivation parity, kernel, reference, net-label and ERC suites passed 183 tests
  and 6,723 assertions across 11 files. All four frozen legacy derivations remain byte-identical.
  Backend TypeScript passed. These totals overlap the foundation checks above.
- Contact and pour evidence passed 21 tests and 53 assertions. The four-via fixture proves 4,
  3, 2 or 0 vias as the relevant keepout and connection policy changes. Invalid geometry,
  duplicate payload IDs, unplated mechanical pads, conflicting sources and near-only contact
  cannot supply positive identity proof.
- Logical backup and restore passed 24 tests and 135 assertions. Captures match all four frozen
  payload hashes. Restore preserves raw schematic, PCB and history rows, including unknown pin
  intent and opaque JSON; confirmation and transaction rollback are exercised. Revision and
  lifetime identity counters remain monotonic, and prior identities remain in the retirement
  ledger so re-migration cannot recycle them.
- The current public catalog passed 2 tests and 55 assertions after review of the four added
  identity tables, retirement index and migration entry. Historical catalogs are unchanged.

Additional independent migration-prerequisite checks passed:

- Classification: 32 tests and 161 assertions, covering contact/root disagreement, shorted
  islands, rule-side stale roots, explicit names and legacy automatic-name hints.
- Allocation reservation: 16 tests and 32 assertions. Exact own-design durable IDs in raw
  references, object keys and opaque JSON reserve their sequence before migration allocation.
- Source adapters, collision planning, raw settings rewrites, frozen derivation parity, legacy
  fill migration and settings serialization: 104 tests and 422 assertions across six files.
  Changed references require exact stored-field matches; unrelated malformed values and unknown
  rule-scope metadata survive. Assignment and differential-pair collisions reach a deterministic
  fixed point before any rewrite. Backend TypeScript and `git diff --check` passed.

The atomic migration coordinator and runtime prerequisites also passed independent review:

- Identity, derivation and kernel suites passed 374 tests and 7,887 assertions across 18 files.
  This includes 55 migration tests covering all eight injected failure stages, malformed source
  refusal, raw preservation and quarantine collisions. These totals overlap earlier checks.
- A production Node `better-sqlite3` smoke test migrated all four frozen fixtures reproducibly,
  restored and re-migrated each with increasing allocation counters, and verified exact rollback
  at all eight fault stages against the stale-reference fixture.
- Census, events, result parsing and receipt regressions passed 37 tests and 370 assertions.
- Cloud preservation guards passed 43 backend tests and 26 frontend tests. Identity state and
  allocation history block writes to the current incompatible cloud protocol; legacy imports
  create unlinked copies. This validates local behavior, not a deployed cloud service.
- Bulk placement move and transaction regressions passed 12 tests and 71 assertions. Every
  placement is validated before any movement, so a late missing ID cannot commit partial edits.
- The root composite TypeScript build and whitespace checks passed before runtime integration.

Runtime integration has now passed independent review and targeted checks:

- Store dispatch, history, receipts and PCB transaction regressions passed 39 tests and 248
  assertions across six files. Native initialization and read-time migration are connected;
  dispatch sync shares the command transaction. Undo/redo restores exact active records while
  allocation counters and retirement history remain monotonic. Cross-session replay resolves
  contested ownership against the prior database and counts dependents from the patched PCB.
- Ensure and cloud suites passed 85 tests and 359 assertions across five files. Corrupt stored
  ownership is refused without changing raw evidence; cloud link and snapshot guards run after
  initialization/migration and before network writes. These totals overlap earlier checks.
- Pure command-boundary validation and result parsing passed 64 tests and 398 assertions.
  New references must resolve to active IDs; unchanged stale rule declarations remain editable.
  Re-enabling a disabled zone also validates its effective stored reference.

- Boundary runtime integration, identity runtime/history and corrected duplicate-part, board-fill
  and copper-gate fixtures passed 115 tests and 681 assertions across seven files. Batch and
  auto-layout failures roll back before writes; name hints bind once and idempotent retries retain
  their original command envelopes.
- Import reference helpers and zone/ERC fixtures passed 40 tests and 194 assertions across three
  files. Exact named matches bind; unresolved hints retain immutable provenance. Database and
  world ERC diagnostics use the same identity anchors in both durable and legacy modes.
- The read-only identity summary passed 40 tests and 82 assertions. Retirement chains, cycles,
  exact quarantine provenance, disabled zones, rule references and corrupt metadata are covered.
- Review reproduced a structural-validation precedence bug: malformed SI members were diagnosed
  as dangling references. The boundary now defers malformed SI declarations to the existing strict
  validator. Boundary and SI authoring suites passed 61 tests and 1,175 assertions across two files.

Import, orphan reporting and export refusal have now passed their integration gates:

- Import integration passed 51 tests and 267 assertions across four files. Durable identity is
  initialized before references are committed, board settings are written once, unresolved hints
  retain quarantine provenance, and named ordinal zero is rejected before library writes.
- Orphan DRC passed 63 tests and 956 assertions across three files, including malformed rule
  scopes. Export and summary checks passed 67 tests and 219 assertions; HTTP problem responses
  preserve numeric status 422 and use a separate `identityStatus` field.
- Review reproduced a prototype-key lookup crash. DRC names and class assignments now distinguish
  own entries from inherited properties without changing intentional net-class policy.
- The full backend suite passed 4,261 tests with zero failures and 3,002,340 assertions across
  319 files. The full frontend suite passed 991 tests with one existing todo across 123 files.
  The root composite TypeScript build and whitespace checks passed.
- The built Node DRC worker matched the Bun reference exactly on the census fixture: 105
  violations and 35,217 serialized characters. All 85 prior census violations remained unchanged;
  the 20 additions are orphaned copper anchors already present in the source fixture.

These checks overlap; their counts must not be added together. The worker check exercises the built
Node bundle, not a packaged Electron user session. They do not establish manufacturing or standards
qualification. The global manufacturing and project-import quarantines remain enabled.

The repair prerequisites and independent interface changes have also passed root review:

- Recovery/status routes passed 21 HTTP tests and 61 assertions. Status reads are byte-preserving;
  explicit retry retains the allocation watermark. Restore rejects unconfirmed later edits with
  409, rejects invalid provenance or backups with 422, and does not implicitly re-migrate.
- Raw repair planning passed 62 tests and 156 assertions. The planner covers every reference site,
  exact unresolved hints, assignment collisions, disabled zones, malformed and ambiguous inputs,
  sparse bindings, numeric overflow, and a 150,000-entry stored reference array.
- Raw history operations passed 54 tests and 300 assertions. All changes are preflighted before
  writes; unrelated geometry and metadata survive inversion. Review replaced quadratic payload
  scans with one index. Carrier validation passed another 33 tests and 121 assertions, including
  wrong design ownership, reserved-component misuse and accessors that must never execute.
- Net selector checks passed 50 frontend tests across four suites. New picks persist IDs; inactive
  IDs remain visible and never silently bind through a matching display name.
- Session activity and coordinator checks passed 30 frontend tests across three suites. All net
  changes are recorded; only dependent changes warn. Entries and retry deduplication are bounded
  to the retained 200-entry window. Observer failures cannot reject an acknowledged command.

Repair dispatch and persisted replay subsequently passed their integration gates:

- Seven runtime, HTTP, history and result suites passed 66 tests and 468 assertions. Repair uses
  the raw reference carrier, preserves unknown metadata, excludes batch execution, and replays
  exact public receipts idempotently. Same-field or affected-section conflicts return 409 without
  consuming history or changing any row. Reboot, other-session geometry/view edits, retired-target
  redo and injected storage failures are covered.
- Review reproduced precision loss in an opaque JSON number: `9007199254740993` became
  `9007199254740992`. Planner and replay now reject decimal values that cannot survive JSON
  parsing and serialization unchanged. The corrected planner, raw history, carrier and integration
  gate passed 229 tests and 828 assertions across seven files. Exact large integers and equivalent
  decimal/exponent forms remain accepted; numbers inside strings are not interpreted.
- Capture classification passed 20 tests and 105 assertions across three suites. Trace/via repair
  carriers count as modifications in either history direction; malformed carriers fail closed.
- Root composite TypeScript checking caught a missing repair exclusion in the frontend batch
  helper. The exclusion was added and the composite check passed before the subsequent UI and
  merge-gate changes.
- Merge guards passed 46 backend tests and 379 assertions across four suites, plus 26 frontend
  coordinator/workspace tests. All 14 command policies and ten added HTTP fields are covered.
  Real placement, duplicate placement, drag and primitive-text merges require consent; refusal
  preserves all designer tables. Geometry protects named nets, naming retains anonymous multipin
  protection, and confirmed batch retries put consent on individual steps.
- Differential-pair and DRC label consumers passed 20 frontend tests. A non-null inactive ID never
  falls back through its old name; current own name-map entries remain authoritative.

These counts overlap earlier gates.

### Identity repair interface and final working-tree gates

The completed DRC identity panel exposes migration/restore, exact unresolved reference groups,
manual and suggested ID binding, guarded bulk repair, receipts, scoped activity and the unread
toolbar badge. Review added explicit recovery from a failed PCB read and invalidation of pending
restore confirmations after a keyed design/backend unmount. Acknowledged mutations retain their
receipt when observation fails; retry reads rather than repeating the write. Workspace history
refresh remains best-effort, as documented in the [identity contract](../designer/net-identity.md).

The root ran the following checks on the final code after the UI kit selector correction:

| Check | Result |
| --- | --- |
| Full backend suite, `npm run test:backend` | 4,662 passed, 0 failed, 334 files. |
| Full frontend suite, `npx --no-install vitest run --config src/core/frontend/vitest.config.ts` | 1,081 passed, 1 existing todo, 132 files. |
| Composite TypeScript, `npx --no-install tsc -b --pretty false` | Passed. The first run caught an old `ProblemDetails` type name in the export error path; it was corrected. |
| `npm run gen:check` and `npm run gen:contracts -- --check` | Passed; 13 generated contract files are current. |
| Native identity/property/reopen regressions | 104 passed, 16,592 assertions. Includes 100 seeds, 2,500 accepted store steps, 200 reopens and 500 binder permutation checks. These tests are included in the full backend count. |
| Focused panel/API/model/activity/workspace/report checks | 73 passed across nine files before the final UI-kit-only correction; the full frontend gate covers the corrected selector and UI discipline ratchet. |
| Native Node HTTP repair and restart smoke | Passed on a disposable SQLite database: actual drawn component import, stable routed identity after schematic movement, atomic merge refusal, confirmed merge, orphan DRC, explicit repair receipt, PCB-session Undo/Redo, process restart, and persisted Undo/Redo. |

The property checks distinguish logical identity from routing: schematic poses and re-annotation
preserve the full fixture verdict; moving a PCB placement can create an airwire while preserving
stored identity references. Lone-pin promotion from `nc:` to a durable named net explicitly leaves
old copper unresolved and provides the current pin owner's suggestion. No property test assumes
that placement movement preserves physical connectivity or that every projected net is durable.

The automated browser specification `tests/e2e/pcb-net-identity.spec.ts` is authored and collected,
but its Playwright gate remains open. Launch failed before executing test actions because
`chromium_headless_shell-1223` was absent. Download attempts, including the requested retry, failed
with `getaddrinfo ENOTFOUND cdn.playwright.dev`; fresh installed-Chrome processes aborted with
`SIGABRT`. Test discovery and focused TypeScript checking passed. This is not an automated E2E pass.

On the retry, the root completed the browser workflow through native computer use in the existing
Chrome process, with API readback after each state change:

- A real canvas drag moved the first part from Y = 0 to -5.08 mm. Net IDs, raw trace geometry,
  class/length/scoped-rule references and the full ratsnest remained unchanged after reload.
- Renaming `ROUTED` to `MAIN` displayed the merge confirmation while revision and stored data stayed
  unchanged. Confirming produced the warning toast and one unread net-change badge. Opening DRC
  cleared that badge and showed the retired source, one copper reference, three inert rule
  references and the exact active successor suggestion.
- A real UI DRC run reported orphaned copper. Accepting the panel suggestion displayed a receipt
  for one trace, one class assignment, one length group and one scoped rule. Readback verified all
  four reference sites changed together while trace identity and geometry stayed unchanged.
- PCB toolbar Undo restored the original references and orphan diagnostic; Redo restored repair.
  Neither operation produced an identity-change warning. A new UI DRC run removed the orphan,
  short and dangling findings; the remaining unrouted-net finding was retained correctly.
- Reload and explicit reopen retained the repaired state at revision 22. The full DRC view showed
  zero unresolved copper and inert rule references, with the remaining routing finding visible.

This manual run exposed an incorrect draft-test assumption: browser reload returns to the Designs
list rather than reopening the editor. Both test reload paths now explicitly reopen the exact
fixture, and the final path selects PCB before checking its toolbar. The automated pixel locator
explicitly requests the light theme whose terminal color it recognizes. No production code changed
during this retry. Manual browser evidence does not establish that the Playwright specification
passes. Packaged Electron and manufacturing qualification were not run; both capability quarantines
remain unchanged.
