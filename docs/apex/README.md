# Apex International Motorsport Park

Select **APEX Grand Prix**, then open **Events**. Each timed event covers one lap in clear daylight.

| Event | Length |
|---|---:|
| Endurance Loop | 8.192 km |
| Grand Prix Loop | 5.879 km |
| Stadium Loop | 2.737 km |

Free Roam opens the entire venue, including the mountain and academy roads. The three timed loops use the existing circuit geometry and share a pit straight. To change tyres, stop inside a marked working box beside the garages for five seconds. Pulling away interrupts the change. Fresh dry tyres restore their grip and starting temperature.

Dry rubber on the racing line, braking marks and pit-box scuffs are baked into the scene. The timing pylon displays elapsed time and speed. Distant forest tiles use fewer tree instances, and Low and Medium quality can reduce the 3D render resolution under sustained load.

Run `npm test` for circuit and vehicle regressions. Run `npm run build` followed by `node tools/apex/capture.mjs --production` to check the event list, launch each loop, exercise tyre service and sample the grid in Chrome.

[Track survey](../../artifacts/apex/circuit-survey.svg) · [Layout measurements](../../artifacts/apex/survey.json) · [Circuit references](research.md)
