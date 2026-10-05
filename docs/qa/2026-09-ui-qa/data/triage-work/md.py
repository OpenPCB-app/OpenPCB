import json, re, collections

QA = "/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/f18aac79-e8af-4eed-b528-c505e87cbf8a/scratchpad/qa"
E = json.load(open(f"{QA}/triage/triage.json"))
RAW = {x["id"]: x for x in json.load(open(f"{QA}/triage/work/all.json"))}
KNOWN_TXT = {}
for line in open(f"{QA}/known-findings.md"):
    m = re.match(r"- (K\d\d|N\d) (.*)", line.strip())
    if m:
        KNOWN_TXT[m.group(1)] = m.group(2)
KNOWN_TXT["spike"] = "PCB toolbar DRC count differs from dock tab / status bar"

tid_of_id = {i: e["tid"] for e in E for i in e["ids"]}
SEV = ["S1", "S2", "S3", "S4"]
live = [e for e in E if e["status"] not in ("rejected", "refuted")]


def esc(s):
    return (s or "").replace("|", "\\|").replace("\n", " ")


def tr(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def by_dec(d):
    return [e for e in E if e.get("decision") == d]


def tids(lst):
    return ", ".join(e["tid"] for e in lst)


out = []
w = out.append
w("# OpenPCB UI QA — Triage (product-owner view)")
w("")
w("Generated 2026-09-25 from 18 verified QA charters (q1–q11, f1a–f1d, f2a–f2c). Machine-readable: `triage/triage.json` (one entry per root cause, `approved: null` until you decide).")
w("")
w("**Legend.** Sev S1 crash/data loss/core flow blocked · S2 broken w/ workaround · S3 inconsistency/a11y/copy · S4 polish. "
  "Rec: fix-now / defer / decide (needs your call) / wont-fix. Scope: frontend / backend / shared-package (`@openpcb/*`, follow-up only) / decision / proposal. "
  "Waves: F0a kit+tokens → F0b app wiring → G grid → W2 (C1 Home/Shell, C2 Settings, D1–D4 Designer, L1 Library browse, K1 Docs+Tasks) → W3 (L2–L4b part wizard/editors, A1–A3 Assistant) → W4 sweep/e2e. "
  "_Assumption: W2/W3 split as listed; entries with owner `X+Y` touch two owners' files — the first owner leads._")
w("")

# ---- (a) summary
raw_sev = collections.Counter(x["severity"] for x in RAW.values())
raw_status = collections.Counter(x["status"] for x in RAW.values())
w("## (a) Summary")
w("")
w(f"- **Raw findings:** {len(RAW)} — confirmed {raw_status['confirmed']} (2 partially), duplicates {raw_status['duplicate']} (merged), rejected {raw_status['rejected']}. Raw severity: "
  + " · ".join(f"{s} {raw_sev[s]}" for s in SEV) + ".")
rec = collections.Counter(e["recommendation"] for e in E)
w(f"- **Triage entries:** {len(E)} root causes ({len(live)} live + {len(E)-len(live)} rejected/refuted). Recommendation: "
  + " · ".join(f"{k} {rec[k]}" for k in ["fix-now", "decide", "defer", "wont-fix"]) + ".")
wave = collections.Counter(e["wave"] for e in live)
w("- **By wave (live):** " + " · ".join(f"{k} {wave[k]}" for k in ["F0a", "F0b", "G", "W2", "W3", "W4", "followup", "proposal"]) + ".")
scope = collections.Counter(e["scope"] for e in live)
w("- **By scope (live):** " + " · ".join(f"{k} {v}" for k, v in scope.most_common()) + ".")
w("")
w("### Severity × area (live entries)")
w("")
areas = []
for e in live:
    if e["area"] not in areas:
        areas.append(e["area"])
w("| Area | S1 | S2 | S3 | S4 | Total | fix-now | decide | defer |")
w("|---|---|---|---|---|---|---|---|---|")
tot = collections.Counter()
for a in areas:
    es = [e for e in live if e["area"] == a]
    c = collections.Counter(e["severity"] for e in es)
    r = collections.Counter(e["recommendation"] for e in es)
    tot.update(c)
    w(f"| {a} | {c['S1'] or ''} | {c['S2'] or ''} | {c['S3'] or ''} | {c['S4'] or ''} | {len(es)} | {r['fix-now']} | {r['decide'] or ''} | {r['defer'] or ''} |")
w(f"| **Total** | **{tot['S1']}** | **{tot['S2']}** | **{tot['S3']}** | **{tot['S4']}** | **{len(live)}** | | | |")
w("")
w("### All S1 (release blockers)")
w("")
w("| TID | Finding ids | Title | Owner | Wave | Rec | Evidence |")
w("|---|---|---|---|---|---|---|")
for e in live:
    if e["severity"] == "S1":
        w(f"| {e['tid']} | {', '.join(e['ids'])} | {esc(tr(e['title'], 110))} | {e['owner']} | {e['wave']} | **{e['recommendation']}** | {esc(tr(e['evidence'][0], 110)) if e['evidence'] else '—'} |")
w("")
s1_fix = [e for e in live if e["severity"] == "S1" and e["recommendation"] == "fix-now"]
s1_dec = [e for e in live if e["severity"] == "S1" and e["recommendation"] != "fix-now"]
w(f"{len(s1_fix)} S1s are frontend fix-now in this run; {len(s1_dec)} need a decision because the root cause is backend or inside an `@openpcb/*` package ({tids(s1_dec)}) — see (d) DEC-PKG / DEC-PCB3 / DEC-SCH / DEC-IMP.")
w("")
w("### Workload by owner (live, fix-now + decide)")
w("")
w("| Owner | Wave | Entries | S1 | S2 | S3 | S4 | XS | S | M | L |")
w("|---|---|---|---|---|---|---|---|---|---|---|")
own = collections.OrderedDict()
order = ["F0a", "F0b", "G", "C1", "C2", "D1", "D2", "D3", "D4", "L1", "K1", "L2", "L3", "L4a", "L4b", "A1", "A2", "A3", "W4"]
for o in order:
    es = [e for e in live if e["owner"].split("+")[0] == o and e["recommendation"] in ("fix-now", "decide")]
    c = collections.Counter(e["severity"] for e in es)
    est = collections.Counter(e["estimate"] for e in es)
    wv = es[0]["wave"] if es else ""
    w(f"| {o} | {wv} | {len(es)} | {c['S1'] or ''} | {c['S2'] or ''} | {c['S3'] or ''} | {c['S4'] or ''} | {est['XS'] or ''} | {est['S'] or ''} | {est['M'] or ''} | {est['L'] or ''} |")
w("")
w("Note: D3 (PCB + DRC + rules/export dialogs) is the largest bucket — consider splitting it into D3a canvas/toolbar/layers/inspector and D3b DRC view + rules/export/outline dialogs (disjoint files) to keep W2 balanced.")
w("")

# ---- (b) known findings
w("## (b) Known findings (code recon K01–K45, N1, N2, spike)")
w("")
w("| Ref | Status | TIDs | Known claim | Note |")
w("|---|---|---|---|---|")
refs = [f"K{i:02d}" for i in range(1, 46)] + ["N1", "N2", "spike"]
from build_notes import KSTAT, KNOTE  # noqa
for r in refs:
    ts = [e["tid"] for e in E if e.get("knownRef") and r in e["knownRef"].split(",")]
    w(f"| {r} | {KSTAT.get(r, 'confirmed')} | {', '.join(ts)} | {esc(tr(KNOWN_TXT.get(r, ''), 110))} | {esc(KNOTE.get(r, ''))} |")
w("")
kc = collections.Counter(KSTAT.get(r, "confirmed") for r in refs)
w("Totals: " + " · ".join(f"{k} {v}" for k, v in kc.items()) + ". Every known finding was exercised by at least one charter (none left untested); single-charter 'untested' marks (K10 in q3, K12 in f2a, N1 in f2a) were confirmed by other charters.")
w("")

# ---- (c) per-area tables
w("## (c) Triage by area")
w("")
for a in areas:
    es = [e for e in live if e["area"] == a]
    w(f"### {a} ({len(es)})")
    w("")
    w("| TID | Sev | Title | Evidence | Proposed fix | Scope | Est | Owner | Wave | Rec |")
    w("|---|---|---|---|---|---|---|---|---|---|")
    for e in es:
        ev = esc(tr(e["evidence"][0], 110)) if e["evidence"] else "—"
        ids = ",".join(e["ids"]) if e["ids"] else "derived"
        kr = f" [{e['knownRef']}]" if e.get("knownRef") else ""
        recs = e["recommendation"] + (f" ({e['decision']})" if e.get("decision") and e["recommendation"] == "decide" else "")
        w(f"| {e['tid']} | {e['severity']} | {esc(tr(e['title'], 100))} <sub>{ids}{kr}</sub> | {ev} | {esc(tr(e['shortFix'], 150))} | {e['scope']} | {e['estimate']} | {e['owner']} | {e['wave']} | {recs} |")
    w("")

# ---- (d) decisions
DEC = [
    ("DEC-PKG", "Three S1s live in `@openpcb/*` packages / CoreLibrary data (no edits allowed here). Approve the in-app mitigations and schedule package releases?",
     "Yes: (1) F0b ships an offline font mitigation so canvases never render black (bundle font + troika config in main.tsx); (2) L4a hides the broken SOT / QFN-EP IPC presets until `@openpcb/rendering-core` is fixed; (3) treat Y-down KiCad footprints as a **release blocker** — dedicated session to fix `@openpcb/kicad-import`, regenerate the CoreLibrary pack and migrate existing libraries/designs."),
    ("DEC-PCB3", "Designer-backend fixes outside the approved list: refdes rename never reaches PCB (S1), copper bound to ephemeral net ids (S1, L), new parts stacked in 24 centre slots, exports named by UUID. Approve which?",
     "Approve refdes propagation (S) and design-name export naming (XS) in this run. Move stable net identity (L, touches the connectivity contract) and new-part placement to a dedicated backend/hardening session."),
    ("DEC-SCH", "Schematic backend: multi-unit ICs stack all units on one origin (S1), net-label tool cannot connect, multi-delete = N undo steps. Approve?",
     "Approve composite command (one undo entry, M) and label↔wire/same-name net merge (M). Multi-unit support needs a unit model → dedicated session; interim: frontend warning when placing a multi-unit part."),
    ("DEC-IMP", "KiCad project import correctness is backend + `@openpcb/kicad-import`: rotated parts get pads swapped + Y-mirror (S1), 78 % of copper without nets (S1), rules/inner layers/board graphics wrong, inspect returns 500 for bad files. Fix in this UI run?",
     "No — dedicated import-correctness session. In this run: approve only the XS inspect 400/422 change; frontend surfaces commit warnings (Q5-019) and fixes wizard copy (Q5-021)."),
    ("DEC-B", "BOM semantics + backend: tier labels claim 'verified' MPNs (nothing is verified), writer merges different parts sharing a footprint, BOM edits invisible in part inspector. Approve?",
     "Approve relabel to two honest tiers 'Has MPN' / 'Missing' (frontend). Approve writer grouping + Comment fallback (backend S). Defer single-source-of-truth for sourcing/DNP (M)."),
    ("DEC-L", "Library backend beyond approved paging: third-party pack hijacks core ids, missing kind installs as undeletable core, silent downgrade, facet/list predicate mismatch, provenance lost, Duplicate incomplete/locked, ZIP import reuses other part's footprint, re-import duplicates, wrong auto tags, Local Library removable, 3D model destroyed before re-upload. Approve which?",
     "Approve alongside paging (same `queries.ts`): facet/list single predicate, user.local delete guard, default kind≠core, clone fix (Duplicate). Defer the rest to a library-backend session."),
    ("DEC-A", "Assistant: Settings 'Tool policy: confirm writes' is not enforced; plus backend items (provider error swallowed, no provider timeout, wrong refdes in replies, glued multi-step text, duplicate tool rows, mention parser rejects dotted ids, prompt forces dark Mermaid palette).",
     "Policy: change Settings copy to match actual behaviour ('Edits apply immediately (undoable); deletions ask first') — no policy engine now. Approve XS backend: mention regex, prompt Mermaid palette, single tool-event row. Defer provider error/timeout, refdes, iteration text to an assistant-backend session."),
    ("DEC-K", "Docs page tree order is scrambled (backend sorts base62 order keys with localeCompare). Approve XS backend fix?", "Yes — breaks navigation; one-line compare change."),
    ("DEC-C", "Auto Layout offline says 'service does not support Auto Layout' (backend swallows fetch errors). Approve XS backend change to report 'unreachable' (graceful offline is in scope)?", "Yes; optional shared cloud-fetch helper returning a `cloud-unreachable` problem type (pairs with problem.ts)."),
    ("DEC-S1", "API keys are stored plaintext in SQLite while Settings says 'encrypted locally'. Fix copy or encrypt?", "Fix the copy now (C2). Real encryption via Electron safeStorage as a backend follow-up."),
    ("DEC-S2", "Privacy panel claims design data never leaves the computer (contradicted by BYOK providers + MCP). Approve rewrite?", "Yes: 'Design data leaves this computer only via AI providers you configure, the MCP server (if enabled) and crash reporting (below).'"),
    ("DEC-PCB1", "Layer visibility / active layer / view clicks are undoable document edits (bump revision, mark DRC stale, silent undo no-ops). Make them view state?", "Yes — per-design view state in the frontend (localStorage); backend command untouched."),
    ("DEC-PCB2", "Deleting a schematic-backed footprint on PCB silently re-spawns it at an overlapping auto position. Block or propagate?", "Block delete on PCB with notice 'Delete R3 in the schematic' (frontend only)."),
    ("P1", "PCB canvas jumps 14 px whenever the Route/Tune parameter row or a notice row appears (D5/D10 layout). Reserve a fixed row or overlay?", "Reserve one fixed 28 px tool row in PCB view (idle: tool hint), notices as canvas overlays — canvas never resizes mid-gesture."),
]
w("## (d) Decisions needed")
w("")
w("| ID | Question | Recommended default | TIDs |")
w("|---|---|---|---|")
for d, q, dflt in DEC:
    ts = tids(by_dec(d))
    w(f"| **{d}** | {esc(q)} | {esc(dflt)} | {ts} |")
w("")
w("Out-of-scope by your earlier decision (listed, not asked): ERC false-green (Q3-014), DRC rule keys in messages (Q4-044), core footprints failing JLCPCB silk (F1B-009), route micro-segments (F2A-009) → `followup` for the hardening program. Dev-flag-only cloud items (Q10-008/009/010) deferred until those flags graduate.")
w("")

# ---- (e) proposals
PROPS = [
    ("P1", "Fixed PCB tool row (no canvas resize)", ["F2A-020", "Q4-004", "F1B-033"], "Reserve a permanent 28 px row under the PCB toolbar for route/tune parameters and tool hints; move notices into canvas overlays."),
    ("P2", "Narrow-window (1100×720) responsive layout", ["Q4-041", "Q10-017", "Q1-005", "F1B-028", "Q7-026", "F2B-009"], "Below ~1280 px auto-collapse the right dock / left panel, Library facet rail / preview pane and Home preview column; area entries only do minmax column fixes."),
    ("P3", "Cloud layout actions in the PCB toolbar", ["Q10-014"], "'Layout ▾' toolbar dropdown (Auto Layout…, Route board…, Auto place…) with kit dialogs instead of floating canvas buttons/panels."),
    ("P4", "Trace/via inspector", ["F2B-011"], "Net, width, layer span, via type (blind/buried) in PCB Properties; needs backend edit commands."),
    ("P5", "Net-class management", ["F1B-007"], "Add/rename/delete net classes with per-class via size in Design rules."),
    ("P6", "Part wizard structure", ["Q7-030", "Q7-035", "Q7-036", "Q7-017"], "Metadata fields (value/MPN/manufacturer/datasheet, backend), 3D model preview + orientation in Model step, harmonised step layouts, pin↔pad mapping table."),
]
w("## (e) Structural / layout proposals (not built without approval)")
w("")
w("| ID | Proposal | What | Findings → TIDs | Evidence |")
w("|---|---|---|---|---|")
for pid, name, ids, what in PROPS:
    ts = sorted({tid_of_id[i] for i in ids})
    shot = next((s for i in ids for s in (RAW[i].get("evidence", {}).get("screenshots") or [])[:1]), "")
    w(f"| **{pid}** | {name} | {esc(what)} | {', '.join(ids)} → {', '.join(ts)} | {shot} |")
w("")

# ---- (f) rejected
w("## (f) Rejected findings")
w("")
w("| ID | Title | Reason |")
w("|---|---|---|")
for x in RAW.values():
    if x["status"] == "rejected":
        w(f"| {x['id']} | {esc(tr(x['title'], 90))} | {esc(tr(x['verification']['reason'], 260))} |")
w("| K27 (known) | 3D Snapshot button has no accessible label | Refuted: button name 'Snapshot' comes from its visible text. |")
w("")
w("Duplicates merged by verifiers (kept inside the target entry):")
w("")
w("| Duplicate | → TID | Merged with |")
w("|---|---|---|")
for x in RAW.values():
    if x["status"] == "duplicate":
        t = tid_of_id[x["id"]]
        others = [i for e in E if e["tid"] == t for i in e["ids"] if i != x["id"]]
        w(f"| {x['id']} | {t} | {', '.join(others) or 'own entry (backend naming split out of Q4-024/Q5-010)'} |")
w("")

# ---- (g) shared-package follow-ups
PKG = [
    ("Q7-022", "@openpcb/kicad-import + CoreLibrary pack", "Y-down footprints → mirrored land patterns in PCB/Gerber (S1)", "none possible in-app; release blocker"),
    ("Q10-001", "@openpcb/r3f-eda-canvas (EDAText / troika)", "Canvas text fonts fetched from cdn.jsdelivr.net → black canvases offline (S1)", "F0b: bundle font + troika config"),
    ("Q7-013", "@openpcb/rendering-core (ipc7351b family-presets)", "Wrong SOT pad counts/layouts; QFN EP shorts signal pads (S1)", "L4a: hide affected presets"),
    ("F2A-016", "@openpcb/rendering-core (symbol-preview-builder)", "KiCad '~{}' markup literal, pin names overprint, labels inside bodies, fit ignores text", "—"),
    ("Q7-003", "@openpcb/r3f-eda-canvas (symbol-render-layer)", "No unit/body-style filtering for multi-unit symbols", "L3/L1 filter units before render"),
    ("Q3-030", "@openpcb/r3f-eda-canvas (canvasTheme)", "Canvas palette violet/amber selection, not neutral tokens", "—"),
    ("F1B-025", "@openpcb/r3f-eda-canvas (layers.js)", "Solder-mask swatches = drill black; In1 amber ≈ outline", "—"),
    ("F2B-016", "@openpcb/r3f-eda-canvas (footprint-render-layer)", "Pad numbers upside-down on 180° parts", "—"),
    ("F2A-012", "@openpcb/r3f-eda-canvas (EDAText)", "3D refdes not depth-tested (shows through board)", "—"),
    ("Q3-024", "@openpcb/r3f-eda-canvas (use-eda-camera)", "Wheel zoom down to 1 % vs button floor 10 %", "D2 may pass min zoom if supported"),
    ("Q7-002", "@openpcb/r3f-eda-canvas (GridShader)", "uPixelsPerUnit stuck → wizard/preview grids never render", "—"),
    ("Q6-012", "@openpcb/r3f-eda-canvas (PreviewCanvasShell)", "Overlay relies on host Tailwind classes that aren't generated", "F0a: @source for package dist"),
    ("Q6-029", "@openpcb/r3f-eda-canvas (FootprintPreviewCanvas)", "Hidden F.Fab labels included in fit bounds", "L1: pass fitToGeometryOnly"),
    ("Q6-036", "@openpcb/step-to-glb", "~200 GLTFExporter warnings per STEP conversion", "—"),
    ("Q7-033", "three / @react-three/fiber (via packages)", "THREE.Clock deprecation + Context Lost logs per canvas mount", "—"),
    ("F2A-011", "CoreLibrary data", "Pin header 1x02 vertical 3D model lies flat", "—"),
    ("F1B-009", "CoreLibrary data / DRC preset", "Core footprints fail JLCPCB silk rules (~5 warnings per part)", "out of scope (DRC)"),
    ("Q3-007", "@openpcb/rendering-core (grid constant)", "Schematic grid default 2 mm ≠ 2.54 mm pin pitch", "G: app passes 1.27 mm"),
    ("Q5-019", "@openpcb/kicad-import (validate-pads)", "Unnumbered NPTH pads reject whole part (USB-C J1 dropped)", "D1/D4 surface warnings"),
]
w("## (g) Shared-package follow-ups (`@openpcb/*`, CoreLibrary — no edits in this run)")
w("")
w("| Finding → TID | Package | Issue | In-app mitigation |")
w("|---|---|---|---|")
for fid, pkg, issue, mit in PKG:
    w(f"| {fid} → {tid_of_id[fid]} | {pkg} | {esc(issue)} | {esc(mit)} |")
w("")

open(f"{QA}/triage/TRIAGE.md", "w").write("\n".join(out) + "\n")
print("lines", len(out))
