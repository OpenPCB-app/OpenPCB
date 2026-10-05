"""Export the QA run (findings, triage, coverage, method, baselines) into repo markdown docs + data.

usage: python3 export_docs.py <outDir> [--evidence-ext .webp|.png] [--evidence-base evidence]
"""
import json, glob, os, re, sys, shutil, collections, pathlib

QA = pathlib.Path(__file__).resolve().parent.parent
args = sys.argv[1:]
OUT = pathlib.Path(args.pop(0))
EXT = ".webp"; BASE = "evidence"
while args:
    a = args.pop(0)
    if a == "--evidence-ext": EXT = args.pop(0)
    elif a == "--evidence-base": BASE = args.pop(0)

tri = json.load(open(QA / "triage/triage.json"))
verified = {}
for f in sorted(glob.glob(str(QA / "findings/verified/*.json"))):
    for x in json.load(open(f)):
        verified[x["id"]] = x
coverage = {pathlib.Path(f).stem: json.load(open(f)) for f in sorted(glob.glob(str(QA / "findings/coverage/*.json")))}
triage_md = (QA / "triage/TRIAGE.md").read_text()

SHOT = re.compile(r"(?<![\w/])(shots/[^\s\"'`,;)\]|]+?\.png)")


def ev(path, depth):
    """Rewrite shots/... path to a relative evidence link from a doc at `depth` levels below OUT."""
    rel = "../" * depth + BASE + "/" + path[:-4] + EXT
    return f"[{path.split('/')[-1][:-4]}]({rel})"


def link_shots(text, depth):
    return SHOT.sub(lambda m: ev(m.group(1), depth), text)


def esc(s):
    return str(s if s is not None else "").replace("|", "\\|").replace("\n", " ")


def section(md, start, end=None):
    i = md.find(start)
    j = md.find(end, i + 1) if end else len(md)
    return md[i: j if j > 0 else len(md)].strip() + "\n"


AREA_ORDER = ["cross-cutting", "shell", "home", "settings", "designer.shell", "designer.schematic", "designer.comments",
              "designer.pcb", "designer.drc", "designer.bom", "designer.3d", "designer.import", "library.browse",
              "library.detail", "library.import", "library.wizard", "library.symbol-editor", "library.footprint-editor",
              "assistant.space", "assistant.dock", "docs", "tasks", "cloud"]
SEV_ORDER = {"S1": 0, "S2": 1, "S3": 2, "S4": 3}

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "areas").mkdir(exist_ok=True)

by_area = collections.defaultdict(list)
for e in tri:
    by_area[e["area"]].append(e)
areas = [a for a in AREA_ORDER if a in by_area] + sorted(a for a in by_area if a not in AREA_ORDER)

