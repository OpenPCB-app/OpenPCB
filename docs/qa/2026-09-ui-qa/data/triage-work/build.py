import json, os, re, sys, collections
sys.path.insert(0, os.path.dirname(__file__))
from groups import GROUPS

QA = "/private/tmp/claude-501/-Users-andrejvysny-workspace-openpcb-OpenPCB/f18aac79-e8af-4eed-b528-c505e87cbf8a/scratchpad/qa"
allf = {x["id"]: x for x in json.load(open(f"{QA}/triage/work/all.json"))}

SEVR = {"S1": 1, "S2": 2, "S3": 3, "S4": 4}
ESTR = {"XS": 0, "S": 1, "M": 2, "L": 3}
W2 = {"C1", "C2", "D1", "D2", "D3", "D4", "L1", "K1"}
W3 = {"L2", "L3", "L4a", "L4b", "A1", "A2", "A3"}

KSTAT = {f"K{i:02d}": "confirmed" for i in range(1, 46)}
KSTAT.update({"K16": "partial", "K27": "refuted", "N1": "confirmed", "N2": "confirmed", "spike": "confirmed"})
KNOTE = {
    "K01": "Docs FixedToolbar + Tasks tasks.map crash blank #root; designer survived injections but 2 unhandled rejections",
    "K09": "Schematic confirmed; PCB analog shows 'projection unavailable' without retry (F1A-012)",
    "K13": "Downgraded S4: Tune/Bundle behind dev flags; Measure reachable via context menu",
    "K16": "Hint 'T/B' never rendered; but T in idle Route quits Route and arms Text",
    "K20": "Code-confirmed (flag on in dev so not visible on dev stacks)",
    "K27": "Refuted: button named 'Snapshot' from visible text",
    "K28": "Schematic mislabels R as clockwise (it is CCW); editors correct",
    "K30": "Plus 4-layer variant: unchecking ships unmanufacturable bundle (F2B-006)",
    "K40": "Confirmed on Home, Library, Docs, Designer, BOM, cloud; not every one of 42 sites exercised",
    "K43": "Partial nuance: 3D Height heatmap is enabled and shows a fake legend",
    "N2": "Latent: Library→schematic drop path unreachable (MIME mismatch, F1C-006)",
    "spike": "Toolbar counts errors only; dock/status errors+warnings (Q4-001)",
}


def wave_for(owner):
    o = owner.split("+")[0]
    if o in ("F0a", "F0b", "G", "W4"):
        return o
    if o in W2:
        return "W2"
    if o in W3:
        return "W3"
    return "followup"


def first_shots(x):
    out = []
    ev = x.get("evidence") or {}
    out += [s for s in (ev.get("screenshots") or [])][:1]
    out += [e for e in (x["verification"].get("evidence") or []) if isinstance(e, str) and e.endswith(".png")][:1]
    if not out and ev.get("census"):
        out.append(ev["census"])
    if not out:
        c = (ev.get("console") or [None])[0]
        n = ev.get("network")
        n = n[0] if isinstance(n, list) and n else None
        if c:
            out.append("console: " + trim(c, 140))
        elif n:
            out.append("network: " + trim(n, 140))
    return out


