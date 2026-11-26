// Headless logic tests for the UI layer: node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { formatTime, formatDelta, formatInt, recordKind, formatTarget, medalFor, validateName, normalizePartyCode, isPartyCode, paintColor } from '../src/ui/Hud.js';
import { applyDeadzone, isFormField, KEY_BINDINGS, PAD_BUTTONS } from '../src/input/Input.js';
import { normalizeTrack } from '../src/ui/Minimap.js';
import * as THREE from 'three';
import { MODES, DEFAULT_SETTINGS, PAINT_OPTIONS, SKIN_OPTIONS, getSkin, normalizeSettings, getQualityPreset, nextAutoQuality, QUALITY_PRESETS } from '../src/config.js';
import { patchCarPaint, setCarPaintUniforms, loadSkinTexture, PAINT_MODES } from '../src/render/carPaintShader.js';
import { CARS } from '../src/vehicle/cars.js';
import {
  CAR_SORT_MODES, HUB_TABS, MAP_SUBTITLES, TITLE_BACKDROP_URL,
  carRatingRows, driveUnitSvg, eventCategoryBadge, mapSubtitleMarkup, sortCars,
} from '../src/ui/GarageUi.js';
import { TitleFx, computeDriftPose, formatRecTime } from '../src/ui/TitleFx.js';
import { buildHeroBoughs, buildTexturedGrassGeometry, buildTexturedShrubGeometry } from '../src/render/Scenery.js';
import { classifyLandmarkSurface, Landmarks } from '../src/render/Landmarks.js';
import { resolveAtmospherePreset } from '../src/render/Atmosphere.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`ok - ${name}`); };

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00.00');
  assert.equal(formatTime(5.25), '0:05.25');
  assert.equal(formatTime(65.009), '1:05.00');
  assert.equal(formatTime(599.999), '9:59.99');
  assert.equal(formatTime(3600), '60:00.00');
  assert.equal(formatTime(null), '--:--.--');
  assert.equal(formatTime(-3), '0:00.00');
});

test('formatDelta', () => {
  assert.equal(formatDelta(1.234), '+1.23');
  assert.equal(formatDelta(-0.5), '−0.50');
  assert.equal(formatDelta(undefined), '');
});

test('formatInt groups thousands without locale', () => {
  assert.equal(formatInt(0), '0');
  assert.equal(formatInt(999), '999');
  assert.equal(formatInt(1000), '1,000');
  assert.equal(formatInt(1234567.6), '1,234,568');
  assert.equal(formatInt(-48210), '-48,210');
});

test('recordKind per mode', () => {
  const kinds = Object.fromEntries(MODES.map((m) => [m.id, recordKind(m)]));
  assert.deepEqual(kinds, { sprint: 'time', circuit: 'time', climb: 'time', descent: 'time', drift: 'score', peak: 'time', peakdown: 'time', quarter:'time', vanishing:'time', roam: 'none' });
});

test('applyDeadzone rescales', () => {
  assert.equal(applyDeadzone(0.1, 0.12), 0);
  assert.equal(applyDeadzone(-0.12, 0.12), 0);
  assert.equal(applyDeadzone(1, 0.12), 1);
  assert.equal(applyDeadzone(-1, 0.12), -1);
  assert.ok(Math.abs(applyDeadzone(0.56, 0.12) - 0.5) < 1e-9);
  assert.equal(applyDeadzone(NaN, 0.12), 0);
});

