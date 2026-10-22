import { CONFIG, applyPreset } from '../config.js';

export class Settings {
  constructor(root, input) {
    this.root = root;
    this.input = input;
    this.el = document.createElement('section');
    this.el.className = 'settings-overlay hidden';
    this.el.innerHTML = `
      <div class="settings-card">
        <div class="settings-header"><div><div class="eyebrow">SYSTEM TUNING</div><h2>Settings</h2></div><button class="icon-button" data-close>×</button></div>
        <div class="settings-grid">
          <label>Handling preset<select data-preset><option>Arcade</option><option selected>Balanced</option><option>Sim</option></select></label>
          <label>Graphics quality<select data-quality><option>Low</option><option>Medium</option><option selected>High</option><option>Ultra</option></select></label>
          <label>Transmission<select data-transmission><option value="auto" selected>Automatic</option><option value="manual">Manual</option></select></label>
          <label>Units<select data-units><option value="kmh" selected>KM/H</option><option value="mph">MPH</option></select></label>
          <label>Drift assist<input type="range" min="0" max="1" step="0.05" value="0.7" data-drift-assist><output data-drift-value>0.70</output></label>
          <label>Steering sensitivity<input type="range" min="0.5" max="1.5" step="0.05" value="1" data-steering><output data-steering-value>1.00</output></label>
          <label class="toggle-label"><input type="checkbox" checked data-abs> ABS</label>
          <label class="toggle-label"><input type="checkbox" checked data-shadows> Shadows</label>
        </div>
        <div class="settings-actions"><button class="ui-button primary" data-save>Apply</button><button class="ui-button" data-reset>Reset to Balanced</button></div>
        <div class="rebinding"><div class="eyebrow">KEY BINDS</div><p>Click a bind then press a key.</p><div data-bindings></div></div>
      </div>
    `;
    root.appendChild(this.el);
    this.refs = {
      preset: this.el.querySelector('[data-preset]'), quality: this.el.querySelector('[data-quality]'), transmission: this.el.querySelector('[data-transmission]'), units: this.el.querySelector('[data-units]'),
      driftAssist: this.el.querySelector('[data-drift-assist]'), driftValue: this.el.querySelector('[data-drift-value]'), steering: this.el.querySelector('[data-steering]'), steeringValue: this.el.querySelector('[data-steering-value]'), abs: this.el.querySelector('[data-abs]'), shadows: this.el.querySelector('[data-shadows]'), bindings: this.el.querySelector('[data-bindings]'),
    };
    this.el.querySelector('[data-close]').addEventListener('click', () => this.hide());
    this.el.querySelector('[data-save]').addEventListener('click', () => this.apply());
    this.el.querySelector('[data-reset]').addEventListener('click', () => { this.refs.preset.value = 'Balanced'; this.refs.driftAssist.value = '0.7'; this.updateOutputs(); });
    this.refs.driftAssist.addEventListener('input', () => this.updateOutputs());
    this.refs.steering.addEventListener('input', () => this.updateOutputs());
    this.pendingBind = null;
    this.renderBindings();
    window.addEventListener('keydown', (event) => {
      if (!this.pendingBind) return;
      event.preventDefault();
      this.input.setBinding(this.pendingBind, [event.code]);
      this.pendingBind = null;
      this.renderBindings();
    }, true);
  }

  updateOutputs() {
    this.refs.driftValue.value = Number(this.refs.driftAssist.value).toFixed(2);
    this.refs.steeringValue.value = Number(this.refs.steering.value).toFixed(2);
  }

  renderBindings() {
    this.refs.bindings.replaceChildren();
    Object.entries(this.input.getBindings()).slice(0, 10).forEach(([action, codes]) => {
      const row = document.createElement('div');
      row.className = 'bind-row';
      row.innerHTML = `<span>${action}</span><button class="bind-key">${codes.join(' / ')}</button>`;
      row.querySelector('button').addEventListener('click', () => { this.pendingBind = action; row.querySelector('button').textContent = 'PRESS KEY'; });
      this.refs.bindings.appendChild(row);
    });
  }

  apply() {
    applyPreset(this.refs.preset.value);
    CONFIG.graphics.quality = this.refs.quality.value;
    CONFIG.brakes.abs = this.refs.abs.checked;
    CONFIG.graphics.shadows = this.refs.shadows.checked;
    CONFIG.car.steeringResponse = 8.5 * Number(this.refs.steering.value);
    CONFIG.drift.assistStrength = Number(this.refs.driftAssist.value);
    this.input.setBinding('transmission', this.refs.transmission.value === 'manual' ? ['KeyT'] : ['KeyT']);
    this.onChange?.({ units: this.refs.units.value });
    this.hide();
  }

  show() { this.el.classList.remove('hidden'); this.updateOutputs(); }
  hide() { this.el.classList.add('hidden'); }
}