# ---------- per-area detail docs ----------
area_index_rows = []
for area in areas:
    items = sorted(by_area[area], key=lambda e: (SEV_ORDER.get(e["severity"], 9), e["tid"]))
    cnt = collections.Counter(e["severity"] for e in items if e["status"] not in ("rejected", "refuted"))
    fname = f"areas/{area.replace('.', '-')}.md"
    area_index_rows.append((area, fname, cnt, len(items)))
    L = [f"# {area} — QA findings", "",
         f"[← index](../README.md) · {len(items)} triage entries · "
         + " · ".join(f"{s} {cnt.get(s, 0)}" for s in ("S1", "S2", "S3", "S4")), "",
         "| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |", "|---|---|---|---|---|---|---|---|"]
    for e in items:
        L.append(f"| [{e['tid']}](#{e['tid'].lower()}) | {e['severity']} | {esc(e['title'])} | {', '.join(e['ids'])} | "
                 f"{e.get('recommendation', '')}{' (' + e['decision'] + ')' if e.get('decision') else ''} | "
                 f"{e.get('owner', '')} / {e.get('wave', '')} | {e.get('scope', '')} | {e.get('estimate', '')} |")
    L.append("")
    for e in items:
        L += [f"## {e['tid']}", "", f"**{esc(e['title'])}**", "",
              f"- Severity **{e['severity']}** · category {e.get('category')} · status {e['status']} · themes {', '.join(e.get('themes') or [])}",
              f"- Recommendation **{e.get('recommendation')}**" + (f" · decision {e['decision']}" if e.get("decision") else "")
              + f" · owner {e.get('owner')} · wave {e.get('wave')} · scope {e.get('scope')} · estimate {e.get('estimate')}",
              f"- Findings: {', '.join(e['ids'])}" + (f" · known ref {e['knownRef']}" if e.get("knownRef") else "")]
        if e.get("dependsOn"): L.append(f"- Depends on: {e['dependsOn']}")
        L += ["", f"**Summary.** {link_shots(e.get('summary', ''), 1)}", ""]
        rc = e.get("rootCause") or {}
        if rc: L += [f"**Root cause.** `{rc.get('path')}:{rc.get('line')}` — {rc.get('note', '')}", ""]
        if e.get("proposedFix"): L += [f"**Proposed fix.** {link_shots(e['proposedFix'], 1)}", ""]
        if e.get("note"): L += [f"**Note.** {link_shots(str(e['note']), 1)}", ""]
        if e.get("evidence"): L += ["**Evidence.** " + ", ".join(link_shots(p, 1) if p.startswith("shots/") else f"`{p}`" for p in e["evidence"]), ""]
        for fid in e["ids"]:
            f = verified.get(fid)
            if not f: continue
            L += [f"<details><summary>{fid} — {esc(f.get('title'))} ({f.get('severity')}, {f.get('status')})</summary>", ""]
            L.append(f"- Area {f.get('area')} · stack {f.get('stack')} · design {f.get('designId')} · themes {', '.join(f.get('themes') or [])} · viewports {', '.join(f.get('viewports') or [])}")
            if f.get("repro"): L += ["- Repro:"] + [f"  {i + 1}. {link_shots(str(s), 1)}" for i, s in enumerate(f["repro"])]
            L += [f"- Expected: {link_shots(str(f.get('expected', '')), 1)}", f"- Actual: {link_shots(str(f.get('actual', '')), 1)}"]
            evd = f.get("evidence") or {}
            if isinstance(evd, dict):
                if evd.get("screenshots"): L.append("- Screenshots: " + ", ".join(ev(p, 1) if p.startswith("shots/") else f"`{p}`" for p in evd["screenshots"]))
                for k in ("console", "network"):
                    if evd.get(k): L.append(f"- {k.capitalize()}: " + "; ".join(f"`{esc(x)[:200]}`" for x in evd[k]))
                if evd.get("pixelProbes"): L.append("- Pixel probes: " + "; ".join(esc(json.dumps(p))[:200] for p in evd["pixelProbes"]))
                if evd.get("census"): L.append(f"- Census: `{evd['census']}`")
            for c in f.get("codeRefs") or []:
                L.append(f"- Code: `{c.get('path')}:{c.get('line')}` — {esc(c.get('note', ''))}")
            if f.get("suggestedFix"): L.append(f"- Suggested fix: {link_shots(str(f['suggestedFix']), 1)}")
            v = f.get("verification") or {}
            if v: L.append(f"- Verification ({v.get('by')}): **{v.get('verdict')}** — {link_shots(str(v.get('reason', '')), 1)}"
                           + (" · evidence: " + ", ".join(link_shots(str(x), 1) for x in v.get("evidence") or []) if v.get("evidence") else ""))
            if f.get("mergedIds"): L.append(f"- Merged duplicates: {', '.join(f['mergedIds'])}")
            L += ["", "</details>", ""]
        L.append("")
    (OUT / fname).write_text("\n".join(L))

# ---------- split TRIAGE.md sections ----------
hdr = "[← index](README.md)\n\n"
(OUT / "01-summary.md").write_text(hdr + "# Summary\n\n" + link_shots(section(triage_md, "## (a) Summary", "## (b)"), 0))
(OUT / "02-known-findings.md").write_text(hdr + "# Known findings (code recon) — status\n\n" + link_shots(section(triage_md, "## (b)", "## (c)"), 0)
                                          + "\n\n## Original recon catalog\n\n" + (QA / "known-findings.md").read_text().split("\n", 2)[2])
