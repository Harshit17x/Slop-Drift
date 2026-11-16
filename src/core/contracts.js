// Shared data shapes between the world, the vehicle, the game loop and the UI.
// This module has no runtime code; it exists so every module documents against one definition.

/**
 * Result of World.sampleGround(x, z, out). Plain numbers only, so callers can reuse one object
 * per query and the physics step stays allocation-free.
 * @typedef {Object} GroundSample
 * @property {number} y          Ground height in metres at (x, z).
 * @property {number} nx         Unit surface normal, x component.
 * @property {number} ny         Unit surface normal, y component (always > 0).
 * @property {number} nz         Unit surface normal, z component.
 * @property {number} surface    SURFACE id from src/config.js.
 * @property {number} grip       Friction coefficient of the surface (1 = dry asphalt).
 * @property {number} rolling    Rolling resistance coefficient.
 * @property {number} roughness  0..1 bumpiness, for vibration, audio and particles.
 * @property {number} roadId     Index into World.roads when on a road or its shoulder, else -1.
 */

/**
 * Result of World.collideBarrier(x, y, z, radius, out): a guardrail or wall near a point.
 * @typedef {Object} BarrierHit
 * @property {boolean} hit    True when the sphere at (x, y, z) penetrates a barrier.
 * @property {number} nx      Horizontal unit normal pointing from the barrier back toward the road.
 * @property {number} nz
 * @property {number} depth   Penetration depth in metres (> 0 when hit).
 */

/**
 * Result of World.locate(x, z, out, roadId): position relative to a road centreline.
 * @typedef {Object} RoadLocation
 * @property {number} roadId     Road index, or -1 when no road is within range.
 * @property {number} s          Distance along the centreline in metres.
 * @property {number} progress   s / road.length, 0..1.
 * @property {number} lateral    Signed offset from the centreline in metres (+ is to the right of travel along +s).
 * @property {number} distance   |lateral| measured in the horizontal plane.
 * @property {number} halfWidth  Half the asphalt width at this point.
 * @property {number} y          Road surface height at the centreline.
 * @property {number} tx         Unit tangent along +s.
 * @property {number} ty
 * @property {number} tz
 */

/**
 * A drivable course used by a game mode. World.routes maps route name -> Route.
 * @typedef {Object} Route
 * @property {string} id          'loop' | 'climb' | 'descent'
 * @property {number} roadId      Index into World.roads.
 * @property {boolean} closed     True for lapped circuits.
 * @property {number} direction   +1 when driven along increasing s, -1 when driven against it.
 * @property {number} startS      Start line position (metres along the road).
 * @property {number} finishS     Finish line position. Equals startS for closed routes.
 * @property {number} length      Driven length of one lap or run in metres.
 * @property {number[]} checkpoints  Positions (s) of intermediate gates, in driving order.
 */

/**
 * A pose to place the car at. Produced by World.getSpawn(routeId, s, out).
 * @typedef {Object} SpawnPose
 * @property {{x:number,y:number,z:number}} position  Ground contact point under the car centre.
 * @property {{x:number,y:number,z:number,w:number}} quaternion  Orientation: -Z forward, +Y up, +X right.
 */

/**
 * Driver input for one frame. Built by src/input/Input.js, consumed by Vehicle.step().
 * @typedef {Object} Controls
 * @property {number} throttle   0..1
 * @property {number} brake      0..1 (also reverse when stopped)
 * @property {number} steer      -1..1, positive steers right
 * @property {boolean} handbrake
 * @property {boolean} boost     Nitro requested.
 * @property {number} shift      -1 downshift, +1 upshift, 0 none (manual transmission only).
 */

/**
 * Per-wheel state exposed by the vehicle for visuals, effects and audio.
 * Order is always: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.
 * @typedef {Object} WheelState
 * @property {boolean} contact      Wheel touches the ground.
 * @property {number} compression   Suspension compression in metres relative to rest (+ compressed).
 * @property {number} steerAngle    Radians, positive steers right.
 * @property {number} spinAngle     Accumulated rolling angle in radians.
 * @property {number} spinSpeed     Rolling speed in rad/s.
 * @property {number} slip          0 = full grip, 1 = at the friction limit, >1 = sliding.
 * @property {number} load          Normal force in newtons.
 * @property {number} surface       SURFACE id under the wheel.
 * @property {{x:number,y:number,z:number}} contactPoint  World-space contact patch position.
 * @property {{x:number,y:number,z:number}} contactNormal World-space ground normal.
 */

