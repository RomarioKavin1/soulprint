"""
Salon assets for the web app (13 Nov 2026), rebuilt from CC0 museum photographs.

1. Frames: photographs of empty period cassetta frames (The Met Open Access, CC0) are cropped to
   the moulding and measured, so CSS can draw them as nine-slice `border-image` plates.
   Output: apps/web/public/salon/frames/<name>.webp and frames.json (slices + provenance).
2. Sculpture: Met photographs on a smooth grey studio sweep are cut out with an alpha matte
   derived from the photograph itself (row-wise backdrop model, colour distance, largest
   component, holes filled, feathered edge). Output: apps/web/public/salon/sculpture/<slug>.webp.

Run (needs numpy, scipy, pillow and `cwebp`):
  python scripts/salon-assets.py <download-dir>
The download dir receives the original museum images; nothing there ships.
"""
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "apps/web/public"
RAW = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / ".superpowers/tmp/salon-raw")
RAW.mkdir(parents=True, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 soulprint-salon-assets"}

FRAMES = {  # moulding name -> Met object id
    "gilt": 461303,
    "gilt-pattern": 460359,
    "walnut": 460550,
    "inlaid": 461189,
}
EXTRA_TRIM = {"walnut": 0.03}
COLOUR_SIGHT = {"gilt"}
# Black-and-white archive photographs (461446 ebony, 461305 silver) were dropped after the finish
# review: at hang size their monochrome surface reads as speckle, not as a material.
SCULPTURE = {204812: "rows"}
# The Thinker (191811) and the Kouros (253370) were withdrawn after two finish reviews: their
# photographs' backdrops defeat a derived matte (spurs, trapped backdrop, base halo).


def met(object_id: int) -> tuple[dict, Path]:
    meta = json.loads(urllib.request.urlopen(urllib.request.Request(
        f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}", headers=UA), timeout=30).read())
    assert meta["isPublicDomain"], object_id
    jpg = RAW / f"{object_id}.jpg"
    if not jpg.exists():
        jpg.write_bytes(urllib.request.urlopen(urllib.request.Request(meta["primaryImage"] or meta["primaryImageSmall"], headers=UA), timeout=120).read())
    return meta, jpg


def webp(png: Path, out: Path, *extra: str) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["cwebp", "-quiet", "-q", "86", "-metadata", "none", *extra, str(png), "-o", str(out)], check=True)


def frame_plate(name: str, object_id: int) -> dict:
    meta, jpg = met(object_id)
    im = Image.open(jpg).convert("RGB")
    im.thumbnail((1400, 1400))
    a = np.asarray(im).astype(np.int16)
    g = a.mean(axis=2)
    h, w = g.shape
    # The backdrop is what shows through the empty opening (its centre). Some photographs also
    # sit on a white page margin; neither counts as frame.
    bg = np.median(g[h // 2 - 20:h // 2 + 20, w // 2 - 20:w // 2 + 20])
    far = (np.abs(g - bg) > 22) & (g < 238)
    # The frame is the largest connected region that does not touch the photograph's edge
    # (scanner edges and page margins do).
    lab, n = ndimage.label(ndimage.binary_closing(far, iterations=3))
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    sizes = ndimage.sum(far, lab, range(1, n + 1))
    best = max((k for k in range(1, n + 1) if k not in edge), key=lambda k: sizes[k - 1])
    ys, xs = np.where(lab == best)
    top, bottom, left, right = ys.min(), ys.max(), xs.min(), xs.max()
    # Shave any side whose outermost line is still mostly backdrop.
    near = np.abs(g - bg) <= 22
    while near[top, left:right].mean() > 0.3: top += 1
    while near[bottom, left:right].mean() > 0.3: bottom -= 1
    while near[top:bottom, left].mean() > 0.3: left += 1
    while near[top:bottom, right].mean() > 0.3: right -= 1
    # Photographed slightly off-square: trim a little more so no backdrop wedge shows at an edge.
    extra = round(min(right - left, bottom - top) * EXTRA_TRIM.get(name, 0))
    left, top, right, bottom = left + extra, top + extra, right - extra, bottom - extra
    # The opening: walk in from each outer edge along the centre lines until a long run of backdrop.
    def inner(line: np.ndarray, start: int, step: int) -> int:
        run, i = 0, start
        while 0 <= i < len(line):
            run = run + 1 if abs(line[i] - bg) < 14 else 0
            if run >= max(18, len(line) // 30):
                return i - step * (run - 1)
            i += step
        raise RuntimeError(f"{name}: no opening")
    cy, cx = (top + bottom) // 2, (left + right) // 2
    il = inner(g[cy], left, 1)
    ir = inner(g[cy], right, -1)
    it = inner(g[:, cx], top, 1)
    ib = inner(g[:, cx], bottom, -1)
    if name in COLOUR_SIGHT:
        # Gilt is saturated, the backdrop (and the shadow the moulding casts on it) is neutral:
        # the sight edge is where the colour stops, which brightness alone misses in the shadow.
        sat = (a.max(axis=2) - a.min(axis=2)).astype(np.int16)
        def gilt_end(line: np.ndarray, start: int, step: int) -> int:
            run, i = 0, start
            while 0 <= i < len(line):
                run = run + 1 if line[i] < 28 else 0
                if run >= 10:
                    return i - step * (run - 1)
                i += step
            return -1
        # Search only the inner 40% of the measured moulding (outer ornament can be dark and neutral).
        il = max(left, min(il, gilt_end(sat[cy], left + int((il - left) * 0.6), 1) if gilt_end(sat[cy], left + int((il - left) * 0.6), 1) >= 0 else il))
        ir = min(right, max(ir, gilt_end(sat[cy], right - int((right - ir) * 0.6), -1)))
        it = max(top, min(it, gilt_end(sat[:, cx], top + int((it - top) * 0.6), 1) if gilt_end(sat[:, cx], top + int((it - top) * 0.6), 1) >= 0 else it))
        ib = min(bottom, max(ib, gilt_end(sat[:, cx], bottom - int((bottom - ib) * 0.6), -1)))
    # Trim the outermost pixels: the photograph's backdrop bleeds into the frame's silhouette there.
    trim = max(6, round(min(right - left, bottom - top) * 0.022))
    left, top, right, bottom = left + trim, top + trim, right - trim, bottom - trim
    crop = im.crop((left, top, right + 1, bottom + 1))
    out = WEB / "salon/frames" / f"{name}.webp"
    tmp = RAW / f"{name}.png"
    crop.save(tmp)
    webp(tmp, out)
    # End each slice a little inside the sight edge, so no rebate or backdrop rim shows inside the frame.
    inset = lambda d: int(round(d * 0.93)) - 3
    s = {"top": inset(it - top), "right": inset(right - ir), "bottom": inset(bottom - ib), "left": inset(il - left)}
    return {
        "src": f"/salon/frames/{name}.webp", "width": crop.width, "height": crop.height, "slice": s,
        "title": meta["title"], "date": meta.get("objectDate"), "medium": meta.get("medium"),
        "museum": "The Metropolitan Museum of Art", "source": meta["objectURL"], "licence": "CC0, public domain (Met Open Access)",
        "image": meta["primaryImage"] or meta["primaryImageSmall"],
    }


def sculpture_cutout(object_id: int) -> dict:
    meta, jpg = met(object_id)
    im = Image.open(jpg).convert("RGB")
    im.thumbnail((1100, 1500))
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    # Each photograph gets the backdrop model that fits its sweep (chosen by inspection):
    #  "rows":    model each row from both margins and blend across (dark bronze, white marble);
    #  "surface": fit a cubic surface to the top and side margins (warm stone on a vignetted sweep).
    method = SCULPTURE[object_id]
    sat = a.max(axis=2) - a.min(axis=2)
    if method == "rows":
        L = np.median(a[:, :10], axis=1)
        R = np.median(a[:, -10:], axis=1)
        t = np.linspace(0, 1, w)[None, :, None]
        bg = ndimage.uniform_filter1d(L, 25, axis=0)[:, None, :] * (1 - t) + ndimage.uniform_filter1d(R, 25, axis=0)[:, None, :] * t
        diff = np.abs(a - bg).max(axis=2)
        fg = (diff > 20) | (sat > 16)
        # Grey sweep left over where the margins mis-predict it: neutral, mid-to-light, near the model.
        grey = (sat < 9) & (a.mean(axis=2) > 95) & (diff < 45)
        fg &= ~grey
    else:
        yy, xx = np.mgrid[0:h, 0:w]
        band = (yy < h * 0.06) | (xx < w * 0.06) | (xx > w * 0.94)
        yn, xn = yy / h, xx / w
        terms = [np.ones_like(yn), xn, yn, xn * yn, xn**2, yn**2, xn**2 * yn, xn * yn**2, xn**3, yn**3]
        A = np.stack([t[band] for t in terms], axis=1)
        bg = np.zeros_like(a)
        for c in range(3):
            coef, *_ = np.linalg.lstsq(A, a[..., c][band], rcond=None)
            bg[..., c] = sum(k * t for k, t in zip(coef, terms))
        delta = a - bg
        diff = np.abs(delta).max(axis=2)
        # Soft shadows on the sweep are neutral and only somewhat darker than it: backdrop, not work.
        shadow = (sat < 14) & (delta.mean(axis=2) < 0) & (diff < 60)
        fg = ((diff > 24) | (sat > 18)) & ~shadow
    # The studio's cast shadow near the base: neutral, lighter than dark bronze, darker than the sweep.
    low = np.zeros_like(fg); low[int(h * 0.72):] = True
    cast = low & (sat < 12) & (a.mean(axis=2) > 80) & (a.mean(axis=2) < bg.mean(axis=2) - 4) & (np.abs(a - bg).max(axis=2) < 90)
    fg &= ~cast
    fg = ndimage.binary_opening(fg, iterations=2)
    lab, n = ndimage.label(fg)
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    fg = lab == (1 + int(np.argmax(sizes)))
    fg = ndimage.binary_closing(fg, iterations=4)
    # Fill small holes (grey highlights on the surface); keep large ones (gaps between limbs show backdrop).
    holes, nh = ndimage.label(ndimage.binary_fill_holes(fg) & ~fg)
    if nh:
        hs = ndimage.sum(np.ones_like(fg), holes, range(1, nh + 1))
        small = np.isin(holes, 1 + np.where(hs < fg.size * 0.025)[0])
        fg |= small
    fg = ndimage.binary_erosion(fg, iterations=2)  # take the backdrop rim off every edge
    alpha = ndimage.gaussian_filter(fg.astype(np.float32), 1.1)
    ys, xs = np.where(fg)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    rgba = np.dstack([a, np.clip(alpha * 255, 0, 255)]).astype(np.uint8)
    cut = Image.fromarray(rgba, "RGBA").crop(box)
    tmp = RAW / f"cut-{object_id}.png"
    cut.save(tmp)
    out = WEB / "salon/sculpture" / f"met-{object_id}.webp"
    webp(tmp, out, "-exact", "-alpha_q", "100")
    return {"slug": f"met-{object_id}", "src": f"/salon/sculpture/met-{object_id}.webp", "width": cut.width, "height": cut.height,
            "matte": "derived from the photograph: backdrop model + colour distance, largest component, holes under 2.5% of the image filled, studio cast shadow removed, 2px erosion, 1px feather"}


# Classics whose museum photograph includes a dark surround or the canvas edge: crop to the paint.
DARK_EDGED = [436535, 12127, 436947, 437984]


def crop_to_paint(object_id: int) -> tuple[int, int]:
    path = WEB / "classics" / f"met-{object_id}.webp"
    # Always from the museum original (so re-running never crops twice), at the classics' 1100px width.
    meta, jpg = met(object_id)
    im = Image.open(jpg).convert("RGB")
    im = im.resize((1100, round(im.height * 1100 / im.width)), Image.LANCZOS)
    g = np.asarray(im.convert("L")).astype(np.float32)
    h, w = g.shape
    def edge(line_at, n) -> int:
        k = 0
        while k < n // 4:
            line = line_at(k)
            if line.mean() < 55 and line.std() < 30:
                k += 1
            else:
                break
        return k
    top = edge(lambda k: g[k], h)
    bottom = edge(lambda k: g[h - 1 - k], h)
    left = edge(lambda k: g[:, k], w)
    right = edge(lambda k: g[:, w - 1 - k], w)
    inset = round(min(w, h) * 0.008)  # the canvas edge just inside the dark band
    box = (left + inset, top + inset, w - right - inset, h - bottom - inset)
    out = im.crop(box)
    tmp = RAW / f"paint-{object_id}.png"
    out.save(tmp)
    webp(tmp, path, "-q", "80")
    return out.width, out.height


if __name__ == "__main__":
    frames = {name: frame_plate(name, i) for name, i in FRAMES.items()}
    (WEB / "salon/frames/frames.json").write_text(json.dumps(frames, indent=2, ensure_ascii=False) + "\n")
    for name, f in frames.items():
        print(name, f["width"], "x", f["height"], f["slice"])
    classics_json = WEB / "classics" / "classics.json"
    classics = json.loads(classics_json.read_text())
    for i in DARK_EDGED:
        w, h = crop_to_paint(i)
        for c in classics:
            if c["slug"] == f"met-{i}":
                c["width"], c["height"] = w, h
        print(f"met-{i} cropped to the paint: {w} x {h}")
    classics_json.write_text(json.dumps(classics, indent=2, ensure_ascii=False) + "\n")
    cuts = [sculpture_cutout(i) for i in SCULPTURE]
    (WEB / "salon/sculpture/sculpture.json").write_text(json.dumps(cuts, indent=2) + "\n")
    for c in cuts:
        print(c["slug"], c["width"], "x", c["height"])
