# Hollow Creek field guide

Select **Hollow Creek → Free Roam** to start at The Last Garage. Open **Garage radio** to accept a dispatch, review your journal counts, save a photograph from the current camera, or adjust wind, drone, environmental sounds, jump scares and weather detail. Setting Jump scares to zero silences the surprise stinger. The game’s master volume applies to the entire mix.

## Driving routes

| Circuit | Surveyed 3D centreline | Intermediate race gates | Automated lap |
|---|---:|---:|---:|
| The Forgotten Quarter | 3,000 m | 8 | 100 s |
| Hollow Creek Circuit | 5,002 m | 15 | 159 s |
| The Vanishing Road | 6,992 m | 21 | 273 s |

Six cross streets connect the circuits at grade. A seventh road branches inside Signal Tunnel and rejoins the outer loop beyond the mine. A service shutter opens during the Forgotten Route dispatch or a rare repeat tunnel visit in exploration. Ordered race gates use the existing RaceSession travel checks. The quarter has wet setts, downtown has patched asphalt, and the outer road crosses gravel, mud and timber.

## Dispatch board

| Mission | Completion condition |
|---|---|
| The Last Transmission | Tune five receivers and read the intercepted messages. |
| Phantom Pursuit | Rendezvous with a ghost car, follow it down a connecting street and reach its destination. |
| Into the Mist | Finish the outer rally as visibility falls with checkpoint progress. |
| Midnight Delivery | Pick up the parcel at the garage and reach the hospital within 180 seconds. |
| Echoes of the Past | Recover dispatch records at the station, hospital and waterfront. |
| Ghost Circuit | Finish a main-loop race with a recorded opponent. A first solo lap supplies a local baseline. |
| The Forgotten Route | Find the gallery, enter the cutting and reach its far exit. |
| Drift After Dark | Bank 120 drift points in each of Clock Square, the station district and the factory arena. |
| The Lost Driver | Follow tyre marks and the railway transmission to the coupe inside the factory. |
| Last Light | Visit the fuel station, church and garage during a blackout. |
| Urban Explorer | Discover all eight locations in any order. |
| Escape the Fog | Cross the ordered stage controls from the quarter through town to the outer mill. |

The journal stores discoveries, active exploration objectives, opened passage, completed dispatches and field settings in local browser storage. Timed races restart from the grid. First mission completions award career XP. Discovering the fuel station unlocks the Saltline Service striped livery in the garage. Finding every landmark awards Town Archivist.

## Encounters and locations

Free Roam schedules the Watcher, a non-colliding Phantom Driver, district blackouts, Unknown Frequency and rare impact stingers using a session seed, distance tests, probabilities and cooldowns. The Watcher fades on approach. Signal Tunnel changes its lamps on return visits. Ghost Railway adds a whistle and distant signal lights. The surprise scheduler stays off during competitive laps.

The eight discoverable sites are the garage, gas station, church, railway station, hospital, mine, waterfront and open-sided factory. Church bells, a waterfront horn, radio static, station tones, sign creaks, drops, wind and a low detuned pad share the game’s audio output. Radio transmissions appear as text over procedural interference. Dispatch navigation shows the bearing and straight-line distance to the current objective.

## Assets and implementation

The supplied images guided the palette, overcast streets, timber porches, weathering and dock composition. Bodie’s preserved ghost-town streets provided secondary architectural reference. [National Park Service](https://www.nps.gov/places/bodie-historic-district.htm)

Original ImageGen facade and asphalt images are stored as compressed WebP textures. The slate and sett textures combine the generated surface with procedural tile patterns. Local Blender 5.3 MCP produced the missing coupe GLB with seven materials and 973 authored polygons. The environment reuses the game's foliage atlas and ghost vehicle renderer. All new environmental audio is synthesized with Web Audio. The district photographs in this folder are game renders.

World generation, surveyed sites and the service road live in `src/world/HollowCreek.js` and `src/world/hollowSites.js`. Rendering uses 100 m instance groups, distance culling, a shared facade atlas, fog sprites and a quality-scaled weather pass. The dispatch board, journal and simulation live in the Hollow modules under `src/game`, `src/ui` and `src/audio`.

## Verification

- The repository test suite and Vite production build passed.
- The Hollow Creek regression test surveys actual 3D lengths, every connector endpoint, ground contacts, surface materials, mine shutter collision and journal persistence.
- The local Chrome harness drove all three official circuits with the vehicle simulation. It also ran both race dispatches, including a recorded ghost, and exercised all twelve completion paths. It placed the car at exploration targets and supplied banked points for the district drift checks.
- Browser checks exercised the Watcher fade, ambient phantom, blackout, static, tunnel reveal, jump-scare mute, saved journal and equippable paint reward.
- Intel UHD Graphics, Chrome D3D11, Low quality, 942 × 504. A 180-frame driving sample ending at 115 km/h measured 16.7 ms median and 17.6 ms at the 95th percentile. A separate downtown camera sample showed 73 draw calls and about 181,200 triangles.
- The capture harness starts a temporary loopback Vite server. Run `node artifacts/hollow-creek/verify.cjs` from the repository with Chrome available. Set `CHROME_PATH` for another installation.

The frame sample covers a short drive. Higher resolutions and quality presets still need profiling. The architecture reuses visible modules, wet-road highlights use environment lighting, and fog uses distance and sprite layers. Human driving difficulty, audio balance on headphones, and resemblance to the photographic references remain playtest judgments.

## Captures

[Residential](residential.jpg) · [Downtown](downtown.jpg) · [Clock Square](clock-square.jpg) · [Railway station](station.jpg) · [Waterfront](waterfront.jpg) · [Industrial district](factory.jpg) · [Factory interior](lost-coupe.jpg) · [Mining gallery](mine.jpg) · [Forest road](forest.jpg)
