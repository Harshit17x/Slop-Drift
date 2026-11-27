# Apex asset manifest

The new fictional teams, facility signs and sponsor treatments were drawn for the game. The Apex opponent car is built entirely from dimensions and cross sections in the included Blender script. Circuit research and simulator screenshots informed design decisions. Their geometry, branding, audio and textures are not distributed in this pack.

| Asset | Source and processing | Shipped specification |
|---|---|---|
| apex-grid-gt.glb | Original Blender mesh built by grid_lod.py. Independent fictional design with wheel arches, glazing, brake ducts, splitter, wing, lenses and door numbers. | 8,120 triangles, 6 material primitives, approximately 4.60 m long × 2.32 m wide including mirrors × 1.20 m high. |
| apex-grid-distant.glb | Same source design before the close-up edge treatment. The renderer changes LOD beyond 52 m with hysteresis. | 1,984 triangles, 6 primitives. One shared geometry set for all seven opponents. Number plates use a separate shared mesh and seven small canvas textures. |
| apex-pylon.glb | Original structure and materials authored by timing_pylon.py. Its face uses live session data. | 804 triangles, 4 materials, 6.00 m wide × 28.95 m high × 3.40 m deep. |
| apex-woodland.webp | Original generated tree imagery. pack_foliage.py removes the pale matte and supplies alpha for all four silhouettes. | 1024 × 1024 RGBA, 315,088 bytes. Instanced by woodland stand, mipmapped, density scaled. |
| apex-garages.webp | Original generated interior photographs converted to a four-cell atlas. Applied to actual garage bays, gallery and shutters. | 1024 × 1024, 154,840 bytes. Shared across 40 bays. |
| apex-cut-rock.webp | Original ImageGen stone material generated for this circuit, resampled and encoded to WebP. Applied to exposed slopes and outcrop geometry. | 768 × 768, 208,778 bytes. The terrain shader blends projections. Rocks reuse the colour texture for relief. |
| apex.jpg and circuit photographs | Direct captures of the running SlopDrift renderer. | Map preview 780 × 435. Evidence images retain the capture viewport. |
| Track, facilities and countryside | Original spline survey, slab and kerb ribbons, instanced venue architecture, seating, people, vehicles, flag boards, screens, fields, plants and shoreline. Authored in Apex.js and src/render/Apex* modules. | Roads split into 140-segment render chunks. Venue props split into 128 m cells. Outcrops and undergrowth use different culling distances. |
| Track surfaces | The existing project asphalt, relief and grain generators supply shared maps. Apex adds material bands, weather, physical surface classification and local rubber accumulation. | GPU rubber field has 512 stations per physical ribbon. |
| Audio and radio | Original procedural ambience using Web Audio, the game's existing vehicle audio and its environment bus. Optional spoken messages use locally installed English speech voices. | No new sampled commercial audio. Weather and opponent sound sources are pooled. Volume follows the game mix. |
| Interface | Existing SlopDrift UI fonts and original canvas number plates, map traces, section signs and display graphics. | Fonts retain the project's existing attribution. No licensed series or sponsor logo is introduced. |

Asset provenance describes the files introduced for Apex. It makes no independent rights determination for vehicles or tracks that were already available in the base game.
