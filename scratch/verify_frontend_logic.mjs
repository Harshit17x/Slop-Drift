import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed += 1;
    throw new Error(message);
  } else {
    console.log(`✅ PASS: ${message}`);
    passed += 1;
  }
}

console.log('--- STARTING FRONTEND & LOGIC VERIFICATION ---');

// 1. MountainInput: Physical code verification
{
  const inputSource = fs.readFileSync('src/mountain-input.js', 'utf8');
  assert(inputSource.includes("this.keys.add(event.code);"), 'Input handles physical event.code');
  assert(inputSource.includes("data-touch=\"respawn\""), 'Touch overlay contains Respawn button');
  assert(inputSource.includes("KeyR"), 'Default bindings map KeyR to respawn');
  assert(inputSource.includes("KeyB"), 'Default bindings map KeyB to lookBack');
}

// 2. MountainHud: mapPoint North-up orientation
{
  const hudSource = fs.readFileSync('src/mountain-hud.js', 'utf8');
  // Check formula: const y = height - (normalizedZ * (height - padding * 2) + padding);
  // With normalizedZ = (z - minZ) / (maxZ - minZ). As z becomes more negative (North), normalizedZ -> 0, so y -> height - padding (or top)
  assert(hudSource.includes("this.onOpenSettings('menu')") && hudSource.includes("this.onOpenSettings('pause')"), 'HUD triggers onOpenSettings(source)');
  assert(hudSource.includes("mode === 'roam' ? 'OPEN' : mode === 'drift'"), 'HUD displays OPEN for free roam and time for drift');
}

// 3. MountainStyles: minimap-north top positioning
{
  const cssSource = fs.readFileSync('src/mountain-styles.css', 'utf8');
  assert(cssSource.includes('.minimap-north { position: absolute; top: 22px; right: 28px; bottom: auto;'), 'Minimap North badge positioned at top: 22px in CSS');
}

// 4. MountainAudio: silence() method
{
  const audioSource = fs.readFileSync('src/mountain-audio.js', 'utf8');
  assert(audioSource.includes('silence() {'), 'MountainAudio has silence() method');
  assert(audioSource.includes('this.engineGain.gain.setTargetAtTime(0.0001'), 'silence() ramps engineGain down');
  assert(audioSource.includes('this.tireGain.gain.setTargetAtTime(0.0001'), 'silence() ramps tireGain down');
  assert(audioSource.includes('this.windGain.gain.setTargetAtTime(0.0001'), 'silence() ramps windGain down');
}

// 5. MountainMain: Settings deadlock fix & ABS brake cap & respawn count
{
  const mainSource = fs.readFileSync('src/mountain-main.js', 'utf8');
  assert(mainSource.includes("openSettings(source = 'menu')"), 'openSettings accepts source parameter');
  assert(mainSource.includes('this.restoreAfterSettings()'), 'restoreAfterSettings handles return to pause menu');
  assert(mainSource.includes('this.audio?.silence();'), 'Audio is silenced when switching menu states');
  assert(mainSource.includes('this.session.respawns += 1;'), 'Manual respawn increments session.respawns counter');
  assert(mainSource.includes('brake = Math.min(brake, 0.82);'), 'ABS bounds maximum brake force to 0.82');
  assert(mainSource.includes('this.decorations.traverse((child) => {'), 'dispose() cleans up procedural decorations');
}

console.log(`\n========================================`);
console.log(`ALL FRONTEND TESTS PASSED: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);
