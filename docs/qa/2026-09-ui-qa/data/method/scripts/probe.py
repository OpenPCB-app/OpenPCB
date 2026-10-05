"""probe.py <png> --theme dark|light x,y[:label] ...  -> hex, nearest token (alpha tokens composited over surface-app), deltaE(CIE76)"""
import sys, json, pathlib, math
from PIL import Image
T = json.load(open(pathlib.Path(__file__).parent / "tokens.json"))
def hex2rgb(h): h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def lab(c):
    def f(u):
        u /= 255; return ((u + 0.055) / 1.055) ** 2.4 if u > 0.04045 else u / 12.92
    r, g, b = (f(x) for x in c)
    X = (r*0.4124 + g*0.3576 + b*0.1805) / 0.95047; Y = r*0.2126 + g*0.7152 + b*0.0722; Z = (r*0.0193 + g*0.1192 + b*0.9505) / 1.08883
    g2 = lambda t: t ** (1/3) if t > 0.008856 else 7.787*t + 16/116
    return (116*g2(Y) - 16, 500*(g2(X) - g2(Y)), 200*(g2(Y) - g2(Z)))
def de(a, b): return math.dist(lab(a), lab(b))
def palette(theme):
    t = T[theme]; bg = hex2rgb(t["--surface-app"]); out = {}
    for k, v in t.items():
        if isinstance(v, str): out[k] = hex2rgb(v)
        else: out[k + "@app"] = tuple(round(v["rgb"][i]*v["a"] + bg[i]*(1-v["a"])) for i in range(3))
    return out
def nearest(c, theme):
    pal = palette(theme); k = min(pal, key=lambda n: de(c, pal[n])); return k, round(de(c, pal[k]), 1)
if __name__ == "__main__":
    args = sys.argv[1:]; png = args.pop(0); theme = "dark"
    if "--theme" in args: i = args.index("--theme"); theme = args[i+1]; del args[i:i+2]
    im = Image.open(png).convert("RGB")
    for a in args:
        pos, _, label = a.partition(":"); x, y = map(int, pos.split(","))
        c = im.getpixel((x, y)); k, d = nearest(c, theme)
        print(f"{label or pos}\t#{c[0]:02x}{c[1]:02x}{c[2]:02x}\tnearest {k} dE={d}")
