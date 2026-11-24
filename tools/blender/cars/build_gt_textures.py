"""Build clean PBR textures (albedo+mask RGBA, ORM, emissive) for Porsche 911 GT3 RS (gt).

Converts the baked LumaStudio/photogrammetry diffuse texture into de-lit PBR maps at native 2048x2048:
  - gt_albedo_mask.png (RGBA): RGB = neutral paint AO + carbon weave + smoked glass + decals + gold crest + alloy/tires;
                               A   = paintable body mask (for GT_Body) OR alloy rim tint mask (for GT_Wheel).
  - gt_orm.png         (RGB) : R = Ambient Occlusion, G = Roughness, B = Metalness.
  - gt_emissive.png    (RGB) : Front headlamp lens emission mask.
"""

import argparse
import io
import json
import os
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def extract_source_diffuse(glb_path: str) -> Image.Image:
    with open(glb_path, "rb") as f:
        data = f.read()
    json_len = struct.unpack_from("<II", data, 12)[0]
    gltf = json.loads(data[20 : 20 + json_len].decode("utf-8"))
    bin_offset = 20 + json_len
    bin_len = struct.unpack_from("<II", data, bin_offset)[0]
    bin_data = data[bin_offset + 8 : bin_offset + 8 + bin_len]
    bv = gltf["bufferViews"][gltf["images"][0]["bufferView"]]
    start = bv.get("byteOffset", 0)
    img_bytes = bin_data[start : start + bv["byteLength"]]
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


def rasterize(tris, width: int, height: int, blur: float = 0.8, dilate_px: int = 0) -> np.ndarray:
    im = Image.new("L", (width, height), 0)
    dr = ImageDraw.Draw(im)
    for tri in tris:
        pts = [(u * width, (1.0 - v) * height) for u, v in tri]
        dr.polygon(pts, fill=255)
    if dilate_px > 0:
        im = im.filter(ImageFilter.MaxFilter(dilate_px * 2 + 1))
    if blur > 0:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    return np.asarray(im, dtype=np.float32) / 255.0


def rasterize_wheel_scalar_maps(wheel_tris, width: int, height: int):
    """Barycentrically rasterize 3D (r_yz, abs_x) across wheel triangles in UV space.

    Even low-poly wheel triangles spanning the rim/tire bead produce sub-triangle
    smooth circular masks at 2048x2048!
    """
    r_map = np.zeros((height, width), dtype=np.float32)
    ax_map = np.zeros((height, width), dtype=np.float32)
    hit_map = np.zeros((height, width), dtype=bool)

    for tri in wheel_tris:
        # tri = [(u0, v0, r0, ax0), (u1, v1, r1, ax1), (u2, v2, r2, ax2)]
        x0, y0, r0, a0 = tri[0][0] * width, (1.0 - tri[0][1]) * height, tri[0][2], tri[0][3]
        x1, y1, r1, a1 = tri[1][0] * width, (1.0 - tri[1][1]) * height, tri[1][2], tri[1][3]
        x2, y2, r2, a2 = tri[2][0] * width, (1.0 - tri[2][1]) * height, tri[2][2], tri[2][3]

        denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(denom) < 1e-6:
            continue

        xmin = max(0, int(np.floor(min(x0, x1, x2))) - 1)
        xmax = min(width - 1, int(np.ceil(max(x0, x1, x2))) + 1)
        ymin = max(0, int(np.floor(min(y0, y1, y2))) - 1)
        ymax = min(height - 1, int(np.ceil(max(y0, y1, y2))) + 1)
        if xmin > xmax or ymin > ymax:
            continue

        xs = np.arange(xmin, xmax + 1, dtype=np.float32) + 0.5
        ys = np.arange(ymin, ymax + 1, dtype=np.float32) + 0.5
        gx, gy = np.meshgrid(xs, ys)

        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / denom
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / denom
        w2 = 1.0 - w0 - w1

        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not np.any(inside):
            continue

        r_val = w0 * r0 + w1 * r1 + w2 * r2
        ax_val = w0 * a0 + w1 * a1 + w2 * a2

        sub_r = r_map[ymin : ymax + 1, xmin : xmax + 1]
        sub_ax = ax_map[ymin : ymax + 1, xmin : xmax + 1]
        sub_hit = hit_map[ymin : ymax + 1, xmin : xmax + 1]

        sub_r[inside] = r_val[inside]
        sub_ax[inside] = ax_val[inside]
        sub_hit[inside] = True

    return r_map, ax_map, hit_map


