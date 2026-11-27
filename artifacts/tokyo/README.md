# Tokyo After Hours · 東京・深夜

Select **Tokyo After Hours** in the map chooser. **City Explorer** starts in Shibuya. Follow the Shibuya circuit to the signed parking entrance and enter at 1F. Turn onto the oval to climb to 7F or descend to B2. **Night guide** holds activities, camera angles, JPEG export, weather, parking density and four original radio stations.

![In-game view from Shibuya](night-drive.jpg)

## Road network

The city uses metre-scale Three.js geometry. These distances were measured from the shipped centreline samples, including changes in elevation.

| Route | Distance | Connection |
| --- | ---: | --- |
| Shibuya Neon Circuit | 2,998 m | Shares Shibuya Crossing with the main loop and branches to the parkade |
| Tokyo Midnight Circuit | 4,998 m | Connects Shibuya, Minato, Electric Town and the auto meet |
| Metropolitan Expressway | 9,000 m | Branches from the main loop, climbs to 19 m and descends into the tunnel |
| Tokyo Bay Run | 3,999 m | Connects the main loop to the docks and gymkhana apron |
| Grand Tokyo Tour | 14,993 m | Pins the long circuit to junctions in the other districts |
| Midnight Parkade | 2,263 m | One continuous two-way oval with a street entrance at 1F |
| Underground Echo | 2,190 m | Timed sector of the expressway |

Four service streets link the circuits. Road queries include vehicle height so two decks can overlap in plan without exchanging wheel contacts, checkpoint progress or recovery positions. Barriers have openings where roads meet at the same height. The garage uses a 110 × 58 m centreline oval. Each turn includes a level landing and a smooth 5.6 m rise. B2 starts 11.2 m below street level and the 7F rooftop is 33.6 m above it. A seeded parking layout is used during competition. Free roam draws a fresh layout from marked bays at the chosen density.

## Street stops and drift sectors

Pull up beside a signed counter in City Explorer. Four stamps complete the After Hours Stamp Rally. At the Shinjuku food stall, pick up a ramen order and deliver it to the Pit Lane counter at the Midnight Auto Meet in 180 seconds. Returning to Pit Lane also lets you challenge Akatsuki. The expressway speed camera records passing speed. Three marked scoring sectors on the Shibuya, bay and downtown circuits score drift angle, speed and time on the ground. Amber lights turn turquoise during a drift. A hard impact clears the current score. Sector records, best delivery time and camera speed save locally.

