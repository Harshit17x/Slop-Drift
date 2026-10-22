# Slop-Drift

Self-contained browser mountain drift game. The current runtime does not use the supplied GLB files. Terrain, road, car, decorations, checkpoints, effects, and audio are generated at runtime.

## Run

From the project root:

```bash
python -m http.server 8080
```

Open:

```text
http://localhost:8080
```

The page uses a Three.js CDN import map, so it does not require `npm install`, Vite, or a build step. A static HTTP server is required because browser ES modules are not reliably loadable from `file://` URLs.

## Modes

- Summit Sprint — one-lap mountain time trial
- Drift Session — 90-second score attack
- Ridge Circuit — two-lap run
- Free Roam — open mountain driving

## Controls

- `W` / `ArrowUp`: throttle
- `S` / `ArrowDown`: brake and reverse
- `A/D` / arrows: steer
- `Space`: handbrake drift
- `Shift`: nitro
- `C`: camera mode
- `R`: respawn at the latest checkpoint
- `Q/E`: manual downshift/upshift
- `T`: automatic/manual transmission
- `H`: headlights
- `P` / `Escape`: pause
- `M`: mute
- `F1`: debug panel
- Right mouse drag: cockpit free look
- `B`: look back

Gamepad and touch controls are also included.

## Runtime files

- `index.html` — CDN import map and entry point
- `src/mountain-main.js` — game state, scene, modes, and render loop
- `src/mountain-config.js` — all major tuning values and saved settings
- `src/procedural/Heightfield.js` — deterministic basin-and-rim mountain terrain with ridges, cliffs, and edge drop-offs
- `src/procedural/TerrainChunk.js` — chunked terrain rendering and LOD
- `src/procedural/MountainRoad.js` — spline road, banked hairpin U-turn, red/white racing curbs, shoulders, guardrails, warning cones, checkpoints
- `src/procedural/ProceduralCar.js` — primitive-built rally car and interior
- `src/procedural/MountainVehicle.js` — custom vehicle dynamics, road-follow stability assist, suspension, traction-limited tires, drag, downforce, and fixed-step simulation
- `src/procedural/DriftModel.js` — handbrake drift detection and scoring
- `src/mountain-camera.js` — chase, far, hood, and cockpit cameras
- `src/mountain-effects.js` — smoke, dust, sparks, flames, and skid marks
- `src/mountain-audio.js` — synthesized engine, tire, wind, nitro, and UI audio
- `src/mountain-hud.js` — menu, HUD, minimap, settings, pause, and finish flow

## Ten key CONFIG values

1. `CONFIG.seed` — regenerates the same mountain when unchanged.
2. `CONFIG.world.roadWidth` — road width and available drift room.
3. `CONFIG.world.roadSegments` — road smoothness and loop detail.
4. `CONFIG.vehicle.engineForce` — acceleration and launch strength.
5. `CONFIG.vehicle.lateralGrip` — how easily the car slides.
6. `CONFIG.vehicle.maxSpeed` — top speed in meters per second.
7. `CONFIG.drift.entryAngleDeg` — angle needed before a drift starts scoring.
8. `CONFIG.drift.scoreScale` — drift score rate.
9. `CONFIG.camera.chaseDistance` and `CONFIG.camera.chaseHeight` — exterior camera feel.
10. `CONFIG.world.chunkSize` and terrain resolution preset — terrain detail/performance balance.

## Verification

- All new runtime modules pass `node --check`.
- `npm run build` still passes for the legacy Vite bundle.
- The standalone page was opened through a Python static server and rendered the procedural mountain scene, road, HUD, menu, minimap, and procedural runtime without external model files.