test('isFormField', () => {
  assert.equal(isFormField({ nodeType: 1, tagName: 'INPUT' }), true);
  assert.equal(isFormField({ nodeType: 1, tagName: 'SELECT' }), true);
  assert.equal(isFormField({ nodeType: 1, tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isFormField({ nodeType: 1, tagName: 'BUTTON' }), false);
  assert.equal(isFormField(null), false);
});

test('bindings keep the documented keys', () => {
  assert.deepEqual(KEY_BINDINGS.handbrake, ['Space']);
  assert.deepEqual(KEY_BINDINGS.pause, ['KeyP', 'Escape']);
  assert.deepEqual(KEY_BINDINGS.shiftUp, ['KeyE']);
  assert.deepEqual(KEY_BINDINGS.shiftDown, ['KeyQ']);
  assert.equal(PAD_BUTTONS.throttle, 7);
  assert.equal(PAD_BUTTONS.brake, 6);
});

test('normalizeTrack computes bounds when missing', () => {
  const t = normalizeTrack({ roads: [{ id: 0, closed: false, points: [-10, 5, 20, -7] }, { id: 1, points: [1] }] });
  assert.deepEqual(t.bounds, { minX: -10, maxX: 20, minZ: -7, maxZ: 5 });
  assert.equal(t.roads.length, 1);
});

test('formatTarget', () => {
  assert.equal(formatTarget('time', 168), '2:48.0');
  assert.equal(formatTarget('time', 92.96), '1:33.0');
  assert.equal(formatTarget('score', 8000), '8,000');
  assert.equal(formatTarget('time', NaN), '');
});

test('medalFor uses MEDAL_TARGETS direction', () => {
  assert.equal(medalFor('sprint', 160), 'gold');
  assert.equal(medalFor('sprint', 157), 'author');
  assert.equal(medalFor('sprint', 300), null);
  assert.equal(medalFor('drift', 4000), 'silver');
  assert.equal(medalFor('drift', 100), null);
  assert.equal(medalFor('roam', 1), null);
  // Per map: a Mussoorie sprint time is judged against the Mussoorie targets.
  assert.equal(medalFor('sprint', 160, 'alpine'), 'gold');
  assert.equal(medalFor('sprint', 160, 'mussoorie'), null);
  assert.equal(medalFor('sprint', 92, 'mussoorie'), 'gold');
});

test('validateName', () => {
  assert.equal(validateName('  Ridge   Runner '), 'Ridge Runner');
  assert.equal(validateName('a'), null);
  assert.equal(validateName('x'.repeat(17)), null);
  assert.equal(validateName('drift_mum-2'), 'drift_mum-2');
  assert.equal(validateName('bad!name'), null);
});

test('party code input sanitising', () => {
  assert.equal(normalizePartyCode(' k7-mpq9z '), 'K7MPQ');
  assert.equal(normalizePartyCode('a0b1c'), 'ABC');
  assert.equal(normalizePartyCode(null), '');
  assert.equal(isPartyCode('K7MPQ'), true);
  assert.equal(isPartyCode('K7MP'), false);
  assert.equal(isPartyCode('K7MP0'), false);
});

test('paintColor only passes safe colours', () => {
  assert.equal(paintColor(0xc8321e), '#c8321e');
  assert.equal(paintColor('#2A6FB0'), '#2A6FB0');
  assert.equal(paintColor('red;background:url(x)'), null);
  assert.equal(paintColor(undefined), null);
});

test('startGate setting defaults true and normalizes booleans', () => {
  assert.equal(DEFAULT_SETTINGS.startGate, true);
  assert.equal(normalizeSettings({}).startGate, true);
  assert.equal(normalizeSettings({ startGate: false }).startGate, false);
});

test('Auto quality is the default, resolves to a preset and only steps down when slow', () => {
  assert.equal(DEFAULT_SETTINGS.quality, 'Auto');
  assert.equal(normalizeSettings({ quality: 'Auto' }).quality, 'Auto');
  assert.equal(normalizeSettings({ quality: 'Low' }).quality, 'Low');
  assert.equal(normalizeSettings({ quality: 'Potato' }).quality, 'Auto');
  assert.equal(getQualityPreset('Auto', 'Medium'), QUALITY_PRESETS.Medium);
  assert.equal(getQualityPreset('Low', 'Ultra'), QUALITY_PRESETS.Low);
  assert.equal(nextAutoQuality('High', 30), 'Medium');
  assert.equal(nextAutoQuality('High', 55), 'High');
  assert.equal(nextAutoQuality('Low', 10), 'Low');
});

test('GarageUi car metadata, sorting, ratings and drivetrain SVG', () => {
  assert.ok(HUB_TABS.some((t) => t.id === 'garage') && HUB_TABS.some((t) => t.id === 'map'));
  assert.ok(CAR_SORT_MODES.some((m) => m.id === 'favorites'));
  const byClass = sortCars(CARS, 'class', []);
  assert.equal(byClass[0].id, 'gt');
  const byFav = sortCars(CARS, 'favorites', ['thar']);
  assert.equal(byFav[0].id, 'thar');
  const byName = sortCars(CARS, 'name', []);
  assert.equal(byName[0].id, 'thar'); // Hill 4x4 < Rally Hatch < Tokyo Sedan < Track GT3
  assert.ok(!CARS.some((c) => /porsche|911|992/i.test(`${c.label} ${c.titleLines.join(' ')} ${c.blurb}`)));
  const tokyo = CARS.find((c) => c.id === 'tokyo');
  assert.ok(tokyo && tokyo.classBand === 'a' && tokyo.model?.endsWith('tokyo.glb') && tokyo.thumbnail?.endsWith('car-tokyo.webp'));
  for (const car of CARS) {
    const rows = carRatingRows(car);
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.value > 0 && r.value <= 10));
    const svg = driveUnitSvg(car.drivetrain);
    assert.ok(svg.includes('<svg') && svg.includes('var(--marigold)'));
  }
  assert.equal(eventCategoryBadge(MODES.find((m) => m.id === 'drift')).tag, 'DRIFT ZONE');
  assert.equal(eventCategoryBadge(MODES.find((m) => m.id === 'roam')).tag, 'FREE ROAM');
});

