import { CONFIG } from './mountain-config.js';

const DEFAULT_BINDINGS = Object.freeze({
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  boost: ['ShiftLeft', 'ShiftRight'],
  camera: ['KeyC'],
  respawn: ['KeyR'],
  manualUp: ['KeyE'],
  manualDown: ['KeyQ'],
  transmission: ['KeyT'],
  headlights: ['KeyH'],
  mute: ['KeyM'],
  pause: ['KeyP', 'Escape'],
  debug: ['F1'],
  lookBack: ['KeyB'],
  fullscreen: ['KeyF'],
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function copyBindings(bindings) {
  return Object.fromEntries(Object.entries(bindings).map(([name, codes]) => [name, [...codes]]));
}

export class MountainInput {
  constructor({ root = document.body, touchRoot = null } = {}) {
    this.root = root;
    this.keys = new Set();
    this.previousKeys = new Set();
    this.touch = {};
    this.touchPulses = new Set();
    this.gamepadButtons = [];
    this.previousGamepadButtons = [];
    this.pointer = { active: false, x: 0, y: 0, rightDown: false };
    this.enabled = false;
    this.bindings = this.loadBindings();
    this.state = this.makeState();
    this.touchRoot = touchRoot || this.createTouchRoot();
    this.installKeyboard();
    this.installPointer();
    this.installTouch();
  }

  makeState() {
    return {
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: false,
      boost: false,
      camera: false,
      respawn: false,
      manualUp: false,
      manualDown: false,
      transmission: false,
      headlights: false,
      mute: false,
      pause: false,
      debug: false,
      lookBack: false,
      fullscreen: false,
      gamepad: false,
      freeLook: { x: 0, y: 0, active: false },
    };
  }

  loadBindings() {
    try {
      const stored = globalThis.localStorage?.getItem('mountain-drift-bindings-v1');
      return copyBindings(stored ? { ...DEFAULT_BINDINGS, ...JSON.parse(stored) } : DEFAULT_BINDINGS);
    } catch {
      return copyBindings(DEFAULT_BINDINGS);
    }
  }

  saveBindings() {
    try {
      globalThis.localStorage?.setItem('mountain-drift-bindings-v1', JSON.stringify(this.bindings));
    } catch {
      return;
    }
  }

  createTouchRoot() {
    const element = document.createElement('div');
    element.className = 'mountain-touch-controls';
    element.innerHTML = `
      <div class="touch-cluster touch-steer"><button data-touch="steerLeft" aria-label="Steer left">◀</button><button data-touch="steerRight" aria-label="Steer right">▶</button></div>
      <div class="touch-cluster touch-drive"><button data-touch="brake" aria-label="Brake">BRAKE</button><button data-touch="throttle" aria-label="Throttle">GO</button><button data-touch="handbrake" aria-label="Handbrake">DRIFT</button><button data-touch="boost" aria-label="Boost">BOOST</button></div>
      <div class="touch-cluster touch-actions"><button data-touch="camera" aria-label="Camera">CAM</button><button data-touch="pause" aria-label="Pause">Ⅱ</button></div>
    `;
    this.root.appendChild(element);
    return element;
  }

  installKeyboard() {
    this.onKeyDown = (event) => {
      this.keys.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    };
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onBlur = () => {
      this.keys.clear();
      Object.keys(this.touch).forEach((key) => { this.touch[key] = false; });
    };
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  installPointer() {
    this.onContextMenu = (event) => {
      if (this.pointer.rightDown || event.target?.tagName === 'CANVAS') {
        event.preventDefault();
      }
    };
    this.onPointerDown = (event) => {
      if (event.button === 2) {
        this.pointer.rightDown = true;
        this.pointer.active = true;
      }
    };
    this.onPointerUp = (event) => {
      if (event.button === 2) this.pointer.rightDown = false;
      if (!this.pointer.rightDown) this.pointer.active = false;
    };
    this.onPointerMove = (event) => {
      if (!this.pointer.rightDown) return;
      this.pointer.x = clamp(this.pointer.x - event.movementX * 0.004, -1.3, 1.3);
      this.pointer.y = clamp(this.pointer.y - event.movementY * 0.003, -0.58, 0.58);
    };
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  installTouch() {
    this.touchRoot.querySelectorAll('[data-touch]').forEach((button) => {
      const action = button.dataset.touch;
      const setValue = (value) => {
        this.touch[action] = value;
        button.classList.toggle('active', value);
      };
      const press = (event) => {
        event.preventDefault();
        this.touchPulses.add(action);
        setValue(true);
        button.setPointerCapture?.(event.pointerId);
      };
      const release = (event) => {
        event.preventDefault();
        setValue(false);
      };
      button.addEventListener('pointerdown', press, { passive: false });
      button.addEventListener('pointerup', release, { passive: false });
      button.addEventListener('pointercancel', release, { passive: false });
      button.addEventListener('pointerleave', release, { passive: false });
    });
  }

  setDrivingVisible(value) {
    this.enabled = Boolean(value);
    this.touchRoot.classList.toggle('visible', this.enabled);
    if (!this.enabled) {
      Object.keys(this.touch).forEach((key) => { this.touch[key] = false; });
      this.touchPulses.clear();
    }
  }

  isDown(action) {
    return (this.bindings[action] || []).some((code) => this.keys.has(code));
  }

  wasPressed(action, gamepadPressed = false) {
    const keyPressed = (this.bindings[action] || []).some((code) => this.keys.has(code) && !this.previousKeys.has(code));
    return keyPressed || Boolean(this.touchPulses.has(action)) || gamepadPressed;
  }

  readGamepad() {
    if (!navigator.getGamepads) return null;
    let pads = [];
    try {
      pads = [...navigator.getGamepads()];
    } catch {
      return null;
    }
    const pad = pads.find(Boolean);
    if (!pad) {
      this.gamepadButtons = [];
      this.previousGamepadButtons = [];
      return null;
    }
    const buttons = pad.buttons.map((button) => Boolean(button?.pressed));
    const pressed = (index) => Boolean(buttons[index] && !this.previousGamepadButtons[index]);
    const deadzone = CONFIG.input.deadzone;
    const normalize = (value) => Math.abs(value) < deadzone ? 0 : Math.sign(value) * ((Math.abs(value) - deadzone) / (1 - deadzone));
    const result = {
      steer: normalize(pad.axes?.[0] || 0),
      throttle: pad.buttons?.[7]?.value ?? 0,
      brake: pad.buttons?.[6]?.value ?? 0,
      handbrake: Boolean(buttons[0]),
      boost: Boolean(buttons[1]),
      camera: pressed(3),
      pause: pressed(9),
      pressed,
      active: true,
    };
    this.previousGamepadButtons = buttons;
    this.gamepadButtons = buttons;
    return result;
  }

  update() {
    const gamepad = this.readGamepad();
    const throttle = this.isDown('throttle') || Boolean(this.touch.throttle) ? 1 : 0;
    const brake = this.isDown('brake') || Boolean(this.touch.brake) ? 1 : 0;
    const keyboardSteer = (this.isDown('steerRight') || this.touch.steerRight ? 1 : 0) - (this.isDown('steerLeft') || this.touch.steerLeft ? 1 : 0);
    const steer = Math.abs(gamepad?.steer || 0) > 0.01 ? gamepad.steer : keyboardSteer;
    const state = {
      throttle: gamepad ? Math.max(throttle, gamepad.throttle) : throttle,
      brake: gamepad ? Math.max(brake, gamepad.brake) : brake,
      steer: clamp(steer, -1, 1),
      handbrake: Boolean(this.isDown('handbrake') || this.touch.handbrake || gamepad?.handbrake),
      boost: Boolean(this.isDown('boost') || this.touch.boost || gamepad?.boost),
      camera: this.wasPressed('camera', gamepad?.camera),
      respawn: this.wasPressed('respawn'),
      manualUp: this.wasPressed('manualUp'),
      manualDown: this.wasPressed('manualDown'),
      transmission: this.wasPressed('transmission'),
      headlights: this.wasPressed('headlights'),
      mute: this.wasPressed('mute'),
      pause: this.wasPressed('pause', gamepad?.pause),
      debug: this.wasPressed('debug'),
      lookBack: this.isDown('lookBack'),
      fullscreen: this.wasPressed('fullscreen'),
      gamepad: Boolean(gamepad?.active),
      freeLook: { x: this.pointer.x, y: this.pointer.y, active: this.pointer.active },
    };
    this.state = state;
    this.previousKeys = new Set(this.keys);
    this.touchPulses.clear();
    return this.state;
  }

  getState() {
    return this.state;
  }

  setBinding(action, codes) {
    this.bindings[action] = Array.isArray(codes) ? [...codes] : [codes];
    this.saveBindings();
  }

  getBindings() {
    return copyBindings(this.bindings);
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.touchRoot.remove();
  }
}
