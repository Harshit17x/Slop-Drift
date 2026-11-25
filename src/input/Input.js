// Keyboard, mouse (right-drag free look), gamepad and touch input.
// Produces one Controls-compatible snapshot per frame (see src/core/contracts.js), plus edge-triggered
// UI actions. Touch controls are only shown on coarse-pointer devices or after a real touch event.

import { CONFIG } from '../config.js';

export const KEY_BINDINGS = Object.freeze({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyC'],
  respawn: ['KeyR'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  transmission: ['KeyT'],
  headlights: ['KeyH'],
  neon: ['KeyG'],
  mute: ['KeyM'],
  pause: ['KeyP', 'Escape'],
  debug: ['F1'],
  lookBack: ['KeyB'],
  fullscreen: ['KeyF'],
});

/** Standard-mapping gamepad buttons. Triggers (6, 7) and sticks are read as analogue values. */
export const PAD_BUTTONS = Object.freeze({
  handbrake: 0, // A / Cross
  boost: 1, // B / Circle
  respawn: 2, // X / Square
  camera: 3, // Y / Triangle
  shiftDown: 4, // LB
  shiftUp: 5, // RB
  brake: 6, // LT (analogue)
  throttle: 7, // RT (analogue)
  transmission: 8, // View / Select
  pause: 9, // Menu / Start
  lookBack: 11, // R3
  headlights: 12, // D-pad up
});

const EDGE_ACTIONS = Object.freeze([
  'camera', 'respawn', 'transmission', 'headlights', 'neon', 'mute', 'pause', 'debug', 'fullscreen', 'shiftUp', 'shiftDown',
]);
const DRIVING_KEYS = new Set(['throttle', 'brake', 'steerLeft', 'steerRight', 'handbrake', 'boost']);
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1']);
const FREE_LOOK_X = 1.3;
const FREE_LOOK_Y = 0.58;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Elements whose keystrokes belong to the element, not the car. */
export function isFormField(target) {
  if (!target || target.nodeType !== 1) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isActivatable(target) {
  if (!target || target.nodeType !== 1) return false;
  const tag = target.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || target.getAttribute?.('role') === 'button';
}

/** Rescale an axis so the deadzone edge maps to 0 and full deflection to 1. */
export function applyDeadzone(value, deadzone) {
  const a = Math.abs(value);
  if (!(a > deadzone)) return 0;
  return Math.sign(value) * Math.min(1, (a - deadzone) / (1 - deadzone));
}

// Phone layout (landscape first): steering under the left thumb (two big arrows, or the analog slider
// from Settings), pedals under the right with the gas largest and outermost, handbrake and nitro above.
const TOUCH_MARKUP = `
  <div class="sdt-arrows" role="group" aria-label="Steering">
    <button type="button" class="sdt-btn sdt-arrow" data-touch="steerLeft" aria-label="Steer left"><span class="sdt-chev sdt-chev-l"></span></button>
    <button type="button" class="sdt-btn sdt-arrow" data-touch="steerRight" aria-label="Steer right"><span class="sdt-chev sdt-chev-r"></span></button>
  </div>
  <div class="sdt-steer" data-touch-steer aria-label="Steering pad" role="group">
    <div class="sdt-steer-track">
      <span class="sdt-chev sdt-chev-l" aria-hidden="true"></span>
      <span class="sdt-steer-centre" aria-hidden="true"></span>
      <span class="sdt-chev sdt-chev-r" aria-hidden="true"></span>
      <span class="sdt-knob" aria-hidden="true"></span>
    </div>
  </div>
  <div class="sdt-actions">
    <button type="button" class="sdt-btn sdt-small" data-touch="respawn" aria-label="Respawn">RESET</button>
    <button type="button" class="sdt-btn sdt-small sdt-shift" data-touch="shiftDown" aria-label="Shift down">−</button>
    <button type="button" class="sdt-btn sdt-small sdt-shift" data-touch="shiftUp" aria-label="Shift up">+</button>
  </div>
  <div class="sdt-pedals">
    <button type="button" class="sdt-btn sdt-hand" data-touch="handbrake" aria-label="Handbrake (drift)">
      <svg class="sdt-ico" viewBox="0 0 32 24" aria-hidden="true"><circle cx="16" cy="12" r="7.5"/><path d="M13.5 16.5v-9h3.2a2.6 2.6 0 0 1 0 5.2h-3.2M5.5 4.5a11 11 0 0 0 0 15M26.5 4.5a11 11 0 0 1 0 15"/></svg>
      <span class="sdt-lbl">DRIFT</span></button>
    <button type="button" class="sdt-btn sdt-boost" data-touch="boost" aria-label="Nitro (also accelerates)">
      <svg class="sdt-ico sdt-ico-fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M13 1.5c.6 4.2 6 6.3 6 12.3a7 7 0 0 1-14 0c0-3.4 1.9-5.4 3.2-7.6.1 3 1.8 4.4 3.1 4.7-.9-3.2-.4-6.6 1.7-9.4z"/></svg>
      <span class="sdt-lbl">N₂O</span></button>
    <button type="button" class="sdt-btn sdt-brake" data-touch="brake" aria-label="Brake">
      <svg class="sdt-ico" viewBox="0 0 32 24" aria-hidden="true"><rect x="3" y="4" width="26" height="16" rx="3"/><path d="M8 9.5h16M8 14.5h16"/></svg>
      <span class="sdt-lbl">BRAKE</span></button>
    <button type="button" class="sdt-btn sdt-gas" data-touch="throttle" aria-label="Gas">
      <svg class="sdt-ico" viewBox="0 0 20 32" aria-hidden="true"><rect x="3" y="2" width="14" height="28" rx="3"/><path d="M7 8h6M7 13h6M7 18h6M7 23h6"/></svg>
      <span class="sdt-lbl">GAS</span></button>
  </div>`;

export class Input {
  /**
   * @param {{root?: HTMLElement, touchRoot?: HTMLElement|null, bindings?: Object, deadzone?: number}} options
   */
  constructor({ root = document.body, touchRoot = null, bindings = KEY_BINDINGS, deadzone } = {}) {
    this.root = root;
    this.deadzone = deadzone ?? CONFIG.input?.deadzone ?? 0.12;
    this.drivingEnabled = false;

    // Keyboard
    this.codeToActions = new Map();
    for (const [action, codes] of Object.entries(bindings)) {
      for (const code of codes) {
        if (!this.codeToActions.has(code)) this.codeToActions.set(code, []);
        this.codeToActions.get(code).push(action);
      }
    }
    this.heldCodes = new Set();
    this.heldActions = new Map(); // action -> count of held keys mapped to it
    this.pending = new Set(); // edge actions since the last update()

    // Mouse free look
    this.look = { dragging: false, x: 0, y: 0 };

    // Gamepad
    this.prevPadButtons = [];
    this.padConnected = false;

    // Touch
    this.ownsTouchRoot = !touchRoot;
    this.touchRoot = touchRoot || this.createTouchRoot();
    this.nitroAvailable = true;
    this.touchPointers = new Map(); // pointerId -> action; one entry per finger, so fingers release independently
    this.steerPointer = null;
    this.steerValue = 0;
    this.steerRect = null;
    this.coarseQuery = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
    this.touchSeen = false;
    this.touchVisible = null;
    this.manualShift = false;

    this.installKeyboard();
    this.installPointer();
    this.installTouch();
    this.refreshTouchVisibility();
  }

  // ---------------------------------------------------------------- keyboard

  installKeyboard() {
    this.onKeyDown = (event) => {
      if (isFormField(event.target)) return;
      const code = event.code;
      if (isActivatable(event.target) && (code === 'Space' || code === 'Enter' || code === 'NumpadEnter')) return;
      if (event.metaKey || event.ctrlKey) return; // browser shortcuts (Cmd+R, Ctrl+W ...) must not drive
      const actions = this.codeToActions.get(code);
      if (!actions) return;
      if (PREVENT_DEFAULT.has(code)) event.preventDefault();
      if (!this.heldCodes.has(code)) {
        this.heldCodes.add(code);
        for (const action of actions) this.heldActions.set(action, (this.heldActions.get(action) || 0) + 1);
      }
      if (!event.repeat) {
        for (const action of actions) if (EDGE_ACTIONS.includes(action)) this.pending.add(action);
      }
      if (this.touchSeen && actions.some((a) => DRIVING_KEYS.has(a))) {
        // A keyboard is in use: hand the screen back to the scene.
        this.touchSeen = false;
        this.refreshTouchVisibility();
      }
    };
    this.onKeyUp = (event) => {
      const code = event.code;
      // macOS swallows keyup for other keys while Cmd is held, so drop everything when Cmd lifts.
      if (code === 'MetaLeft' || code === 'MetaRight') {
        this.releaseKeys();
        return;
      }
      this.releaseCode(code);
    };
    this.onBlur = () => this.releaseAll();
    this.onVisibility = () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    };
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  releaseCode(code) {
    if (!this.heldCodes.delete(code)) return;
    for (const action of this.codeToActions.get(code) || []) {
      const n = (this.heldActions.get(action) || 0) - 1;
      if (n > 0) this.heldActions.set(action, n);
      else this.heldActions.delete(action);
    }
  }

  releaseKeys() {
    this.heldCodes.clear();
    this.heldActions.clear();
  }

  releaseTouch() {
    this.touchPointers.clear();
    this.steerPointer = null;
    this.steerValue = 0;
    this.renderTouchState();
  }

  releaseAll() {
    this.releaseKeys();
    this.releaseTouch();
    this.pending.clear();
    this.look.dragging = false;
  }

  key(action) {
    return this.heldActions.has(action);
  }

  // ---------------------------------------------------------------- mouse

  installPointer() {
    this.onContextMenu = (event) => {
      if (this.look.dragging || event.target?.tagName === 'CANVAS' || this.touchRoot.contains(event.target)) {
        event.preventDefault();
      }
    };
    this.onPointerDown = (event) => {
      if (event.pointerType === 'touch') {
        if (!this.touchSeen) {
          this.touchSeen = true;
          this.refreshTouchVisibility();
        }
        return;
      }
      if (event.pointerType === 'mouse' && this.touchSeen && !this.coarseQuery?.matches) {
        this.touchSeen = false;
        this.refreshTouchVisibility();
      }
      if (event.pointerType === 'mouse' && event.button === 2 && !isFormField(event.target) && !isActivatable(event.target)) {
        this.look.dragging = true;
      }
    };
    this.onPointerMove = (event) => {
      if (!this.look.dragging) return;
      if (!(event.buttons & 2)) {
        this.look.dragging = false;
        return;
      }
      this.look.x = clamp(this.look.x - (event.movementX || 0) * 0.004, -FREE_LOOK_X, FREE_LOOK_X);
      this.look.y = clamp(this.look.y - (event.movementY || 0) * 0.003, -FREE_LOOK_Y, FREE_LOOK_Y);
    };
    this.onPointerUp = (event) => {
      if (event.pointerType === 'mouse' && !(event.buttons & 2)) this.look.dragging = false;
    };
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  // ---------------------------------------------------------------- touch

  createTouchRoot() {
    const element = document.createElement('div');
    element.className = 'sdh-touch';
    this.root.appendChild(element);
    return element;
  }

  installTouch() {
    if (!this.touchRoot.querySelector('[data-touch], [data-touch-steer]')) {
      this.touchRoot.insertAdjacentHTML('beforeend', TOUCH_MARKUP);
      this.injectedMarkup = true;
    }
    this.steerPad = this.touchRoot.querySelector('[data-touch-steer]');
    this.steerKnob = this.touchRoot.querySelector('.sdt-knob');
    this.touchButtons = [...this.touchRoot.querySelectorAll('[data-touch]')];
    this.touchListeners = [];
    const listen = (el, type, fn) => {
      el.addEventListener(type, fn, { passive: false });
      this.touchListeners.push([el, type, fn]);
    };

    for (const button of this.touchButtons) {
      const action = button.dataset.touch;
      listen(button, 'pointerdown', (event) => {
        event.preventDefault();
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        try { button.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
        this.touchPointers.set(event.pointerId, action);
        if (event.pointerType === 'touch') navigator.vibrate?.(8); // a tick under the thumb (Android; iOS has no vibrate)
        if (EDGE_ACTIONS.includes(action)) this.pending.add(action);
        this.renderTouchState();
      });
      const release = (event) => {
        if (this.touchPointers.get(event.pointerId) !== action) return;
        this.touchPointers.delete(event.pointerId);
        this.renderTouchState();
      };
      listen(button, 'pointerup', release);
      listen(button, 'pointercancel', release);
      listen(button, 'lostpointercapture', release);
      listen(button, 'contextmenu', (event) => event.preventDefault());
    }

    if (this.steerPad) {
      const setFromX = (clientX) => {
        const r = this.steerRect;
        if (!r || r.width <= 0) return;
        const half = r.width * 0.42;
        const raw = clamp((clientX - (r.left + r.width / 2)) / half, -1, 1);
        // Small centre deadzone, then a gentle curve for fine control near straight-ahead.
        const dz = applyDeadzone(raw, 0.06);
        this.steerValue = Math.sign(dz) * Math.pow(Math.abs(dz), 1.25);
        this.renderTouchState();
      };
      listen(this.steerPad, 'pointerdown', (event) => {
        event.preventDefault();
        if (this.steerPointer !== null) return;
        this.steerPointer = event.pointerId;
        this.steerRect = this.steerPad.getBoundingClientRect();
        try { this.steerPad.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        setFromX(event.clientX);
      });
      listen(this.steerPad, 'pointermove', (event) => {
        if (event.pointerId === this.steerPointer) setFromX(event.clientX);
      });
      const end = (event) => {
        if (event.pointerId !== this.steerPointer) return;
        this.steerPointer = null;
        this.steerValue = 0;
        this.renderTouchState();
      };
      listen(this.steerPad, 'pointerup', end);
      listen(this.steerPad, 'pointercancel', end);
      listen(this.steerPad, 'lostpointercapture', end);
    }

    this.onCoarseChange = () => this.refreshTouchVisibility();
    this.coarseQuery?.addEventListener?.('change', this.onCoarseChange);
  }

  touchHeld(action) {
    for (const a of this.touchPointers.values()) if (a === action) return true;
    return false;
  }

  renderTouchState() {
    for (const button of this.touchButtons) {
      const held = this.touchHeld(button.dataset.touch);
      if (button.classList.contains('is-held') !== held) button.classList.toggle('is-held', held);
    }
    if (this.steerKnob) {
      this.steerKnob.style.transform = `translateX(${(this.steerValue * 100).toFixed(1)}%)`;
      this.steerPad.classList.toggle('is-held', this.steerPointer !== null);
    }
  }

  refreshTouchVisibility() {
    const capable = Boolean(this.coarseQuery?.matches) || this.touchSeen;
    const visible = capable && (this.drivingEnabled || Boolean(this.touchStaged));
    if (visible === this.touchVisible) return;
    this.touchVisible = visible;
    this.touchRoot.classList.toggle('is-visible', visible);
    this.touchRoot.setAttribute('aria-hidden', String(!visible));
    if (!visible) this.releaseTouch();
    this.touchRoot.dispatchEvent(new CustomEvent('touchmodechange', { detail: { active: visible, capable } }));
  }

  /** True while on-screen touch controls are shown. */
  get touchActive() {
    return Boolean(this.touchVisible);
  }

  /** Show the touch shift buttons (manual transmission). */
  /** Touch steering: 'arrows' (two buttons, the default) or 'slider' (the analog pad). */
  setTouchSteer(mode) {
    this.touchRoot?.classList.toggle('is-slider', mode === 'slider');
  }

  setManualShift(enabled) {
    this.manualShift = Boolean(enabled);
    this.touchRoot.classList.toggle('is-manual', this.manualShift);
  }

  // ---------------------------------------------------------------- public

  /**
   * Show the touch controls before driving is enabled (the race countdown), so thumbs are in place
   * and a GAS held through GO carries on. Cleared once driving is enabled.
   */
  setTouchStaged(on) {
    this.touchStaged = Boolean(on);
    this.refreshTouchVisibility();
  }

  setDrivingEnabled(enabled) {
    const next = Boolean(enabled);
    if (next) this.touchStaged = false;
    if (next !== this.drivingEnabled) {
      this.drivingEnabled = next;
      if (!next) this.releaseTouch(); // a finger already on a pedal at GO keeps pressing it
      // Keep physical keys (their keyup still arrives) so holding W through GO works, but drop queued edges.
      this.pending.delete('shiftUp');
      this.pending.delete('shiftDown');
      this.pending.delete('respawn');
      this.pending.delete('camera');
    }
    this.refreshTouchVisibility();
  }

  readGamepad() {
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : null;
      if (pads) for (const p of pads) if (p && p.connected !== false) { pad = p; break; }
    } catch {
      pad = null;
    }
    if (!pad) {
      this.prevPadButtons.length = 0;
      return null;
    }
    const b = pad.buttons || [];
    const prev = this.prevPadButtons;
    const down = (i) => Boolean(b[i]?.pressed);
    const edge = (i) => down(i) && !prev[i];
    const value = (i) => {
      const v = b[i]?.value ?? (b[i]?.pressed ? 1 : 0);
      return applyDeadzone(v, 0.06);
    };
    const axes = pad.axes || [];
    const rx = applyDeadzone(axes[2] || 0, this.deadzone);
    const ry = applyDeadzone(axes[3] || 0, this.deadzone);
    const result = {
      steer: applyDeadzone(axes[0] || 0, this.deadzone),
      throttle: value(PAD_BUTTONS.throttle),
      brake: value(PAD_BUTTONS.brake),
      handbrake: down(PAD_BUTTONS.handbrake),
      boost: down(PAD_BUTTONS.boost),
      lookBack: down(PAD_BUTTONS.lookBack),
      camera: edge(PAD_BUTTONS.camera),
      respawn: edge(PAD_BUTTONS.respawn),
      pause: edge(PAD_BUTTONS.pause),
      transmission: edge(PAD_BUTTONS.transmission),
      headlights: edge(PAD_BUTTONS.headlights),
      shiftUp: edge(PAD_BUTTONS.shiftUp),
      shiftDown: edge(PAD_BUTTONS.shiftDown),
      lookX: rx,
      lookY: ry,
    };
    for (let i = 0; i < b.length; i += 1) prev[i] = down(i);
    prev.length = b.length;
    return result;
  }

  /** Cars without nitrous: the boost key does nothing and the touch N2O button is hidden. */
  setNitroAvailable(available) {
    this.nitroAvailable = Boolean(available);
    this.touchRoot?.querySelector('[data-touch="boost"]')?.toggleAttribute('hidden', !this.nitroAvailable);
  }

  /** Call once per frame. Returns a fresh snapshot object. */
  update() {
    const pad = this.readGamepad();
    const edges = this.pending;
    const driving = this.drivingEnabled;

    let throttle = this.key('throttle') || this.touchHeld('throttle') ? 1 : 0;
    let brake = this.key('brake') || this.touchHeld('brake') ? 1 : 0;
    let steer = (this.key('steerRight') ? 1 : 0) - (this.key('steerLeft') ? 1 : 0);
    const touchSteer = (this.touchHeld('steerRight') ? 1 : 0) - (this.touchHeld('steerLeft') ? 1 : 0);
    if (touchSteer !== 0) steer = touchSteer;
    if (this.steerPointer !== null) steer = this.steerValue;
    let handbrake = this.key('handbrake') || this.touchHeld('handbrake');
    let boost = this.key('boost') || this.touchHeld('boost');
    // One right thumb can't hold GAS and N2O together, so the touch N2O button also floors it.
    if (this.touchHeld('boost') && this.nitroAvailable) throttle = 1;
    let lookBack = this.key('lookBack') || this.touchHeld('lookBack');
    let up = edges.has('shiftUp');
    let downShift = edges.has('shiftDown');

    let lookX = this.look.x;
    let lookY = this.look.y;
    let lookActive = this.look.dragging;

    if (pad) {
      throttle = Math.max(throttle, pad.throttle);
      brake = Math.max(brake, pad.brake);
      if (pad.steer !== 0 && Math.abs(pad.steer) >= Math.abs(steer)) steer = pad.steer;
      handbrake = handbrake || pad.handbrake;
      boost = boost || pad.boost;
      lookBack = lookBack || pad.lookBack;
      up = up || pad.shiftUp;
      downShift = downShift || pad.shiftDown;
      if (pad.lookX !== 0 || pad.lookY !== 0) {
        lookX = -pad.lookX * FREE_LOOK_X;
        lookY = -pad.lookY * FREE_LOOK_Y;
        lookActive = true;
      }
    }

    const state = {
      throttle: driving ? clamp(throttle, 0, 1) : 0,
      brake: driving ? clamp(brake, 0, 1) : 0,
      steer: driving ? clamp(steer, -1, 1) : 0,
      handbrake: driving && Boolean(handbrake),
      boost: driving && this.nitroAvailable && Boolean(boost),
      shift: driving ? (up ? 1 : 0) - (downShift ? 1 : 0) : 0,
      camera: edges.has('camera') || Boolean(pad?.camera),
      respawn: edges.has('respawn') || Boolean(pad?.respawn),
      transmission: edges.has('transmission') || Boolean(pad?.transmission),
      headlights: edges.has('headlights') || Boolean(pad?.headlights),
      neon: edges.has('neon'),
      mute: edges.has('mute'),
      pause: edges.has('pause') || Boolean(pad?.pause),
      debug: edges.has('debug'),
      fullscreen: edges.has('fullscreen'),
      lookBack: driving && Boolean(lookBack),
      freeLook: { x: lookX, y: lookY, active: lookActive },
      gamepad: Boolean(pad),
    };
    edges.clear();
    return state;
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown, { passive: false });
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.coarseQuery?.removeEventListener?.('change', this.onCoarseChange);
    for (const [el, type, fn] of this.touchListeners) el.removeEventListener(type, fn, { passive: false });
    this.touchListeners = [];
    this.releaseAll();
    if (this.ownsTouchRoot) this.touchRoot.remove();
    else if (this.injectedMarkup) this.touchRoot.replaceChildren();
  }
}