[Arcade counter](arcade-counter.jpg) · [Lantern Alley](lantern-counter.jpg). Four new original ImageGen textures depict a grill, arcade, workshop and apartments. Sidewalk pedestrians, a second row of buildings, projecting signs, utility pipes, deck markings and soft lamp halos add depth. The food stalls and the roadside meet draw on [GO TOKYO’s yokocho guide](https://www.gotokyo.org/en/story/guide/drink-and-dine-like-a-local-a-guide-to-exploring-yokocho-alleyways/index.html) and [Genki’s description of Tokyo Xtreme Racer](https://store.steampowered.com/app/2634950/).

## Night-city fabric

The block edges no longer open onto empty ground. `sealFrontages()` tests every frontage segment and closes it with a walled service alley, a back wall, a yard, or a low-rise backdrop; street mouths and junctions are left open. `dressJunction()` then builds nine at-grade crossings with corner blocks, raised aprons, crosswalks, stop lines and signal heads. Wide service walls carry pipe runs, condensers, lit service windows, upper windows, fire escapes, rooftop gear and signage. No gap between buildings shows the horizon void, and all four corners of every intersection are restricted by construction or frontage.

Street furniture includes lane dashes, tactile paving, expansion joints, manholes and drains, parking slots, utility poles and catenary wires, traffic signals, street lamps and overhead direction gantries. Pedestrians walk the raised pavement in groups of three; the pool is capped so the crowd adds no draws. Tokyo asphalt is deliberately matte (`roughness .88`, `metalness .02`, `envMapIntensity .32`); rain raises the sheen through puddle films instead of turning the carriageway into a mirror.

The Bay Run encloses a true water basin. The quay walk, causeway embankments, dock pier, barges, buoys, fishing boat and container gantries were rebuilt around it; the city ground plane is cut over the basin and pavement tiles that would float on water are skipped. The elevated span has weathered parapets with coping and expansion joints, two lit overhead direction gantries, and catenary lamps mounted on the bridge shoulder rather than floating beside it.

[Elevated bay span](night-elevated.jpg) · [Junction approach](night-junction.jpg) · [Bay circuit at night](night-harbour.jpg)

## Activities

The race menu includes Neon Crown, Downtown sprint and endurance, the expressway, the bay circuit, Underground Echo, Grand Tokyo Tour and the full garage ascent and descent. The Night Guide adds eight-district exploration, four-district photography, three Tower viewpoints, three workshop discoveries, the eight-deck championship, a timed B2 drift challenge, a rooftop drift unlock, dockside gymkhana, a rival race and two tandem challenges. Completing the tower photography journal unlocks Minato Gold in the garage. Discovery, completion, reward and preference data use the game's career store and a local Tokyo passport.

## Art, signage and audio manifest

| Assets | Source and use |
| --- | --- |
| `src/assets/maps/tokyo-{office,shops,ramen,market}.webp` | Four original ImageGen facade tiles, 512 × 512 each. Applied to street-level retail and office meshes. |
| `src/assets/maps/tokyo-ad0.webp` through `tokyo-ad3.webp` | Four original ImageGen billboard panels, 512 × 512 each. Billboards rotate through the four designs. |
| `src/assets/maps/tokyo-skyline.webp` | Original generated panoramic skyline, 2,172 × 724. Used for the distant city and car reflections. |
| `src/assets/maps/tokyo-tower.glb` | Original Blender mesh with three materials, 2,232 vertices and 1,472 source polygons. Rebuild with `make_tower(destination)` in `tools/blender/tokyo/tower.py`. The model is scaled to the Minato sightline. |
| `tokyoKit.js`, `TokyoCity.js`, `TokyoLife.js`, `tokyoRoads.js` | Original procedural street furniture, parked coupes and hatchbacks, parking decks, taxis, train, dock props, lighting, signage and road meshes. |
| `TokyoSound.js` | Original synthesized radio phrases and environmental cues. Garage and tunnel returns use the game's existing engine and tyre audio. |
| `src/assets/maps/previews/tokyo.jpg` and the gallery below | Captures from the actual WebGL scene. |

Navigational and primary storefront lettering is drawn from Unicode strings using system Japanese font fallbacks. Examples include 喫茶つばき (Tsubaki Coffee), 北口書店 (North Exit Books), 入口 (entrance), 出口 (exit) and 屋上展望台 (rooftop observation deck). Bilingual signs supplement vertical shop blades. Small print baked into decorative generated textures has not been copy-edited in Japanese.

The new art and audio were authored for this project. The reference photographs, movie material, commercial game audio and extracted game models are excluded from the assets. The game's existing cars, fonts and dependencies retain their existing licensing terms.

## In-engine location gallery

| Street districts and landmarks | Garage levels |
| --- | --- |
| [Shibuya Crossing](shibuya.jpg) · [Minato and Tokyo Tower](minato.jpg) | [B2](b2.jpg) · [B1](b1.jpg) |
| [Akihabara Electric Town](akihabara.jpg) · [Shinjuku Backstreets](shinjuku.jpg) | [1F](1f.jpg) · [2F](2f.jpg) |
| [Expressway](expressway.jpg) · [Tunnel](tunnel.jpg) | [3F](3f.jpg) · [4F](4f.jpg) |
| [Tokyo Bay](bay.jpg) · [Midnight Auto Meet](meet.jpg) | [5F](5f.jpg) · [6F](6f.jpg) · [7F rooftop](roof.jpg) |

## Implementation and verification

- [x] Based on owner main `fe27e49`. Map selection, roads, layered wheel contact, camera, checkpoint timing and minimap integrate with the shared game. Tokyo-specific scenery, missions and audio live in separate modules.
- [x] All eight distinct courses completed with the scripted driver and zero respawns. The ascent and descent each cleared 30 checkpoints. The garage tests sample ground and progress every 2 m and settle the vehicle on all nine levels.
- [x] Regraded three crossings and tested clearance at road edges. Tested rotated shop corners, a 144 km/h sideways vehicle impact, the upper flyover shoulder, and garage terminal stops.
- [x] Sampled all roads for obstacles at 4 m intervals on the centreline and two parallel lines 2 m to either side. Verified both traffic modes, the three phases of passing showers, seven photo captures, the reward conditions and persistence of all 12 Night Guide activities. Mission checks use controlled location and drift inputs. Course completion uses the vehicle simulation.
- [x] Frontage and junction audit: 746 gaps sealed, 48 street mouths kept open, 22 corner treatments, 31 signals, 33 crossings, 702 shopfronts and 348 dressed wide walls, with 0 missed frontage samples.
- [x] Road-intrusion rescan with full-footprint sampling: 0 solids intersect any road centreline. Deck-versus-ground scan found 0 mismatches over 0.28 m, and a 1 m-step drive simulation over every road produced no vertical jump over 0.10 m.
- [x] Harbour audit: the basin contour has 334 points and 0 self-intersections; the triangulated surface is 332 triangles with 0 uncovered cells at dense sampling. Quay, causeways, pier and the elevated span were inspected at driver height and from free camera.
- [x] Performance sweep over 56 bay and district camera poses at 1280 × 720: worst case 488 draws and 625,456 triangles; Shibuya, junctions 0/5/7, district links and the parkade measured 216–394 draws. All poses stay under the ~715 draw budget.
- [x] Production Vite build and full repository test command pass. To reproduce the browser run, set `TOKYO_ACTIVITIES=1` and `TOKYO_DRIVE=1`, then run `node artifacts/tokyo/verify.cjs` from the project. The verifier uses Chrome and accepts a `CHROME_PATH` override.
- [x] Tested the garage start on Intel UHD Graphics through Chrome/ANGLE D3D11, Low quality, at 942 × 504. The final 90-frame samples measured 16.6 ms median and 17.7 ms p95 at the garage start (280 draws, 337,514 triangles), and 16.7 ms median and 17.4 ms p95 at the free-roam Shibuya start (484 draws, 445,708 triangles). District geometry batches, nearby-deck visibility and three reused point lights bound the active scene.
- [ ] Visual and device follow-up. Building modules repeat along long stretches, the far skyline is a panorama, exhibition crowds are static, and service taxis follow fixed routes. Reflected sign light is approximated. The existing racing ghosts and still-photo tools are available. A cut-edited cinematic replay director, extended memory soak, mobile GPU benchmark and live multiplayer validation remain outstanding. The shared production bundles trigger Vite's 500 kB advisory. Intel's shader compiler also emits precision warnings.

Shibuya's sign hierarchy, the expressway's long sightlines and the transition from street races to a quieter car meet informed the layout. The city uses fictional shops and route geography. [GO TOKYO · Shibuya Center-Gai](https://www.gotokyo.org/en/spot/88/index.html) · [Metropolitan Expressway driving guide](https://www.shutoko.jp/ss/shutokodeikou/special/driving_tokyo/en.html) · [Need for Speed Heat manual](https://www.ea.com/able/resources/need-for-speed/need-for-speed-heat/pc/text-manual) · [Genki · Tokyo Xtreme Racer](https://store.steampowered.com/app/2634950/Tokyo_Xtreme_Racer/)