test('loading screen backdrop, map subtitles and 3D TitleFx drift helpers', () => {
  assert.ok(TITLE_BACKDROP_URL.endsWith('title-backdrop.webp'));
  assert.ok(MAP_SUBTITLES.mussoorie.includes('Mussoorie'));
  assert.ok(mapSubtitleMarkup('alpine', { label: 'Alpine Peak' }).includes('Alpine Peak'));
  assert.ok(mapSubtitleMarkup('jungle', { label: 'Monsoon Run' }).includes('Monsoon Run'));
  assert.equal(formatRecTime(12.34), '00:00:12.3');
  const p0 = computeDriftPose(0);
  const p1 = computeDriftPose(1.5);
  assert.ok(Number.isFinite(p0.x) && Number.isFinite(p0.z) && p0.slip > 0.3 && p0.steer < 0);
  assert.notEqual(p0.orbit, p1.orbit);
  const fx = new TitleFx();
  fx.start();
  fx.setMap('alpine');
  fx.setCar('gt', { paint: { color: 0xff5b36 }, rimColor: 0xf2b01e });
  fx.stop();
  fx.destroy();
});

test('Alpine foliage atlas geometries keep valid UV quadrants and indexed triangles', () => {
  const b0 = buildHeroBoughs({ height: 15, trunkHeight: 1.6, layers: 5, baseRadius: 2.9, topRadius: 1.0, quadrant: 0 });
  const b1 = buildHeroBoughs({ height: 11.4, trunkHeight: 1.8, layers: 4, baseRadius: 3.2, topRadius: 1.3, quadrant: 1 });
  const gr = buildTexturedGrassGeometry();
  const sh = buildTexturedShrubGeometry();
  for (const g of [b0, b1, gr, sh]) {
    const pos = g.attributes.position.array;
    const uv = g.attributes.uv.array;
    assert.ok(pos.length > 0 && g.index.count > 0);
    for (let i = 0; i < pos.length; i += 1) assert.ok(Number.isFinite(pos[i]));
    for (let i = 0; i < uv.length; i += 1) assert.ok(uv[i] >= 0 && uv[i] <= 1);
    g.dispose();
  }
});