(OUT / "03-decisions.md").write_text(hdr + "# Decisions needed\n\n" + link_shots(section(triage_md, "## (d)", "## (e)"), 0))
(OUT / "04-proposals.md").write_text(hdr + "# Structural / layout proposals\n\n" + link_shots(section(triage_md, "## (e)", "## (f)"), 0))
rej = [f for f in verified.values() if f.get("status") in ("rejected", "duplicate", "needs-info")]
rl = [hdr, "# Rejected, duplicate and needs-info findings\n", link_shots(section(triage_md, "## (f)", "## (g)"), 0), "\n## Full records\n"]
for f in sorted(rej, key=lambda x: x["id"]):
    v = f.get("verification") or {}
    rl.append(f"### {f['id']} — {esc(f.get('title'))}\n\n- Status **{f.get('status')}** · severity {f.get('severity')} · area {f.get('area')}\n"
              f"- Actual: {link_shots(str(f.get('actual', '')), 0)}\n- Verification ({v.get('by')}): {v.get('verdict')} — {link_shots(str(v.get('reason', '')), 0)}\n")
(OUT / "05-rejected.md").write_text("\n".join(rl))
(OUT / "06-shared-package-followups.md").write_text(hdr + "# Shared-package follow-ups\n\n" + link_shots(section(triage_md, "## (g)"), 0))
(OUT / "TRIAGE-full.md").write_text(hdr + link_shots(triage_md, 0))

# ---------- coverage ----------
cl = [hdr, "# Coverage per QA charter\n",
      "Each charter's checklist with per-theme status, known-finding verdicts and untested items (as reported by the QA agent).\n"]
for agent, c in coverage.items():
    cl.append(f"## {agent}\n")
    rows = c.get("checklist") or []
    if rows:
        cl += ["| Item | Dark | Light | Viewports |", "|---|---|---|---|"]
        cl += [f"| {esc(r.get('item'))} | {r.get('dark', '')} | {r.get('light', '')} | {', '.join(r.get('viewports') or [])} |" for r in rows]
    if c.get("known"):
        cl += ["", "Known findings: " + "; ".join(f"{k.get('ref')} {k.get('status')}" for k in c["known"])]
    if c.get("untested"):
        cl += ["", "Untested:"] + [f"- {esc(u.get('item'))} — {esc(u.get('reason'))}" for u in c["untested"]]
    cl.append("")
(OUT / "07-coverage.md").write_text("\n".join(cl))

# ---------- data ----------
D = OUT / "data"
for sub in ("raw", "verified", "coverage"):
    (D / sub).mkdir(parents=True, exist_ok=True)
    for f in glob.glob(str(QA / f"findings/{sub}/*")):
        shutil.copy(f, D / sub)
