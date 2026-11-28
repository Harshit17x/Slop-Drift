# Hollow Creek field guide

Select **Hollow Creek → Free Roam** to start at The Last Garage. Open **Garage radio** to accept a dispatch, review your journal counts, save a photograph from the current camera, or adjust wind, drone, environmental sounds, jump scares and weather detail. Setting Jump scares to zero silences the surprise stinger. The game’s master volume applies to the entire mix.

## Driving routes

| Circuit | Surveyed 3D centreline | Intermediate race gates | Automated lap |
|---|---:|---:|---:|
| The Forgotten Quarter | 3,000 m | 8 | 100 s |
| Hollow Creek Circuit | 5,002 m | 15 | 159 s |
| The Vanishing Road | 7,004 m | 21 | 233 s |

Six cross streets connect the circuits at grade. A seventh road branches off the outer loop before the mine and rejoins it beyond the mine. A service shutter opens during the Forgotten Route dispatch or a rare repeat tunnel visit in exploration. Ordered race gates use the existing RaceSession travel checks. The quarter has wet setts, downtown has patched asphalt, and the outer road crosses gravel, mud and timber.

The Vanishing Road leaves the valley at Signal Tunnel, a 600 m bore through a 168 m mountain. The road is the only lit thing in the bore: wall torches, candle stubs and the car's own headlights pick out the rock, and the far portal is a pale dot for most of the crossing. A bat colony roosts in the roof and bursts on the first entry of each run.

## Night and weather

Set the time of day to night for the intended read. Moonlight is deliberately weak, so the car's headlights, the roadside candles and the cave torches are the only meaningful sources. The terrain is raised into a massif over the cave road and closed above it, so the bore is genuinely underground rather than a cutting with a lid; the rock shell is single-sided against the culled terrain underside and is drawn with faceted normals so the headlights catch broken rock instead of a smooth tube.

Lightning fires at random intervals of 13 to 35 seconds. A strike flashes a cloud sphere and a directional light, draws a jagged bolt at 0.5 to 2.4 km, and queues thunder at the speed of sound, so the report arrives late and is muffled inside the cave. Rain, ground mist and the flash all stop at the portal.

A sparse scatter of candles, skeletons, pumpkins, graves, scarecrows and abandoned cars dresses the verges, with a graveyard cluster, a pumpkin patch and a roadside campsite. The railway station at the 1590 m mark is abandoned: a goods shed, a platform and canopy, and a rusted locomotive with three carriages standing on the road side of the platform under a single flickering oil lamp.

The outside of the Vanishing Road has 6.86 km of steel barrier and reflectors. Access gaps serve the intersections and yards. In free roam, four seconds beyond the drivable district returns the car to its last grounded road and heading.

## Dispatch board

| Mission | Completion condition |
|---|---|
| Dead Letter Run | Stop at the parcel office, Bell Street Pharmacy and chain ferry to trace a missing prescription. |
| The Empty Shift | Read the shift ticket at the assembly hall, Incline No. 2 and the mine. |
| The Last Transmission | Tune five receivers and read the intercepted messages. |
| Phantom Pursuit | Rendezvous with a ghost car, follow it down a connecting street and reach its destination. |
| Into the Mist | Finish the outer rally as visibility falls with checkpoint progress. |
| Midnight Delivery | Pick up the parcel at the garage and reach the hospital within 180 seconds. |
| Echoes of the Past | Recover dispatch records at the station, hospital and waterfront. |
| Ghost Circuit | Finish a main-loop race with a recorded opponent. A first solo lap supplies a local baseline. |
| The Forgotten Route | Find the cave mouth, enter the cutting and reach its far exit. |
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

The Bell Street frontage draws on stocked ghost-town shops and the parcel siding draws on a railway commercial district. The mine headframe, suspended skips and haul cables take their cues from aerial copper-ore tramways. [Bodie State Historic Park](https://www.parks.ca.gov/pages/509/files/BodieSHPFinalWebLayout2016.pdf) · [Thurmond Historic District](https://www.nps.gov/neri/learn/historyculture/thurmond.htm) · [Kennecott Mines](https://www.nps.gov/places/kennecott-mines.htm)

The supplied images guided the palette, overcast streets, timber porches, weathering and dock composition. Bodie’s preserved ghost-town streets provided secondary architectural reference. [National Park Service](https://www.nps.gov/places/bodie-historic-district.htm)

The new ImageGen trade sheet contains the pharmacy, parcels counter, oxidised metal and damp fieldstone. A second sheet contains an isolated elm and willow. The town renders both as compressed WebP atlases. The four-wheel parcels van, mine headframe and chain winches use instanced parts.

Original ImageGen facade and asphalt images are stored as compressed WebP textures. The slate and sett textures combine the generated surface with procedural tile patterns. Local Blender 5.3 MCP produced the missing coupe GLB with seven materials and 973 authored polygons. The environment reuses the game's foliage atlas and ghost vehicle renderer. All new environmental audio is synthesized with Web Audio. The district photographs in this folder are game renders.

World generation, surveyed sites and the service road live in `src/world/HollowCreek.js` and `src/world/hollowSites.js`. Rendering uses 100 m instance groups, distance culling, a shared facade atlas, fog sprites and a quality-scaled weather pass. The dispatch board, journal and simulation live in the Hollow modules under `src/game`, `src/ui` and `src/audio`.

## Verification

- The repository test suite and Vite production build passed.
- The Hollow Creek regression test surveys actual 3D lengths, every connector endpoint, ground contacts, surface materials, mine shutter collision guardrail contact normals, landmark access, turning aprons and journal persistence. It also asserts that the massif closes over the cave road, that the approach outside the portal stays open, that the bore exceeds 500 m and that its section clears the carriageway.
- The local Chrome harness drove all three official circuits with the vehicle simulation. It also ran both race dispatches, including a recorded ghost, and exercised all fourteen completion paths. It placed the car at exploration targets and supplied banked points for the district drift checks.
- Browser checks exercised the Watcher fade, ambient phantom, blackout, static, tunnel reveal, jump-scare mute, saved journal, equippable paint reward, parked-only logbook reading and off-map recovery on a two-way connector.
- Intel UHD Graphics, Chrome D3D11, Low quality, 942 × 504. A 180-frame driving sample ending at 115 km/h measured 16.9 ms median and 20.6 ms at the 95th percentile. A separate downtown camera sample showed 92 draw calls and about 222,400 triangles.
- The capture harness starts a temporary loopback Vite server. Run `node artifacts/hollow-creek/verify.cjs` from the repository with Chrome available. Set `CHROME_PATH` for another installation.

The frame sample covers a short drive. Higher resolutions and quality presets still need profiling. The architecture reuses visible modules, wet-road highlights use environment lighting, and fog uses distance and sprite layers. Human driving difficulty, audio balance on headphones, and resemblance to the photographic references remain playtest judgments.

## Captures

[Residential](residential.jpg) · [Downtown](downtown.jpg) · [Clock Square](clock-square.jpg) · [Railway station](station.jpg) · [Waterfront](waterfront.jpg) · [Industrial district](factory.jpg) · [Factory interior](lost-coupe.jpg) · [Mining gallery](mine.jpg) · [Forest road](forest.jpg)

### Horror pass

[Mountain and cave portal](cave-portal.jpg) · [Inside the cave](cave-interior.jpg) · [Lightning over the massif](lightning.jpg) · [Station at night](station-night.jpg) · [Roadside candles](roadside-candles.jpg)
