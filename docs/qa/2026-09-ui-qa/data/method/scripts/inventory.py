import json, sys, urllib.request
base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100"
def get(p):
    with urllib.request.urlopen(base + p, timeout=30) as r: return json.load(r)
ds = get("/api/modules/designer/designs")["data"]["designs"]
out = []
for d in ds:
    rec = {"id": d["id"], "name": d["name"], "revision": d["revision"], "drc": d.get("drcStatus")}
    for view in ("schematic", "pcb"):
        try:
            p = get(f"/api/modules/designer/designs/{d['id']}/projection/{view}")
            p = p.get("data", p); p = p.get("projection", p)
            rec[view] = {k: (len(v) if isinstance(v, list) else None) for k, v in p.items() if isinstance(v, list)}
            if view == "pcb" and isinstance(p.get("board"), dict):
                rec["layerCount"] = p["board"].get("layerCount")
        except Exception as e:
            rec[view] = f"ERR {e}"
    out.append(rec)
json.dump(out, open(sys.argv[2] if len(sys.argv) > 2 else "/dev/stdout", "w"), indent=1)
for r in out:
    s = r.get("schematic"); p = r.get("pcb")
    print(r["id"][:8], r["name"][:40].ljust(40), "rev", r["revision"], "| sch", s if isinstance(s,str) else {k:v for k,v in s.items() if v}, "| pcb", p if isinstance(p,str) else {k:v for k,v in p.items() if v}, "| L", r.get("layerCount"))