shutil.copy(QA / "triage/triage.json", D / "triage.json")
shutil.copytree(QA / "census", D / "census", dirs_exist_ok=True)
shutil.copytree(QA / "triage/work", D / "triage-work", dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__"))
(D / "method").mkdir(exist_ok=True)
for f in ("QA_PROTOCOL.md", "known-findings.md", "surface-inventory.md", "inventory/assignments.json", "inventory/designs.json"):
    shutil.copy(QA / f, D / "method" / pathlib.Path(f).name)
(D / "method" / "scripts").mkdir(exist_ok=True)
for f in glob.glob(str(QA / "scripts/*")):
    p = pathlib.Path(f)
    if p.is_file() and p.suffix in (".py", ".sh", ".js", ".json") and "llm" not in p.name and "inject" not in p.name:
        shutil.copy(p, D / "method" / "scripts" / p.name)
(D / "gates").mkdir(exist_ok=True)
for f in glob.glob(str(QA / "gates/baseline-*")):
    if not f.endswith("baseline-done"):
        shutil.copy(f, D / "gates")

# ---------- index ----------
tot = collections.Counter(e["severity"] for e in tri if e["status"] not in ("rejected", "refuted"))
rec = collections.Counter(e.get("recommendation") for e in tri)
R = ["# UI QA pass — 2026-09 (post neutral-EDA redesign)", "",
     "Manual exploratory QA of the whole OpenPCB desktop app after the neutral EDA redesign (`PLAN.md`), driven through "
     "`playwright-cli` against isolated dev stacks, in dark and light themes at 1100×720 / 1440×900 / 1920×1080, "
     "with every finding adversarially re-verified by a second agent. Nothing from the run was discarded: every raw, "
     "verified, rejected and duplicate finding, the coverage reports, DOM census data, triage and method are kept here.", "",
     f"- **Charters:** {len(coverage)} (q1–q11 by area, f1a–f1d and f2a–f2c follow-ups from the completeness critic)",
     f"- **Raw findings:** {len(verified)} · confirmed {sum(1 for f in verified.values() if f.get('status') == 'confirmed')} · "
     f"duplicate {sum(1 for f in verified.values() if f.get('status') == 'duplicate')} · rejected {sum(1 for f in verified.values() if f.get('status') == 'rejected')}",
     f"- **Triage entries (root causes):** {len(tri)} · live by severity: S1 {tot['S1']} · S2 {tot['S2']} · S3 {tot['S3']} · S4 {tot['S4']}",
     f"- **Recommendation:** " + " · ".join(f"{k} {v}" for k, v in rec.most_common()), "",
     "## Documents", "",
     "| Doc | Content |", "|---|---|",
     "| [01-summary.md](01-summary.md) | Counts, severity × area, all S1 release blockers, workload by owner |",
     "| [02-known-findings.md](02-known-findings.md) | Status of the 45 code-recon findings (K01–K45, N1, N2) + original catalog |",
     "| [03-decisions.md](03-decisions.md) | Product/scope decisions needed, with recommended defaults |",
     "| [04-proposals.md](04-proposals.md) | Structural/layout proposals (not built without approval) |",
     "| [05-rejected.md](05-rejected.md) | Rejected / duplicate / needs-info findings with reasons |",
     "| [06-shared-package-followups.md](06-shared-package-followups.md) | Issues inside `@openpcb/*` packages and CoreLibrary data |",
     "| [07-coverage.md](07-coverage.md) | What each charter tested (per theme / viewport), known-finding verdicts, untested items |",
     "| [08-method.md](08-method.md) | Environment, stacks, tooling, charters, severity rubric, baselines |",
     "| [TRIAGE-full.md](TRIAGE-full.md) | The complete single-file triage as produced by the triage lead |", "",
     "## Findings by area", "", "| Area | Entries | S1 | S2 | S3 | S4 |", "|---|---|---|---|---|---|"]
for area, fname, cnt, n in area_index_rows:
    R.append(f"| [{area}]({fname}) | {n} | {cnt.get('S1', '')} | {cnt.get('S2', '')} | {cnt.get('S3', '')} | {cnt.get('S4', '')} |")
R += ["", "## Data", "",
      "- `data/triage.json` — one entry per root cause (`tid`, finding `ids`, owner, wave, recommendation, `approved`).",
      "- `data/raw/*.jsonl` — every finding as first recorded by the QA agent.",
      "- `data/verified/*.json` — every finding after adversarial verification (status + verification verdict/reason/evidence).",
      "- `data/coverage/*.json` — per-charter checklists; `data/census/*.json` — DOM census per screen × theme × viewport.",
      "- `data/method/` — QA protocol, known-findings catalog, surface inventory, design assignments, helper scripts.",
      "- `data/gates/` — baseline gate outputs (typecheck, modules tsc set, vitest, build, e2e) at HEAD 63e90ea.",
      f"- `{BASE}/` — all screenshot evidence (original PNGs, `evidence/shots/<agent>/<theme>/…`; verifier shots under `v<agent>`).", "- `raw-run/` — everything else from the run: agent work dirs (crops, helper files), playwright-cli snapshots + console logs, backend/Vite logs, fixtures, Vite wrapper configs, all helper scripts, the workflow script, and post-run DB snapshots of stacks A/B/C + pristine (API keys scrubbed).", ""]
(OUT / "README.md").write_text("\n".join(R))
print("wrote", OUT)
