# Apex International Motorsport Park

Select **Apex International Motorsport Park** in the map chooser. Open **Race Weekend Setup** to choose a layout, opponents and conditions.

## What you can drive

| Layout | Measured distance | Automated Track GT3 lap |
|---|---:|---:|
| Endurance | 8.192 km | 5m 33s |
| Grand Prix | 5.879 km | 3m 57s |
| Mountain | 4.075 km | 3m 02s |
| International Sprint | 3.650 km | 2m 29s |
| Stadium | 2.737 km | 1m 53s |
| Academy | 1.557 km | 1m 10s |

The automated driver follows the centreline to exercise the actual vehicle, suspension, surfaces and timing gates. These are verification laps. A competitive driver will take different lines. In a separate traffic test, three AI entrants completed two laps on each of the six configurations. All three pitted on each of the four routes sharing the pit straight. The six layouts share the same physical track and connecting roads. Their measured distances differ from the concept targets where the connections enter the main course.

The main circuit spans 145.5 m vertically. The steepest descent is 14.8%, the steepest climb is 10.4%, peak banking is 24°, and the separate decks at the crossover are approximately 10 m apart. The pit lane measures 684.8 m. The survey contains the locations of all nine named sections. [Circuit survey](../../artifacts/apex/circuit-survey.svg) · [Measured routes](../../artifacts/apex/survey.json) · [5 m centreline samples](../../artifacts/apex/centrelines.csv)

## Features and verification

| Area | Implemented and checked | Scope still open |
|---|---|---|
| Driving | All six closed routes, checkpoints, elevation, crossfall, physical kerbs and runoffs. Full physics laps completed on each route. All six automated laps recorded zero airborne simulation frames. | Competitive human lap and race pace validation. |
| Pit and paddock | Forty garage bays, pit markings, wall, pit boxes, pit limiter and player service. The browser check confirmed one stop restoring fuel from 32 to 90. | Full sporting adjudication and complex pit crew animation. |
| Race meeting | Linked practice, qualifying and race, saved personal-best ghosts, a points championship, and configurable weather and driving rules. The browser carried qualifying order into the race. | AI use simplified traffic and contact physics. |
| Scenery | Original foliage and garage imagery, horizon ridges, lake, seating, steel structures, timing and safety furniture. Browser captures include day, sunset and night views. | Visual parity with the reference simulators has not been established. |
| Media | Full-field session replay, timeline scrubbing, selectable section cameras and depth of field. Saved images omit the HUD. | Replay is local to the current session. |
| Performance | At a 1262 × 704 viewport on Intel UHD Graphics, three 20-second driving samples with three opponents averaged 54.7 FPS at the grid, 52.5 FPS on the wet summit and 53.9 FPS in Thunder Bowl on Medium. Adaptive resolution reached 883 × 492. Median frame interval was 16.7 ms and the 95th percentile was 33.3–33.4 ms. A separate Low-quality summit sample averaged 47.8 FPS. | Sustained 60 FPS and performance on physical mobile devices remain open. |

A production browser check started an Endurance session at an 844 × 390 viewport and switched through Tokyo, Hollow and Apex. Each map entered the running state. [Map switching and phone-sized setup](../../artifacts/apex/map-smoke.json)

[Browser check and hardware details](../../artifacts/apex/browser-check.json) · [Regression suite log](../../artifacts/apex/test-results.txt) · [Production build log](../../artifacts/apex/build-results.txt) · [Race grid](../../artifacts/apex/qualifying-grid.jpg)

## Art and reproduction

| Shipped asset | Source and treatment |
|---|---|
| apex-woodland.webp | Four original ImageGen tree plates in one 1024 px atlas. The packing tool removes the light photographic backing, unmattes partial coverage and pads fully transparent pixels with a dark foliage colour. The shader tests sampled alpha after filtering. |
| apex-garages.webp | Four generated garage interior plates on instanced bays. |
| apex-pylon.glb | Original timing pylon built with the Blender script in tools/apex. |
| apex-grid-gt.glb | Original fictional Blender GT coupe, paired with a 1,984-triangle distant model. The close-up mesh has 8,120 triangles. Both use six material primitives. Team door plates are drawn at runtime. |
| Map preview and section photographs | Captured from this browser build. The driving views show the actual rendered map. |

Run `npm test` and `npm run build` in Slop-drift. The standalone circuit checks are also saved in [the circuit test log](../../artifacts/apex/circuit-tests.txt). Use `node tools/apex/survey.mjs` to regenerate the engineering survey. On a machine with the browser used by the capture script, `node tools/apex/capture.mjs` starts Vite and captures the live map. After a production build, `node tools/apex/capture.mjs --production --drive` also checks meeting progression, ghosts, replay and graphics tiers and collects driving frame intervals.

[PRD acceptance checklist](acceptance.md) · [Asset manifest](assets.md) · [Ten simulator references](simulator-research.md) · [Track references and design choices](research.md) · [The Serpent](../../artifacts/apex/the-serpent.jpg) · [Garage bays](../../artifacts/apex/garage-bays.jpg) · [Main stadium](../../artifacts/apex/main-stadium.jpg) · [Night grid](../../artifacts/apex/night-grid.jpg)