def trim(s, n):
    s = re.sub(r"\s+", " ", s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


INFRA_ROOT = {
    "Kit primitive": {"path": "src/shared/frontend/ui/", "line": None, "note": "No Input/NumberInput/Select/Switch/RadioGroup/Toast/Spinner/Kbd/ErrorBoundary primitives; surfaces hand-roll controls"},
    "No shared shortcut": {"path": "src/modules/designer/frontend/pcb/PcbCanvas.tsx", "line": 4342, "note": "Keymaps check only <input>; no shared editable/modal/menu guard"},
    "Raw 'HTTP 500'": {"path": "src/core/frontend/src (42 sites)", "line": None, "note": "Each surface renders problem.title / `HTTP ${status}` / fetch error text directly"},
    "No React ErrorBoundary": {"path": "src/core/frontend/src/main.tsx", "line": 36, "note": "No ErrorBoundary in App.tsx/ModuleSpaceHost; no window error/unhandledrejection handlers"},
    "3D Snapshot": {"path": "src/modules/designer/frontend/three-d/Board3DOverlay.tsx", "line": None, "note": "Refuted"},
}

entries = []
seen = collections.Counter()
for g in GROUPS:
    ids = g["ids"]
    for i in ids:
        assert i in allf, i
        seen[i] += 1
    mem = [allf[i] for i in ids]
    prim = mem[0] if mem else None
    known = []
    for m in mem:
        k = m.get("knownRef")
        if k and (re.match(r"^(K\d\d|N\d)$", k) or k == "spike"):
            known.append(k)
    known += g.get("known", [])
    known = sorted(set(known), key=known.index)
    sev = g.get("sev") or (min((m["severity"] for m in mem), key=lambda s: SEVR[s]) if mem else "S3")
    est = g.get("est") or (max((m.get("estimate") or "S" for m in mem), key=lambda e: ESTR.get(e, 1)) if mem else "S")
    themes = sorted({t for m in mem for t in (m.get("themes") or [])}) or ["dark", "light"]
    ev = []
    for m in mem:
        for s in first_shots(m):
            if s not in ev:
                ev.append(s)
    if g.get("ev"):
        ev = g["ev"] + [x for x in ev if x not in g["ev"]]
    ev = ev[:3]
    if g.get("root"):
        root = g["root"]
    elif prim and not g.get("title", "").startswith("Raw 'HTTP 500'"):
        cr = (prim.get("codeRefs") or [{}])[0]
        root = {"path": cr.get("path"), "line": cr.get("line"), "note": trim(cr.get("note"), 220)}
    else:
        root = next((v for k, v in INFRA_ROOT.items() if g.get("title", "").startswith(k)), {"path": None, "line": None, "note": ""})
    title = g.get("title") or prim["title"]
    status = "confirmed"
    if mem and all("rej" in m["verification"]["verdict"].lower() for m in mem):
        status = "rejected"
    elif not mem:
        status = g.get("kstat", "derived")
    summary = trim(prim["actual"], 420) if prim else trim(g.get("note", ""), 420)
    if len(mem) > 1:
        summary += " | Also covers: " + "; ".join(f"{m['id']}: {trim(m['title'], 90)}" for m in mem[1:])
    if prim and status == "rejected":
        summary = "REJECTED — " + trim(prim["verification"]["reason"], 420)
    detail = trim(prim["suggestedFix"], 520) if prim else ""
    proposed = g["fix"] + (f" — Detail: {detail}" if detail and status != "rejected" else "")
    rec = g.get("rec", "fix-now")
    scope = g.get("scope", "frontend")
    owner = g["owner"]
    wave = g.get("wave") or ("proposal" if scope == "proposal" else ("followup" if rec in ("defer", "wont-fix") else wave_for(owner)))
    e = {
        "tid": None,
        "ids": ids,
        "knownRef": ",".join(known) if known else None,
        "knownStatus": {k: KSTAT.get(k, "confirmed") for k in known} or None,
        "area": g.get("area") or (prim["area"] if prim else "cross-cutting"),
        "title": title,
        "severity": sev,
        "category": g.get("cat") or (prim["category"] if prim else "consistency"),
        "themes": themes,
        "summary": summary,
        "evidence": ev,
        "rootCause": root,
        "proposedFix": proposed,
        "shortFix": g["fix"],
        "scope": scope,
        "estimate": est,
        "owner": owner,
        "wave": wave,
        "recommendation": rec,
        "decision": g.get("dec"),
        "note": g.get("note"),
        "status": status,
        "approved": None,
    }
    entries.append(e)

missing = [i for i in allf if seen[i] == 0]
dups = [i for i, c in seen.items() if c > 1]
assert not missing, missing
assert not dups, dups

AREA_ORDER = ["cross-cutting", "shell", "home", "settings", "designer.shell", "designer.schematic", "designer.comments",
              "designer.pcb", "designer.drc", "designer.bom", "designer.3d", "designer.import", "library.browse",
              "library.detail", "library.import", "library.wizard", "library.symbol-editor", "library.footprint-editor",
              "assistant.space", "assistant.dock", "docs", "tasks", "cloud"]


def sortkey(e):
    rej = 1 if e["status"] in ("rejected", "refuted") else 0
    return (rej, AREA_ORDER.index(e["area"]), SEVR[e["severity"]], e["ids"][0] if e["ids"] else "")


entries.sort(key=sortkey)
for n, e in enumerate(entries, 1):
    e["tid"] = f"T-{n:03d}"

# dependsOn via keywords
tid_of = {}
for e in entries:
    t = e["title"]
    if t.startswith("No shared shortcut guard"):
        tid_of["guard"] = e["tid"]
    if t.startswith("Raw 'HTTP 500'"):
        tid_of["problem"] = e["tid"]
    if t.startswith("Modal surfaces use four recipes"):
        tid_of["dialog"] = e["tid"]
    if t.startswith("Kit primitive set"):
        tid_of["kit"] = e["tid"]
    if t.startswith("Grid snapping disabled"):
        tid_of["grid"] = e["tid"]
    if t.startswith("App-wide right-click"):
        tid_of["ctx"] = e["tid"]
for e in entries:
    f = e["shortFix"]
    d = []
    if "confirmDialog" in f or "window.prompt" in f or "kit Dialog" in f:
        d.append(tid_of["dialog"])
    if "shortcut guard" in f and e["tid"] != tid_of["guard"]:
        d.append(tid_of["guard"])
    if "problem.ts" in f and e["tid"] != tid_of["problem"]:
        d.append(tid_of["problem"])
    if re.search(r"kit (Input|NumberInput|Select|Switch|Toast|Checkbox|SearchField|Banner)", f) and e["tid"] != tid_of["kit"]:
        d.append(tid_of["kit"])
    if "F0b handler fix" in f or "F0b menu fix" in f:
        d.append(tid_of["ctx"])
    if "grid pitch" in f:
        d.append(tid_of["grid"])
    e["dependsOn"] = sorted(set(d)) or None

json.dump(entries, open(f"{QA}/triage/triage.json", "w"), indent=1, ensure_ascii=False)
print(len(entries), "entries")
print(collections.Counter(e["severity"] for e in entries if e["status"] not in ("rejected", "refuted")))
print(collections.Counter(e["recommendation"] for e in entries))
print(collections.Counter(e["wave"] for e in entries))
