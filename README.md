# Slop-Drift

[![Live Demo](https://img.shields.io/badge/Demo-Play%20Online-success?style=for-the-badge&logo=vercel)](https://slop-drift.vercel.app/)

A browser mountain drift-racing game. Everything is generated at load time from a seed: a 2.5 km mountain with eroded ridges and a snow cap, a 5.7 km road loop with four hairpins, a 3 km spur that spirals to the summit, the car, the scenery and the audio. There are no model, texture or sound files.

## Run

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints. `npm run build` produces a static bundle in `dist/`.

The page also carries an import map for Three.js, so the repository root can be served by any static file server without a build step.

## Modes

| Mode | Route |
| --- | --- |
| Mountain Loop | One timed lap of the loop |
| Ridge Circuit | Two laps |
| Summit Climb | Hill climb from the pass up the spur to the summit plaza |
| Touge Descent | The spur driven downhill |
| Drift Session | 120 seconds of score attack on the loop |
| Free Roam | No clock; drive anywhere, including off the road |

Laps only count when every checkpoint is passed in order. Best times, splits and drift scores are stored in the browser.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Throttle / brake and reverse | `W` / `S` or arrows | Right / left trigger |
| Steer | `A` / `D` or arrows | Left stick |
| Handbrake | `Space` | A |
| Nitro | `Shift` | B |
| Camera | `C` | Y |
| Look back / free look | `B` / right-drag | R3 / right stick |
| Reset to the road | `R` | X |
| Shift down / up (manual) | `Q` / `E` | Bumpers |
| Automatic or manual gearbox | `T` | View |
| Headlights | `H` | D-pad up |
| Pause | `P` or `Esc` | Start |
| Mute, fullscreen, debug panel | `M`, `F`, `F1` | |

Touch controls appear on touch devices.

## How it is built

```
src/
  main.js              entry point
  config.js            modes, settings, surface table, persisted records
  core/                Game (state machine and frame loop), shared math, data contracts
  world/               mountain shape, road layout, terrain grid, world queries (no rendering; runs in Node)
  vehicle/             rigid-body raycast vehicle, drivetrain, tyre curve, drift scoring
  game/                RaceSession: laps, checkpoints, splits, records
  render/              terrain, roads, scenery, sky, car, camera, effects
  ui/  input/  audio/  HUD and menus, keyboard/gamepad/touch, synthesized sound
tests/                 headless tests (npm test) and browser test pages
```

**World.** The mountain is an analytic star-shaped cone, so every (bearing, altitude) pair maps to one point. Roads are described as legs in that space and laid on the matching contour, which is why they hug the slope; hairpins join legs, and each leg climbs at an even grade. The terrain is then baked into a 1281 x 1281 height grid (2 m cells), eroded with a droplet simulation, and cut and filled around the roads with rock-cut and embankment slopes. Rendering and physics read the same grid, and on the road the physics uses the analytic road surface, so the ride is smooth.

**Vehicle.** A 6-DOF rigid body with four suspension rays, written from scratch. Suspension force, friction-circle handling and the velocity-cancelling friction solver follow the raycast-vehicle approach used by Bullet, Rapier and cannon-es; lateral grip above walking pace comes from a peaked slip-angle curve, which is what lets the car drift and recover. A locked rear axle (handbrake) slides at kinetic friction. There is no hidden steering or glue: drift assist only eases the front wheels toward the direction of travel.

**References.** Bullet `btRaycastVehicle`, Rapier `ray_cast_vehicle_controller`, cannon-es `RaycastVehicle`, pmndrs/racing-game, spacejack/carphysics2d, Dechode/Godot-Simple-Vehicle, and Sebastian Lague's Hydraulic-Erosion informed the physics and erosion. No code was copied from them.

## Tests

```bash
npm test
```

Runs the world generation checks (road grades, corner radii, surface continuity, guardrails), the vehicle physics suite (acceleration, braking, hill hold, drift and recovery, landings, barrier hits, and drives on the generated roads), the race-session rules and the HUD logic.

Browser test pages, with the dev server running: `tests/ui-harness.html` (HUD with fake data), `tests/view-terrain.html`, `tests/view-road.html` and `tests/view-scenery.html` (fly camera over each part of the world).

`tests/autopilot.js` drives the real game from the browser console: it attaches a centreline-following driver, steps the game loop at a fixed 60 Hz without rendering (so a full lap takes about a second and works in a background tab), and renders still frames from any point on the roads:

```js
const t = await import('/tests/autopilot.js');
await t.ready();
t.attach();
t.start('sprint');
t.step(60 * 30);
```

## Tuning

- `src/world/worldConfig.js` — seed, mountain size and shape, erosion, road widths and grades, and the leg lists that define the loop and the spur.
- `src/vehicle/tuning.js` — mass, suspension, tyres, engine, brakes, steering, and the Arcade / Balanced / Sim presets.
- `src/config.js` — modes, quality presets, nitro, checkpoint spacing.
