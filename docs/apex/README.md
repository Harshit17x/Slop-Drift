# Apex International Motorsport Park

Select **Apex International Motorsport Park** in the map chooser. Open **Race Weekend Setup** to choose a layout, opponents and conditions.

## What you can drive

| Layout | Measured distance | Automated Track GT3 lap |
|---|---:|---:|
| Endurance | 8.192 km | 5m 33s |
| Grand Prix | 5.965 km | 4m 08s |
| Mountain | 4.075 km | 3m 03s |
| International Sprint | 3.476 km | 2m 24s |
| Stadium | 2.606 km | 1m 47s |
| Academy | 1.557 km | 1m 10s |

The automated driver follows the centreline to exercise the actual vehicle, suspension, surfaces and timing gates. These are verification laps. A competitive driver will take different lines. The six layouts share the same physical track and connecting roads. Their measured distances differ from the concept targets where the connections enter the main course.

The main circuit spans 145.5 m vertically. The steepest descent is 14.8%, the steepest climb is 10.4%, peak banking is 24°, and the separate decks at the crossover are approximately 10 m apart. The pit lane measures 684.8 m. The survey contains the locations of all nine named sections. [Circuit survey](../../artifacts/apex/circuit-survey.svg) · [Measured routes](../../artifacts/apex/survey.json) · [5 m centreline samples](../../artifacts/apex/centrelines.csv)

## Features and verification

| Area | Implemented and checked | Scope still open |
|---|---|---|
| Driving | All six closed routes, checkpoints, elevation, crossfall, physical kerbs and runoffs. Full physics laps completed on each route. The main route recorded nine airborne simulation frames. | Competitive human lap and race pace validation. |
| Pit and paddock | Forty garage bays, pit markings, wall, pit boxes, pit limiter and player service. The browser check confirmed one stop restoring fuel from 32 to 90. | Full sporting adjudication and complex pit crew animation. |
| Race meeting | Local opponents, weather, tyre wear, fuel, session selection and cup progression. Browser test started a wet GP session with three moving opponents. | Opponents follow authored routes. Full vehicle contact and a linked practice-to-qualifying-to-race weekend remain open. |
| Scenery | Original foliage and garage imagery, horizon ridges, lake, seating, steel structures, timing and safety furniture. Seventeen browser captures include day, sunset and night views. | Visual parity with the reference simulators has not been established. |
| Media | Fixed viewpoints, player replay, photo controls and HUD-free capture. | Replay covers the most recent 20 seconds of the player's movement. Full-field race replay and photographic depth of field remain open. |
| Performance | Short Medium quality browser benchmarks on Intel UHD graphics at 1262 × 704. Starting-grid median frame times were 6.7–7.9 ms across zero, three and seven opponents. The 95th percentile was 53.2–64.2 ms. | Sustained 60 FPS, especially in long vistas, and mobile device performance need further work and measurement. |

[Browser check and hardware details](../../artifacts/apex/browser-check.json) · [Regression suite log](../../artifacts/apex/test-results.txt) · [Production build log](../../artifacts/apex/build-results.txt)

## Art and reproduction

| Shipped asset | Source and treatment |
|---|---|
| apex-woodland.webp | Four original ImageGen tree plates in one 1024 px atlas. The packing tool removes the light photographic backing, unmattes partial coverage and pads fully transparent pixels with a dark foliage colour. The shader tests sampled alpha after filtering. |
| apex-garages.webp | Four generated garage interior plates on instanced bays. |
| apex-pylon.glb | Original timing pylon built with the Blender script in tools/apex. |
| apex-grid-gt.glb | Low-detail derivative of the game's existing GT car, 2,763 triangles and five material primitives per entrant. |
| Map preview and section photographs | Captured from this browser build. The driving views show the actual rendered map. |

Run `npm test` and `npm run build` in Slop-drift. Use `node tools/apex/survey.mjs` to regenerate the engineering survey. On a machine with the browser used by the capture script, `node tools/apex/capture.mjs` starts Vite and captures the live map.

[Track references and design choices](research.md) · [The Serpent](../../artifacts/apex/the-serpent.jpg) · [Garage bays](../../artifacts/apex/garage-bays.jpg) · [Main stadium](../../artifacts/apex/main-stadium.jpg) · [Night grid](../../artifacts/apex/night-grid.jpg)