/**
 * Snapshot returned by Vehicle.step() and Vehicle.getState(). Vectors are THREE.Vector3/Quaternion
 * instances owned by the vehicle: read them, do not keep references across frames or mutate them.
 * @typedef {Object} VehicleState
 * @property {import('three').Vector3} position     Render-interpolated chassis origin (ground-level centre of the car at rest).
 * @property {import('three').Quaternion} quaternion Render-interpolated orientation (-Z forward).
 * @property {import('three').Vector3} velocity     World-space linear velocity, m/s.
 * @property {import('three').Vector3} angularVelocity World-space, rad/s.
 * @property {import('three').Vector3} forward      Unit vectors of the chassis frame.
 * @property {import('three').Vector3} right
 * @property {import('three').Vector3} up
 * @property {number} speed          |velocity| in m/s.
 * @property {number} speedKmh
 * @property {number} forwardSpeed   Velocity along forward (negative when reversing).
 * @property {number} lateralSpeed   Velocity along right.
 * @property {number} slipAngle      Body slip angle in radians: atan2(lateralSpeed, |forwardSpeed|), 0 below walking pace.
 * @property {number} yawRate        rad/s about chassis up.
 * @property {number} steerAngle     Current front wheel angle, radians.
 * @property {number} throttle       Applied throttle 0..1.
 * @property {number} brake          Applied brake 0..1.
 * @property {boolean} handbrake
 * @property {boolean} boosting      Nitro is currently adding force.
 * @property {number} rpm
 * @property {number} rpmMax         Redline, for gauges.
 * @property {number|string} gear    1..6, 'R' or 'N'.
 * @property {boolean} shifted       True on the single step a gear change happened.
 * @property {number} wheelsOnGround 0..4
 * @property {boolean} airborne      No wheel has touched the ground for a short while.
 * @property {number} surface        SURFACE id under the majority of wheels.
 * @property {number} gLong          Longitudinal acceleration in g (+ accelerating).
 * @property {number} gLat           Lateral acceleration in g (+ to the right).
 * @property {number} impact         Strength of a collision this step in m/s (0 when none), for sparks, audio and camera shake.
 * @property {number} landing        Vertical speed absorbed on touchdown this step in m/s (0 when none).
 * @property {boolean} upsideDown    Chassis up points below the horizon.
 * @property {WheelState[]} wheels
 */

/**
 * What the game loop hands the HUD every frame (Hud.update(frame)).
 * @typedef {Object} HudFrame
 * @property {number} speedKmh
 * @property {number|string} gear
 * @property {number} rpm
 * @property {number} rpmMax
 * @property {number} throttle    0..1
 * @property {number} brake       0..1
 * @property {number} boost       Nitro remaining, 0..100.
 * @property {boolean} boosting
 * @property {string} surface     Surface name, e.g. 'asphalt'.
 * @property {{x:number,z:number}} position  World position for the minimap.
 * @property {number} heading     Yaw in radians; 0 faces -Z (north on the map), positive turns toward +X (east).
 * @property {number} altitude    Metres above the valley floor.
 * @property {number} grade       Road grade under the car in percent (+ uphill in the driving direction).
 * @property {{active:boolean, angleDeg:number, score:number, bank:number, multiplier:number, comboTimer:number, comboWindow:number}} drift
 * @property {{modeId:string, modeLabel:string, lap:number, laps:number, elapsed:number, lapTime:number,
 *   bestLap:(number|null), lastLap:(number|null), progress:number, timeLeft:(number|null),
 *   wrongWay:boolean, offRoad:boolean}} session
 * @property {string} camera      Camera mode label.
 * @property {string} debug       Multi-line debug text (shown only when the debug panel is open).
 */

export {};
