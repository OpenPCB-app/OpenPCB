import re, json, pathlib
css = pathlib.Path("/Users/andrejvysny/workspace/openpcb/OpenPCB/src/core/frontend/src/index.css").read_text()
def block(sel):
    m = re.search(re.escape(sel) + r"\s*\{(.*?)\n\}", css, re.S); return m.group(1) if m else ""
def parse(b):
    out = {}
    for name, val in re.findall(r"(--[\w-]+):\s*([^;]+);", b):
        val = val.strip()
        if re.fullmatch(r"#[0-9a-fA-F]{6}", val): out[name] = val.lower()
        m = re.fullmatch(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)", val)
        if m: out[name] = {"rgb": [int(m.group(i)) for i in (1,2,3)], "a": float(m.group(4))}
    return out
theme = parse(block("@theme"))
json.dump({"light": parse(block(":root")), "dark": parse(block("html.dark")), "theme": theme},
          open(pathlib.Path(__file__).parent / "tokens.json", "w"), indent=1)
print("ok")
