import { CONFIG } from '../config.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Input {
  constructor({ root = document.body } = {}) {
    this.root = root;
    this.keys = new Set();
    this.previous = new Set();
    this.state = this.makeState();
    this.pointer = { x: 0, y: 0, rightDown: false };
    this.bindings = JSON.parse(localStorage.getItem('race-bindings') || 'null') || structuredClone(CONFIG.input.bindings);
    this.touch = { left: false, right: false, throttle: false, brake: false, handbrake: false, nitro: false };
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
      nitro: false,
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
      freeLook: { x: 0, y: 0, active: false },
      gamepad: false,
    };
  }

  installKeyboard() {
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    }, { passive: false });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  installPointer() {
    window.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('pointerdown', (event) => { if (event.button === 2) this.pointer.rightDown = true; });
    window.addEventListener('pointerup', (event) => { if (event.button === 2) this.pointer.rightDown = false; });
    window.addEventListener('pointermove', (event) => {
      if (!this.pointer.rightDown) return;
      this.pointer.x = clamp(this.pointer.x - event.movementX * 0.004, -1.35, 1.35);
      this.pointer.y = clamp(this.pointer.y - event.movementY * 0.003, -0.55, 0.55);
    });
  }

  installTouch() {
    if (!('ontouchstart' in window)) return;
    const controls = document.createElement('div');
    controls.className = 'touch-controls';
    const buttons = [
      ['touch-left', '◀', 'left'], ['touch-right', '▶', 'right'],
      ['touch-brake', 'BRAKE', 'brake'], ['touch-throttle', 'GO', 'throttle'],
      ['touch-handbrake', 'DRIFT', 'handbrake'], ['touch-nitro', 'N₂O', 'nitro'],
    ];
    buttons.forEach(([className, label, key]) => {
      const button = document.createElement('button');
      button.className = className;
      button.textContent = label;
      const set = (value) => { this.touch[key] = value; button.classList.toggle('active', value); };
      button.addEventListener('touchstart', (event) => { event.preventDefault(); set(true); }, { passive: false });
      button.addEventListener('touchend', (event) => { event.preventDefault(); set(false); }, { passive: false });
      button.addEventListener('touchcancel', () => set(false));
      controls.appendChild(button);
    });
    this.root.appendChild(controls);
  }

  isDown(action) {
    return (this.bindings[action] || []).some((code) => this.keys.has(code));
  }

  wasPressed(action) {
    return (this.bindings[action] || []).some((code) => this.keys.has(code) && !this.previous.has(code));
  }

  axisFromGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad) return null;
    const dz = CONFIG.input.deadzone;
    const normalize = (value) => Math.abs(value) < dz ? 0 : Math.sign(value) * ((Math.abs(value) - dz) / (1 - dz));
    const steer = normalize(pad.axes?.[0] || 0);
    const throttle = pad.buttons?.[7]?.value ?? 0;
    const brake = pad.buttons?.[6]?.value ?? 0;
    return { steer, throttle, brake, handbrake: Boolean(pad.buttons?.[0]?.pressed), nitro: Boolean(pad.buttons?.[2]?.pressed), camera: Boolean(pad.buttons?.[3]?.pressed), gamepad: true };
  }

  update() {
    const gamepad = this.axisFromGamepad();
    const keyboardThrottle = this.isDown('throttle') || this.touch.throttle ? 1 : 0;
    const keyboardBrake = this.isDown('brake') || this.touch.brake ? 1 : 0;
    const keyboardSteer = (this.isDown('steerRight') || this.touch.right ? 1 : 0) - (this.isDown('steerLeft') || this.touch.left ? 1 : 0);
    this.state.throttle = gamepad ? Math.max(gamepad.throttle, keyboardThrottle) : keyboardThrottle;
    this.state.brake = gamepad ? Math.max(gamepad.brake, keyboardBrake) : keyboardBrake;
    this.state.steer = Math.abs(gamepad?.steer || 0) > 0.01 ? gamepad.steer : keyboardSteer;
    this.state.handbrake = Boolean(this.isDown('handbrake') || this.touch.handbrake || gamepad?.handbrake);
    this.state.nitro = Boolean(this.isDown('nitro') || this.touch.nitro || gamepad?.nitro);
    this.state.camera = this.wasPressed('camera') || Boolean(gamepad?.camera);
    this.state.respawn = this.wasPressed('respawn');
    this.state.manualUp = this.wasPressed('shiftUp');
    this.state.manualDown = this.wasPressed('shiftDown');
    this.state.transmission = this.wasPressed('transmission');
    this.state.headlights = this.wasPressed('headlights');
    this.state.mute = this.wasPressed('mute');
    this.state.pause = this.wasPressed('pause');
    this.state.debug = this.wasPressed('debug');
    this.state.lookBack = this.isDown('lookBack');
    this.state.freeLook = { x: this.pointer.x, y: this.pointer.y, active: this.pointer.rightDown };
    this.state.gamepad = Boolean(gamepad);
    this.previous = new Set(this.keys);
    return this.state;
  }

  getState() {
    return this.state;
  }

  setBinding(action, codes) {
    this.bindings[action] = Array.isArray(codes) ? codes : [codes];
    localStorage.setItem('race-bindings', JSON.stringify(this.bindings));
  }

  getBindings() {
    return structuredClone(this.bindings);
  }
}
