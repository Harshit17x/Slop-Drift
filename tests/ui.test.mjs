// Headless logic tests for the UI layer: node tests/ui.test.mjs
import assert from 'node:assert/strict';
import { formatTime, formatDelta, formatInt, recordKind, formatTarget, medalFor, validateName, normalizePartyCode, isPartyCode, paintColor } from '../src/ui/Hud.js';
import { applyDeadzone, isFormField, KEY_BINDINGS, PAD_BUTTONS } from '../src/input/Input.js';
import { normalizeTrack } from '../src/ui/Minimap.js';
import { MODES } from '../src/config.js';

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
  assert.deepEqual(kinds, { sprint: 'time', circuit: 'time', climb: 'time', descent: 'time', drift: 'score', peak: 'time', peakdown: 'time', roam: 'none' });
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

console.log(`\n${passed} passed`);
