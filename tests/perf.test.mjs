// Performance guards: `node tests/perf.test.mjs` (exit code 1 on failure).
// Dynamic resolution steps down on slow frames, recovers when calm and backs off when it flip-flops;
// the renderer never asks three.js for the removed PCFSoft shadows (that recompiled every shader on frame one).
import { readFileSync } from 'node:fs';
import { RENDER_SCALE, createRenderScale, stepRenderScale } from '../src/core/renderScale.js';

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}
const run = (state, ms, seconds) => { let changed = 0; for (let t = 0; t < seconds * 1000; t += ms) changed += stepRenderScale(state, ms) ? 1 : 0; return changed; };

const s = createRenderScale();
run(s, 16.7, 5);
check('steady 60 fps keeps full resolution', s.scale === 1);
run(s, 30, 1.05);
check('one slow second steps down', s.scale < 1 && s.scale >= 0.8, `${s.scale}`);
run(s, 40, 10);
check('sustained slow frames stop at the floor', s.scale === RENDER_SCALE.min, `${s.scale}`);
check('stalls over 250 ms are ignored', !stepRenderScale(s, 900) && s.scale === RENDER_SCALE.min);
run(s, 16.7, 3.5);
check('not back up before four calm seconds', s.scale === RENDER_SCALE.min);
run(s, 16.7, 1.1);
check('steps back up once calm', s.scale > RENDER_SCALE.min, `${s.scale}`);
run(s, 30, 1.05);
check('a drop right after a step up doubles the wait', s.calmNeeded === RENDER_SCALE.calmStart * 2, `${s.calmNeeded}`);

for (const file of ['src/core/Game.js', 'src/ui/TitleFx.js']) {
  check(`${file} avoids the removed PCFSoftShadowMap`, !/shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/.test(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')));
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
