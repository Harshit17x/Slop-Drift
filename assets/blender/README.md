# Blender source car

A high-detail Blender build of the Slop-Drift rally car. The game still generates
its car at load time in `src/render/ProceduralCar.js`; nothing in this folder is
imported by the runtime or included in the bundle. This is the editable art
source for the same vehicle, kept in the repository so the shell, cockpit and
liveries can be reworked and re-exported.

| File | What it is |
| --- | --- |
| `slop_drift_rally_car.blend` | Blender 5.3 scene, all parts in the `RallyCar` collection |
| `slop_drift_rally_car.glb` | glTF 2.0 export, metres, Y-up |
| `build_and_export.py` | builds the car, saves the `.blend`, exports the `.glb` |
| `build_rally_car.py` | geometry, materials and assembly (source of truth) |
| `render_rally_car.py` | studio lights, six cameras and the PNGs in `renders/` |
| `renders/` | `hero_front`, `hero_rear`, `side`, `front`, `top`, `cockpit` |

Previews are committed as JPEG to keep the repository small; the render script
writes PNGs, so rerunning it adds new PNGs next to them.

## Dimensions

Modelled front = +Y, up = +Z, ground = 0, and matched to the runtime car:

| Measure | Value |
| --- | --- |
| Length | 4.32 m (`y` −2.16 … 2.16) |
| Width | 1.80 m (`x` ±0.90) |
| Wheelbase | 2.55 m |
| Track | 1.56 m |
| Wheel radius / width | 0.34 m / 0.235 m |
| Roof height | 1.455 m |

## Rebuild

From the repository root, with Blender 4.2+ (built on 5.3):

```bash
blender --background --python assets/blender/build_and_export.py
blender --background --python assets/blender/render_rally_car.py
```

`build_rally_car.py` starts from an empty scene, so it is safe to rerun. The
render script adds a floor, lights and a camera on top of the built car and
writes 1280×800 PNGs; run it after the build, not before.

## What is in the model

- Lofted body shell with boolean-cut arches and an opened cabin, so the cockpit
  is visible through the glass.
- Front fascia with grille, intake slats, round lamps, indicators, splitter,
  tow hooks and badging; rear bumper, twin exhausts, tow strap and light bar.
- Roof scoop, bonnet vents, wide arch flares, side skirts, mud flaps, mirrors,
  antenna, rear wing and hatch number board.
- Eight-spoke wheels with open tyres, barrels, brake discs and lime calipers.
- Full cockpit: dash with gauges and screen, steering wheel and column, shifter,
  handbrake, pedals, centre console, seats with harnesses, door cards, cage,
  headliner, visors, mirror and dome light.
- Livery: bonnet, roof and hatch stripes, door number boards, roof plate, lime
  accents and lamp emission.

Materials are plain Principled BSDF values in linear space. Paint is
`Paint_Red` (metallic 0.25, roughness 0.42, clearcoat 0.38) so `setPaint`
recolours in game map to the same family.
