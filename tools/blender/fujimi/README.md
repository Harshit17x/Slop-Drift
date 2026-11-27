# Fujimi Rally: Blender pipeline

Fujimi Rally (富士見, "Fuji view") is a compact, daytime drift and rally course on reclaimed land by Tokyo Bay. It is a 2.56 km closed loop:

- **Waterfront straight** (460 m), heading straight at Mount Fuji.
- **Fuji Bowl:** a 42 m constant-radius sweep, wide enough for two cars to drift side by side.
- **Canal Crest:** the north straight rises 3.5 m on retaining walls.
- **Container Snake:** a 314 m gravel rally sector through the container yard. Its physics surface is `SURFACE.GRAVEL`. A 3 m rally hump sits in the middle, the shoulders carry loose rocks, and dirt is dragged onto the tarmac at the exit.
- **Hills:** the lap climbs and drops on four hills: the raised Fuji Bowl (2.5 m), Neon Hill (4.5 m), Canal Crest (6 m) and the gravel hump (3 m). The maximum grade is 6.3 %. Tarmac hills stand on retaining walls; the gravel hump sits on earth banks.
- **Obstacles:** a slalom of three tyre islands on the waterfront straight and four boulders that pinch the gravel. All are solid, and each leaves a lane of at least 3 m.
- **Clipping zones:** eight of them, which glow and pay a bonus when you drift through.

## Files

The map is authored in Blender and exported as two files in `src/assets/maps/fujimi/`:

| File | What it holds |
|---|---|
| `layout.json` | The 2 m track centreline with crest heights, the gravel and crest ranges (metres along the lap), every prop placement grouped by prototype, the drift zones, the tower position and labels. |
| `fujimi.glb` | Geometry only (meshopt, no normals, no images; about 1.5 MB). It holds the drift kit, warehouses and street lamps as prototypes, plus the city, Mount Fuji, the retaining walls, the dirt and the tyre marks as placed meshes. |

The city has about 490 buildings on a 64 m street grid, kept within `REACH` (170 m) of the track. Lamps stay within 120 m. There is no far skyline: past the rally area, only Mount Fuji and the tower stand out.
- Narrow neon multi-tenant blocks, glass office towers, apartments and low shops.
- Shopfronts with awnings, rooftop plant and water tanks, aviation lights and crown lights.
- Rooftop billboards and vertical neon blade signs.
- About 290 street lamps.
- **Green space:** the open ground around the rally area is lawn, with about 730 trees (round street trees, columnar trees, Japanese black pines, cherry trees and bushes) across the parks and along the pavements. Trees never sit on the road, its walls or banks, a building lot, a street carriageway or another prop. The game welds and smooth-shades their canopies.
- It is merged into 700 m chunks, so it costs a handful of draw calls per material.

The game supplies every texture by material name (`src/render/FujimiScene.js`):

| Material | Texture |
|---|---|
| `FJ_tex_office` | `fujimi/office-atlas.webp`: the office photo plus ribbon windows, a blue curtain wall and a punched concrete grid |
| `FJ_tex_res` | `fujimi/res-atlas.webp`: the apartment photo plus tiled balconies, grey slab balconies and an open-corridor side |
| `FJ_fuji` | `fujimi/fuji.webp`, Mount Fuji baked by moonlight |
| `FJ_dirt` | Soft-edged grime decals |
| `FJ_tex_shops` | An atlas of the grill, convenience store, ramen, game centre, workshop and neon multi-tenant art |
| `FJ_tex_signs` | The four original ads plus eight neon blade signs |
| `FJ_glow` | Unlit vertex-colour neon |

**Facades.** `make_facades.py` (numpy and Pillow, run outside Blender) builds the two facade atlases. Each has a night mask (`*-emit.webp`), so only lit windows glow and walls stay dark under the street lights. A facade UV is `(slot × 100 + u, v)`: the game's shader picks the slot, tiles it with `fract()`, and dims or brightens each building's windows by its vertex tint. Nearby apartments get real balcony slabs on the texture's floor lines and roof parapets, and nearby offices sit on podiums with lit lobbies.

**Mount Fuji.** A ridged value-noise height function shapes the mountain: radial gullies, a crater, and the Hōei shoulder on the south-east flank. `build_fujimi.py` bakes it into a 2048 px texture in the same morning sun the game uses (azimuth 115°, elevation 38°; `FUJIMI_OVERRIDES` in `Atmosphere.js`) with snow fingers down the gullies, and draws it on an 18k-triangle mesh.

The road uses the Mussoorie asphalt, the shoulders and the gravel sector use the gravel texture, and the Tokyo skyline panorama provides the reflections.

## Rebuild or edit

1. **Build.** Run `build_fujimi.py` in Blender (Scripting tab, or over the BlenderMCP socket).
   - It rebuilds the `FJ_` collections in the scene **Fujimi**.
   - Any hand edits are lost.
   - Change the layout through `CONTROL` (track control points, in travel order) and the constants at the top.
2. **Edit by hand (optional).** Changes in `fujimi.blend` survive export:
   - Move, duplicate (Alt+D) or delete objects in `FJ_Placements`.
   - Move vertices of `FJ_Road`, keeping their order.
   - Move the zone empties in `FJ_Zones`.
3. **Export.** Run `export_fujimi.py`. It writes both game files and saves `fujimi.blend`.
4. **Test.** Run the Fujimi tests:

   ```bash
   node tests/fujimi.test.mjs
   ```

   They check:
   - the course length and its tightest corner;
   - that no scenery sits on the asphalt;
   - that the barrier meshes sit on the collision line;
   - the drift zones;
   - that a car settles at the start and stays inside the barrier after a side hit.

## Conventions

- **Axes:** Blender +X east, +Y north, +Z up. Game +X east, −Z north, +Y up.
- **Prototypes:** sit at their own origin. Their street face is local −Y.
- **Barriers:** the collision line is `halfWidth + shoulder + railOffset` = 8.15 m from the centreline. Barrier meshes stand just outside it.
- **Mount Fuji:** stands 3.4 km west-south-west of the course. The game keeps the far plane at 5.2 km or more on this map so that Low quality still shows it.