def build_textures(src_glb: str, zones_path: str, out_dir: str, size: int = 2048, orm_size: int = 1024):
    os.makedirs(out_dir, exist_ok=True)
    src_full = extract_source_diffuse(src_glb)
    src = src_full if (src_full.size == (size, size)) else src_full.resize((size, size), Image.BILINEAR)
    W = H = size

    with open(zones_path, "r") as fp:
        zones = json.load(fp)

    glass_core = rasterize(zones["glass"], W, H, blur=1.0, dilate_px=1)
    glass_rim = rasterize(zones["glass"], W, H, blur=1.0, dilate_px=2)
    hl_poly = rasterize(zones["headlights"], W, H, blur=1.0, dilate_px=2)

    wheel_3d = zones.get("wheel_3d")
    if wheel_3d:
        w_r, w_ax, w_hit = rasterize_wheel_scalar_maps(wheel_3d, W, H)
        # Dilate wheel coverage 2px to cover mip seams cleanly
        rim_poly = rasterize(zones.get("rim", []), W, H, blur=0.8, dilate_px=1)
        tire_poly = rasterize(zones.get("tire", []), W, H, blur=0.8, dilate_px=1)
        is_wheel_uv = w_hit | (rim_poly > 0.25) | (tire_poly > 0.25)
    else:
        rim_poly = rasterize(zones.get("rim", []), W, H, blur=0.8, dilate_px=0)
        tire_poly = rasterize(zones.get("tire", []), W, H, blur=0.8, dilate_px=0)
        is_wheel_uv = (rim_poly > 0.30) | (tire_poly > 0.30)
        w_r = np.where(rim_poly > 0.30, 0.18, 0.30)
        w_ax = np.full((H, W), 0.12, dtype=np.float32)
        w_hit = is_wheel_uv

    arr = np.asarray(src, dtype=np.float32) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx = np.maximum(g, b)
    mn = np.minimum(r, np.minimum(g, b))
    diff = r - mx
    ratio = diff / np.maximum(0.05, r)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    chroma = np.maximum(r, mx) - mn

    yy, xx = np.mgrid[0:H, 0:W]
    u = xx / float(W)
    v_pil = yy / float(H)

    # Gold Porsche crest emblem at nose of hood
    near_crest = (np.abs(u - 0.126) < 0.015) & (np.abs(v_pil - 0.445) < 0.015)
    is_gold_crest = near_crest & ((g - b) > 0.08)

    # Smooth paint mask preserving native 2048x2048 crispness on thin GT3 RS decal outlines!
    raw_mask = np.clip((ratio - 0.15) / 0.13, 0.0, 1.0) * np.clip((diff - 0.05) / 0.075, 0.0, 1.0)

    is_glass = (glass_core > 0.40) | ((glass_rim > 0.40) & (raw_mask < 0.65))
    in_headlight = (hl_poly > 0.30) & (lum > 0.42) & (chroma < 0.14)
    in_underbody = (u < 0.63) & (v_pil > 0.70)
    in_roof_trapezoid = (u > 0.16) & (u < 0.59) & (v_pil > 0.38) & (v_pil < 0.63)

    body_paint_mask = np.where(
        is_gold_crest | is_glass | in_headlight | is_wheel_uv | in_underbody,
        0.0,
        raw_mask,
    )

    # Smooth geometric circular rim bead & spoke face mask from barycentric 3D wheel coordinates!
    # r_yz <= 0.244 is inside the alloy rim bead; r_yz >= 0.244 is rubber tire sidewall/tread!
    wheel_rim_geo = w_hit & (w_r < 0.244)
    wheel_tire_geo = is_wheel_uv & (~wheel_rim_geo)
    # Outer barrel lip (r > 0.222) and center-lock cap (r < 0.055) stay solid alloy; inner spoke gaps darken cleanly
    solid_alloy = wheel_rim_geo & ((w_r > 0.222) | (w_r < 0.055))
    spoke_lum_w = np.clip((lum - 0.105) / 0.14, 0.0, 1.0)
    spoke_weight = np.where(solid_alloy, 1.0, spoke_lum_w)
    spoke_face = wheel_rim_geo & (spoke_weight > 0.25)
    rim_mask = np.where(
        wheel_rim_geo,
        spoke_weight * np.clip((0.244 - w_r) / 0.008, 0.0, 1.0),
        0.0,
    )

    # Neutral de-lit panel AO for body paint (anchored tightly around 0.87 sRGB -> ~0.73 linear so linear subtraction removes halos cleanly!)
    paint_ao = np.clip((r * 0.65 + lum * 0.35 - 0.14) / 0.70, 0.68, 1.0)
    paint_ao = 0.80 + 0.14 * np.power(paint_ao, 0.72)

    # Subtle 2x2 diagonal carbon twill
    twill = (((xx // 2) + (yy // 2)) % 4 < 2).astype(np.float32) * 0.022 - 0.011

    glass_dark = np.where(lum < 0.14, lum * 0.28, 0.016 + np.clip(lum - 0.25, 0.0, 0.5) * 0.032)
    # Clean forged alloy on spokes + dark satin recess inside spoke gaps for crisp 3D depth
    rim_alloy = np.clip(0.68 + lum * 0.65, 0.64, 0.96)
    rim_pocket = np.clip(0.05 + lum * 0.40, 0.04, 0.14)
    rim_val = rim_pocket * (1.0 - spoke_weight) + rim_alloy * spoke_weight
    tire_val = np.clip(lum * 0.32, 0.015, 0.068)
    roof_carbon_val = 0.088 + np.clip(lum - 0.25, 0.0, 0.5) * 0.045 + twill

    trim_val = np.where(
        in_underbody,
        np.clip(lum * 0.28, 0.012, 0.05),
        np.where(
            is_glass,
            glass_dark,
            np.where(
                wheel_rim_geo,
                rim_val,
                np.where(
                    wheel_tire_geo,
                    tire_val,
                    np.where(
                        in_roof_trapezoid,
                        np.where(lum < 0.20, lum * 0.50, roof_carbon_val),
                        np.where(
                            in_headlight,
                            np.clip(0.80 + (lum - 0.42) * 0.36, 0.80, 0.98),
                            np.where(lum < 0.16, lum * 0.48, 0.060 + (lum - 0.16) * 0.26 + twill),
                        ),
                    ),
                ),
            ),
        ),
    )

    clean_nonpaint = np.where(
        is_gold_crest[..., None],
        arr,
        np.repeat(np.clip(trim_val, 0.012, 0.98)[..., None], 3, axis=-1),
    )
    out_rgb = (
        clean_nonpaint * (1.0 - body_paint_mask[..., None])
        + np.repeat(paint_ao[..., None], 3, axis=-1) * body_paint_mask[..., None]
    )

    combined_mask = np.maximum(body_paint_mask, rim_mask)

    # ORM: R = AO, G = Roughness, B = Metalness
    orm_ao = np.where(body_paint_mask > 0.5, paint_ao, np.clip(0.55 + lum * 0.55, 0.38, 1.0))
    nonpaint_rough = np.where(
        is_glass,
        np.where(lum < 0.14, 0.42, 0.03),
        np.where(
            spoke_face,
            0.20,
            np.where(
                wheel_rim_geo,
                0.55,
                np.where(
                    wheel_tire_geo,
                    0.88,
                    np.where(
                        in_headlight,
                        0.05,
                        np.where(
                            in_underbody | (lum < 0.16),
                            0.88,
                            np.where(in_roof_trapezoid, 0.34, 0.38),
                        ),
                    ),
                ),
            ),
        ),
    )
    orm_rough = body_paint_mask * 0.16 + (1.0 - body_paint_mask) * nonpaint_rough
    nonpaint_metal = np.where(
        spoke_face,
        0.88,
        np.where(
            wheel_rim_geo,
            0.35,
            np.where(
                is_glass,
                np.where(lum < 0.14, 0.0, 0.18),
                np.where(
                    wheel_tire_geo,
                    0.0,
                    np.where(in_underbody | in_roof_trapezoid | in_headlight | (lum < 0.18), 0.0, 0.08),
                ),
            ),
        ),
    )
    orm_metal = (1.0 - body_paint_mask) * nonpaint_metal

    # Native 2048x2048 RGBA keeps 3px GT3 RS outlines crisp!
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    rgba[..., :3] = np.clip(out_rgb * 255.0, 0, 255).astype(np.uint8)
    rgba[..., 3] = np.clip(combined_mask * 255.0, 0, 255).astype(np.uint8)
    albedo_path = os.path.join(out_dir, "gt_albedo_mask.png")
    Image.fromarray(rgba, "RGBA").save(albedo_path, optimize=True)

    orm = np.zeros((H, W, 3), dtype=np.uint8)
    orm[..., 0] = np.clip(orm_ao * 255.0, 0, 255).astype(np.uint8)
    orm[..., 1] = np.clip(orm_rough * 255.0, 0, 255).astype(np.uint8)
    orm[..., 2] = np.clip(orm_metal * 255.0, 0, 255).astype(np.uint8)
    orm_path = os.path.join(out_dir, "gt_orm.png")
    Image.fromarray(orm, "RGB").resize((orm_size, orm_size), Image.BILINEAR).save(orm_path, optimize=True)

    em_arr = np.where(in_headlight, np.clip((lum - 0.42) * 1.9, 0.25, 1.0), 0.0)
    em_rgb = np.zeros((H, W, 3), dtype=np.uint8)
    em_rgb[..., 0] = np.clip(em_arr * 255.0, 0, 255).astype(np.uint8)
    em_rgb[..., 1] = np.clip(em_arr * 246.0, 0, 255).astype(np.uint8)
    em_rgb[..., 2] = np.clip(em_arr * 232.0, 0, 255).astype(np.uint8)
    em_path = os.path.join(out_dir, "gt_emissive.png")
    Image.fromarray(em_rgb, "RGB").resize((512, 512), Image.BILINEAR).save(em_path, optimize=True)

    return albedo_path, orm_path, em_path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--zones", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--size", type=int, default=2048)
    args = p.parse_args()
    a, o, e = build_textures(args.src, args.zones, args.out, size=args.size)
    print("Built:", a, os.path.getsize(a), o, os.path.getsize(o), e, os.path.getsize(e))


if __name__ == "__main__":
    main()
