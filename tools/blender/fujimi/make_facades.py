"""Facade atlases for Fujimi: `python3 tools/blender/fujimi/make_facades.py` (numpy + Pillow, no Blender).

Writes src/assets/maps/fujimi/{res,office}-atlas.webp and their *-emit.webp night masks. Each atlas is
2048 x 2048 with four 1024 px slots (index = row * 2 + column):
  res:    0 tokyo-flats photo | 1 tiled balconies | 2 grey slab balconies | 3 open-corridor side
  office: 0 tokyo-office photo | 1 ribbon windows | 2 blue curtain wall  | 3 punched concrete grid
The albedo is the facade by night with no light of its own; the emissive mask holds only the lit
rooms, so walls stay dark under the street lights and only windows glow. Every slot tiles seamlessly.
SPANS (metres per slot) must match build_fujimi.py.
"""
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
MAPS = ROOT / 'src/assets/maps'
OUT = MAPS / 'fujimi'
S = 1024
SPANS = {'res': [(11.0, 15.0), (14.4, 18.0), (14.4, 18.0), (14.4, 18.0)],
         'office': [(14.0, 17.5), (12.0, 22.8), (12.0, 22.8), (12.0, 22.8)]}


class Canvas:
    def __init__(self, seed, wall):
        self.r = np.random.default_rng(seed)
        self.a = np.empty((S, S, 3), np.float32)
        self.a[:] = wall
        self.e = np.zeros((S, S, 3), np.float32)

    def rect(self, x0, y0, x1, y1, color, emit=None, alpha=1.0):
        x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
        if x1 <= x0 or y1 <= y0:
            return
        def fit(v):   # a colour, or a vertical gradient resampled to the rectangle's height
            v = np.asarray(v, np.float32)
            if v.ndim == 1:
                return v[None, None, :]
            return v[np.linspace(0, v.shape[0] - 1, y1 - y0).round().astype(int)]
        self.a[y0:y1, x0:x1] = self.a[y0:y1, x0:x1] * (1 - alpha) + fit(color) * alpha
        if emit is not None:
            self.e[y0:y1, x0:x1] = self.e[y0:y1, x0:x1] * (1 - alpha) + fit(emit) * alpha

    def tiles(self, x0, y0, x1, y1, base, size=10, grout=0.82):
        """Small ceramic tile cladding: a grid of grout lines with per-tile tone noise."""
        x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
        h, w = y1 - y0, x1 - x0
        if h <= 0 or w <= 0:
            return
        yy, xx = np.mgrid[0:h, 0:w]
        tone = 0.92 + 0.12 * self.r.random((h // size + 2, w // size + 2))[yy // size, xx // size]
        line = ((yy % size) == 0) | ((xx % size) == 0)
        block = np.asarray(base, np.float32)[None, None, :] * tone[..., None]
        block[line] *= grout
        self.a[y0:y1, x0:x1] = block

    def finish(self, streaks=0.0):
        r = self.r
        # Weathering: faint vertical rain streaks and a fine grain.
        if streaks:
            for c in r.integers(0, S, 60):
                w = int(r.integers(2, 7))
                fade = np.roll(np.linspace(1, 0, S) ** r.uniform(0.5, 2), int(r.integers(0, S)))
                self.a[:, c:c + w] *= (1 - streaks * fade)[:, None, None]
        self.a *= 1 + (r.random((S, S, 1)).astype(np.float32) - 0.5) * 0.06
        return np.clip(self.a, 0, 1), np.clip(self.e, 0, 1)


def room(r, warm_bias=0.7):
    """A lit room's light colour and brightness, or None when it is dark."""
    if r.random() > 0.58:
        return None
    pick = r.random()
    if pick < warm_bias:
        c = np.array([1.0, 0.74, 0.46])
    elif pick < warm_bias + 0.22:
        c = np.array([0.92, 0.95, 1.0])
    else:
        c = np.array([0.6, 0.75, 1.0])
    return c * r.uniform(0.55, 1.0)


def interior(cv, x0, y0, x1, y1, light, office=False):
    """Glass seen from outside. Dark: tinted glass with a sky reflection band. Lit: a room with a soft
    ceiling-lamp hotspot (or office troffers), a vignette, low furniture, and maybe folded curtains."""
    r = cv.r
    x0, y0, x1, y1 = (int(round(v)) for v in (x0, y0, x1, y1))
    h, w = y1 - y0, x1 - x0
    if h <= 2 or w <= 2:
        return
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    v, u = yy / h, xx / w
    if light is None:
        base = np.array([0.045, 0.055, 0.075]) + 0.05 * (1 - v)[..., None] * np.array([0.6, 0.75, 1.0])
        band = np.exp(-((u + v * 0.6 - r.uniform(0.3, 1.2)) / 0.12) ** 2)[..., None] * 0.06
        noise = r.random((h, w, 1)) * 0.015
        cv.a[y0:y1, x0:x1] = base + band + noise
        return
    if office:
        ceiling = np.clip(1 - v / 0.22, 0, 1) ** 0.6
        troffers = ((np.sin(u * np.pi * r.integers(3, 6)) > 0.6) & (v < 0.08)).astype(np.float32)
        body = 0.35 + 0.65 * ceiling + 0.8 * troffers
        clutter = (v > 0.62) * (0.55 + 0.45 * (np.sin(u * 37 + r.uniform(0, 6)) > 0.3))
        shade = body * np.where(v > 0.62, clutter, 1.0)
    else:
        cx, cy = r.uniform(0.3, 0.7), r.uniform(0.05, 0.25)
        hot = np.exp(-(((u - cx) / 0.35) ** 2 + ((v - cy) / 0.45) ** 2))
        vign = (1 - 0.5 * (2 * u - 1) ** 2) * (1 - 0.35 * v)
        furniture = np.where(v > 0.7 + 0.08 * np.sin(u * 9 + r.uniform(0, 6)), 0.45, 1.0)
        shade = (0.35 + 0.9 * hot) * vign * furniture
    shade = shade[..., None] * (1 + (r.random((h, w, 1)) - 0.5) * 0.08)
    emit = light * shade
    albedo = emit * 0.5
    if not office and r.random() < 0.6:          # folded curtains, lit from behind
        tone = np.array(r.choice([[0.92, 0.86, 0.74], [0.86, 0.88, 0.9], [0.7, 0.74, 0.82], [0.86, 0.76, 0.66]]))
        folds = 0.75 + 0.25 * np.sin(u * w / 7.0 + r.uniform(0, 6)) ** 2
        cut = r.uniform(0.25, 0.75)
        mask = (u < cut) if r.random() < 0.5 else (u > cut)
        if r.random() < 0.3:
            mask = np.ones_like(u, bool)
        c = (tone * folds[..., None] * light * 0.6)
        emit = np.where(mask[..., None], c, emit)
        albedo = np.where(mask[..., None], tone * folds[..., None] * 0.35, albedo)
    cv.a[y0:y1, x0:x1] = albedo
    cv.e[y0:y1, x0:x1] = emit


def balconies(seed, wall, rail, slab, bars=False):
    cv = Canvas(seed, wall)
    bays, floors = 4, 6
    bw, fh = S / bays, S / floors
    for f in range(floors):
        top = f * fh
        for b in range(bays):
            x0 = b * bw
            light = room(cv.r)
            cv.tiles(x0, top, x0 + bw, top + fh, wall, size=9)
            # partition boards between balconies
            cv.rect(x0, top, x0 + bw * 0.06, top + fh, np.array(wall) * 1.08)
            cv.rect(x0 + bw * 0.94, top, x0 + bw, top + fh, np.array(wall) * 1.08)
            # sliding door with aluminium frame
            gx0, gx1, gy0, gy1 = x0 + bw * 0.12, x0 + bw * 0.88, top + fh * 0.1, top + fh * 0.84
            cv.rect(gx0 - 4, gy0 - 4, gx1 + 4, gy1, [0.55, 0.56, 0.58])
            interior(cv, gx0, gy0, gx1, gy1, light)
            cv.rect((gx0 + gx1) / 2 - 2, gy0, (gx0 + gx1) / 2 + 2, gy1, [0.5, 0.51, 0.53])
            # outdoor AC unit and maybe laundry
            if cv.r.random() < 0.75:
                ax = gx1 - 62 if cv.r.random() < 0.6 else gx0 + 6
                cv.rect(ax, gy1 - 52, ax + 56, gy1 - 6, [0.78, 0.78, 0.76])
                cv.rect(ax + 26, gy1 - 44, ax + 50, gy1 - 14, [0.25, 0.25, 0.26])
            # railing: frosted glass or vertical bars, then the slab edge
            ry0, ry1 = top + fh * 0.6, top + fh * 0.9
            if bars:
                cv.rect(x0 + 4, ry0, x0 + bw - 4, ry0 + 6, rail)
                for bx in np.arange(x0 + 8, x0 + bw - 6, 11):
                    cv.rect(bx, ry0, bx + 4, ry1, rail)
            else:
                cv.rect(x0 + 2, ry0, x0 + bw - 2, ry1, rail, alpha=0.78)
                cv.e[int(ry0):int(ry1), int(x0):int(x0 + bw)] *= 0.35
                cv.rect(x0 + 2, ry0, x0 + bw - 2, ry0 + 5, [0.3, 0.31, 0.33])
            cv.rect(x0, top + fh * 0.9, x0 + bw, top + fh, slab)
            cv.rect(x0, top + fh * 0.985, x0 + bw, top + fh, np.array(slab) * 0.55)
    return cv.finish(streaks=0.09)


def corridor(seed):
    """Open-corridor side of a Japanese mansion: parapet walls, front doors, a ceiling light per door."""
    cv = Canvas(seed, [0.62, 0.6, 0.56])
    floors, doors = 6, 4
    fh, dw = S / floors, S / doors
    for f in range(floors):
        top = f * fh
        cv.rect(0, top, S, top + fh * 0.55, [0.2, 0.2, 0.21])            # corridor shadow behind
        for d in range(doors):
            x0 = d * dw
            cv.rect(x0 + dw * 0.3, top + fh * 0.05, x0 + dw * 0.55, top + fh * 0.55, [0.32, 0.27, 0.22])   # door
            cv.rect(x0 + dw * 0.62, top + fh * 0.12, x0 + dw * 0.86, top + fh * 0.34, [0.42, 0.44, 0.46])  # frosted window
            if cv.r.random() < 0.5:
                cv.rect(x0 + dw * 0.62, top + fh * 0.12, x0 + dw * 0.86, top + fh * 0.34, [0.55, 0.5, 0.4], emit=[0.6, 0.5, 0.35])
            # the ceiling light pools down the wall
            lx = x0 + dw * 0.42
            on = cv.r.random() < 0.9
            glow = np.array([1.0, 0.9, 0.72]) if cv.r.random() < 0.7 else np.array([0.85, 0.95, 1.0])
            if on:
                h = int(fh * 0.5)
                fall = np.linspace(0.9, 0.15, h)[:, None, None] * glow
                cv.rect(lx - 46, top + 2, lx + 46, top + 2 + h, fall * 0.5, emit=fall * 0.6, alpha=0.6)
                cv.rect(lx - 10, top, lx + 10, top + 6, glow, emit=glow)
        # parapet wall with a darker cap and a drain line
        cv.tiles(0, top + fh * 0.55, S, top + fh, [0.66, 0.64, 0.6], size=12)
        cv.rect(0, top + fh * 0.55, S, top + fh * 0.58, [0.78, 0.77, 0.74])
    return cv.finish(streaks=0.1)


def ribbon(seed):
    cv = Canvas(seed, [0.5, 0.52, 0.55])
    floors = 6
    fh = S / floors
    for f in range(floors):
        top = f * fh
        lit_floor = cv.r.random() < 0.62
        glass0, glass1 = top + fh * 0.12, top + fh * 0.7
        for b in range(8):
            x0, x1 = b * S / 8, (b + 1) * S / 8
            light = (np.array([0.88, 0.94, 1.0]) * cv.r.uniform(0.7, 1.0)) if lit_floor and cv.r.random() < 0.9 else None
            interior(cv, x0 + 3, glass0, x1 - 3, glass1, light, office=True)
            cv.rect(x1 - 3, glass0, x1 + 3, glass1, [0.35, 0.36, 0.38])
        cv.rect(0, glass1, S, top + fh + 0.1 * fh if f < floors - 1 else S, [0.62, 0.63, 0.65])   # spandrel panel
        cv.rect(0, glass1, S, glass1 + 4, [0.3, 0.31, 0.33])
    return cv.finish(streaks=0.08)


def curtain(seed):
    cv = Canvas(seed, [0.05, 0.08, 0.13])
    floors, cols = 6, 8
    fh, cw = S / floors, S / cols
    for f in range(floors):
        top = f * fh
        lit_floor = cv.r.random() < 0.55
        for c in range(cols):
            x0 = c * cw
            light = (np.array([0.75, 0.88, 1.0]) * cv.r.uniform(0.6, 1.0)) if lit_floor and cv.r.random() < 0.85 else None
            interior(cv, x0 + 4, top + 6, x0 + cw - 4, top + fh - 10, light, office=True)
            if light is None:   # tinted glass reflecting the city
                cv.rect(x0 + 4, top + 6, x0 + cw - 4, top + fh - 10, [0.1, 0.16, 0.26], alpha=0.55)
        cv.rect(0, top + fh - 10, S, top + fh, [0.16, 0.18, 0.22])
    for c in range(cols):
        cv.rect(c * cw - 4, 0, c * cw + 4, S, [0.12, 0.13, 0.15])                       # mullion fins
    return cv.finish(streaks=0.0)


def punched(seed):
    cv = Canvas(seed, [0.58, 0.56, 0.52])
    floors, cols = 6, 4
    fh, cw = S / floors, S / cols
    for f in range(floors):
        for c in range(cols):
            x0, top = c * cw, f * fh
            cv.rect(x0 + cw * 0.14, top + fh * 0.14, x0 + cw * 0.86, top + fh * 0.78, [0.3, 0.29, 0.27])   # deep reveal
            light = room(cv.r, warm_bias=0.35)
            interior(cv, x0 + cw * 0.18, top + fh * 0.18, x0 + cw * 0.82, top + fh * 0.76, light, office=cv.r.random() < 0.5)
            cv.rect(x0 + cw * 0.495, top + fh * 0.18, x0 + cw * 0.505, top + fh * 0.76, [0.4, 0.4, 0.42])
            cv.rect(x0 + cw * 0.12, top + fh * 0.78, x0 + cw * 0.88, top + fh * 0.82, [0.72, 0.7, 0.66])  # sill
    return cv.finish(streaks=0.12)


def photo(name):
    """A repo night photo: albedo darkened where it is not a window; emission from its bright warm pixels."""
    img = np.asarray(Image.open(MAPS / f'{name}.webp').convert('RGB').resize((S, S), Image.LANCZOS), np.float32) / 255
    lum = img @ np.array([0.3, 0.59, 0.11], np.float32)
    mask = np.clip((lum - 0.36) / 0.3, 0, 1) ** 1.5
    emit = img * mask[..., None]
    albedo = img * (1 - 0.45 * mask[..., None])
    return albedo, emit


def save(kind, slots):
    for suffix, idx, q in (('', 0, 84), ('-emit', 1, 78)):
        atlas = np.zeros((2 * S, 2 * S, 3), np.float32)
        for k, slot in enumerate(slots):
            atlas[(k // 2) * S:(k // 2 + 1) * S, (k % 2) * S:(k % 2 + 1) * S] = slot[idx]
        Image.fromarray((np.clip(atlas, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)).save(OUT / f'{kind}-atlas{suffix}.webp', quality=q, method=6)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    save('res', [photo('tokyo-flats'), balconies(3, [0.74, 0.66, 0.55], [0.56, 0.62, 0.66], [0.8, 0.78, 0.74]),
                 balconies(8, [0.46, 0.47, 0.49], [0.86, 0.86, 0.86], [0.7, 0.7, 0.7], bars=True), corridor(13)])
    save('office', [photo('tokyo-office'), ribbon(21), curtain(34), punched(55)])
    for f in sorted(OUT.glob('*atlas*.webp')):
        print(f.name, f.stat().st_size // 1024, 'KB')
