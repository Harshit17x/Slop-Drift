# Mussoorie map: Blender pipeline

The Mussoorie map is authored in Blender and exported as three files in
`src/assets/maps/mussoorie/`, which the game loads at start-up (`src/world/maps.js`).

| File | What it holds |
|---|---|
| `map.json` | The three roads (centrelines and heights), the summit plaza, the water level, building placements with their footprints, and landmark labels. |
| `terrain.bin` | 641 × 641 heights at 4 m spacing, stored as uint16. |
| `props.glb` | One mesh per prototype building. |

## Files

- `mussoorie.blend` is the authored scene. Open it to edit the map.
- `build_map.py` regenerates the whole scene from the layout tables at its top: the ridge crest, road control points, knobs and lakes.
  - **It deletes and rebuilds the MSR_ collections**, so hand edits are lost. Run it only to start over or after changing those tables.
- `export_map.py` writes the three game files from whatever is in the scene now.

## Editing the map

1. Open `mussoorie.blend`.
2. Make your changes. Each of these survives export:
   - **Terrain:** sculpt `Terrain` freely. The exporter ray-casts it if the grid has changed.
   - **Roads:** move points of `Road_Loop` (the closed Mall Road / Camel's Back circuit) `Road_Spur` (the Landour climb to Lal Tibba) and `Road_Peak` (the Nag Tibba switchbacks). Their heights are re-graded in the game to a maximum of 10.5 %.
     - The spur must still start on the loop and end at the plaza.
   - **Buildings:** move, rotate, duplicate (Alt+D) or delete objects in `MSR_Placements`.
     - The game drops any building whose footprint lands on a road.
     - New prototypes go in `MSR_Props` with a custom property `msr_size = [w, d]` (footprint in metres). The street facade faces local −Y.
3. Export with `export_map.py`. Either:
   - run it from Blender's Scripting tab, or
   - send it over the BlenderMCP socket.
4. Run the tests, then reload the game:

   ```bash
   node tests/map.test.mjs
   ```

The tests check grades, hairpin radii, that the asphalt is unbroken, that buildings stay off the road, and that the spawn points are clear.

## The Nag Tibba peak road

`PEAK` at the top of `build_map.py` sets the cone and the switchback stack:
- `height`, `radius`, `power` and `round` shape the cone.
- `hairpin` is the bend radius.
- `drift` is how far each leg moves up the slope.
- `leg` is the target length of each leg.
- `top` is where the last hairpin sits; a straight run finishes the climb to the summit.

Keep the road's average grade under about 9%, or the game's 10.5% limit will leave it in deep cuts. The build prints the road's length and height range so you can check.

## Conventions

- **Axes:**
  - Blender: +X east, +Y north, +Z up.
  - Game: +X east, −Z north, +Y up.
- **Heights:** game y maps to displayed altitude as `y / 0.55 + 1650` m. Lal Tibba reads about 2,225 m.
- **Size:** the map is 2.56 km square. Keep roads inside ±1,150 m, because the framing ranges rise beyond that.