test('Mussoorie Landmarks surface classifier and Atmosphere Himalayan lighting presets', () => {
  assert.equal(classifyLandmarkSurface('MSR_whitewash', 'P_Cottage_A').kind, 'plaster');
  assert.deepEqual(classifyLandmarkSurface('MSR_whitewash', 'P_Cottage_A').offset, [0, 0.5]);
  assert.equal(classifyLandmarkSurface('MSR_cream', 'P_ClockTower').kind, 'stone');
  assert.equal(classifyLandmarkSurface('MSR_cream', 'P_Temple').kind, 'stone');
  assert.equal(classifyLandmarkSurface('MSR_tin_red', 'P_Cottage_B').kind, 'corrugated');
  assert.deepEqual(classifyLandmarkSurface('MSR_tin_red', 'P_Cottage_B').offset, [0.5, 0.5]);
  assert.equal(classifyLandmarkSurface('MSR_timber', 'P_ShopRow').kind, 'timber');
  assert.equal(classifyLandmarkSurface('MSR_glass', 'P_PicturePalace').kind, 'glass');

  const lmk = new Landmarks({ world: { placements: [] }, quality: { shadowMapSize: 1024 } });
  lmk.setNight(false, true);
  assert.equal(lmk.night, false);
  assert.equal(lmk.warmGlow, true);
  lmk.setNight(true);
  assert.equal(lmk.night, true);
  lmk.dispose();

  const alpineDay = resolveAtmospherePreset('day', 'alpine');
  const musDay = resolveAtmospherePreset('day', 'mussoorie');
  const musSunset = resolveAtmospherePreset('sunset', 'mussoorie');
  const musNight = resolveAtmospherePreset('night', 'mussoorie');
  assert.equal(alpineDay.skyElevation, 47);
  assert.ok(musDay.skyElevation < 30 && musDay.rayleigh > alpineDay.rayleigh && musDay.clouds > alpineDay.clouds);
  assert.ok(musSunset.envIntensity > alpineDay.envIntensity && musSunset.rayleigh > musDay.rayleigh);
  assert.equal(musNight.moon, true);
});

test('Custom car wrap skins catalog and triplanar skin shader uniforms', () => {
  assert.equal(SKIN_OPTIONS, PAINT_OPTIONS);
  assert.equal(SKIN_OPTIONS.length, 11);
  for (const skin of SKIN_OPTIONS) {
    if (skin.id === 'saltline') continue; // The earned service stripes are generated by the body shader.
    assert.ok(skin.skinUrl && skin.skinUrl.endsWith('.webp'), `missing webp skinUrl for ${skin.id}`);
    assert.ok(skin.label && Number.isFinite(skin.color));
  }
  assert.equal(getSkin('violet').label, 'Midnight Sakura');
  const mat = new THREE.MeshPhysicalMaterial();
  patchCarPaint(mat, { mode: PAINT_MODES.SOLID_PAINT });
  assert.ok(mat.userData.carPaintUniforms.uSkinMap.value?.isTexture);
  assert.equal(mat.userData.carPaintUniforms.uSkinMix.value, 0);
  setCarPaintUniforms(mat, { paint: getSkin('ember') });
  assert.equal(mat.userData.carPaintUniforms._wantedSkinUrl, getSkin('ember').skinUrl);
  assert.equal(loadSkinTexture(null), null);
  mat.dispose();
});

test('theme.css font urls exist in src/ui/fonts and public/assets/fonts', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const css = fs.readFileSync(path.join(rootDir, 'src/ui/theme.css'), 'utf8');
  const fontRefs = [...new Set([...css.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)].map((m) => m[1]))];
  assert.ok(fontRefs.length >= 14);
  for (const file of fontRefs) {
    assert.ok(fs.existsSync(path.join(rootDir, 'src/ui/fonts', file)), `missing src/ui/fonts/${file}`);
    assert.ok(fs.existsSync(path.join(rootDir, 'public/assets/fonts', file)), `missing public/assets/fonts/${file}`);
  }
});

test('hud.css keeps map chooser, tabs, and garage responsive on phone portrait, phone landscape, and narrow tabs', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const hudCss = fs.readFileSync(path.join(rootDir, 'src/ui/hud.css'), 'utf8');
  assert.ok(hudCss.includes('100dvh'), 'uses dynamic viewport height for mobile browser chrome');
  assert.ok(hudCss.includes('@media (max-width: 1080px)'), 'tablet and narrow-tab breakpoint present');
  assert.ok(hudCss.includes('@media (max-height: 540px)'), 'phone landscape and short-tab breakpoint present');
  assert.ok(hudCss.includes('touch-action: none'), '3D garage stage handles touch orbit without page scroll');
  assert.ok(hudCss.includes('.sdh-forza-drone .sdh-map-shot { width: 100%; height: 100%;'), 'drone preview fits container');
});

console.log(`\n${passed} passed`);
