"""palette-audit.py <png> --theme dark|light [--mask x0,y0,x1,y1 ...] -> top colours by area, flag off-token (dE>6) colours covering >0.5%"""
import sys, collections
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from probe import nearest
from PIL import Image
args = sys.argv[1:]; png = args.pop(0); theme = "dark"; masks = []
while args:
    a = args.pop(0)
    if a == "--theme": theme = args.pop(0)
    elif a == "--mask": masks.append(tuple(map(int, args.pop(0).split(","))))
im = Image.open(png).convert("RGB"); W, H = im.size
cnt = collections.Counter(); total = 0
for y in range(0, H, 2):
    for x in range(0, W, 2):
        if any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in masks): continue
        c = im.getpixel((x, y)); cnt[(c[0]//4*4, c[1]//4*4, c[2]//4*4)] += 1; total += 1
print(f"{png} theme={theme} sampled={total}")
for c, n in cnt.most_common(25):
    k, d = nearest(c, theme); pct = 100*n/total
    flag = "  OFF-TOKEN" if d > 6 and pct > 0.5 else ""
    print(f"#{c[0]:02x}{c[1]:02x}{c[2]:02x} {pct:5.1f}%  {k} dE={d}{flag}")
