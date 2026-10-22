function formatTime(milliseconds = 0) {
  const seconds = Math.max(0, milliseconds) / 1000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

function create(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = create('section', 'hud');
    this.el.innerHTML = `
      <div class="hud-top-left">
        <div class="race-chip"><span class="label">LAP</span><strong data-lap>1/3</strong></div>
        <div class="race-chip"><span class="label">POS</span><strong data-position>1/1</strong></div>
        <div class="race-chip timer-chip"><span class="label">TIME</span><strong data-lap-time>0:00.00</strong><small data-delta>BEST —</small></div>
      </div>
      <div class="hud-top-center"><div class="wrong-way" data-wrong-way>WRONG WAY</div><div class="countdown" data-countdown></div></div>
      <div class="hud-right"><div class="mode-pill" data-mode>TIME TRIAL</div><div class="surface-pill" data-surface>ASPHALT</div></div>
      <div class="drift-panel" data-drift-panel>
        <div class="drift-label">DRIFT COMBO</div><div class="drift-score" data-drift-score>0</div>
        <div class="drift-meta"><span data-drift-angle>0°</span><span data-drift-multiplier>x1</span></div>
        <div class="combo-track"><i data-combo-fill></i></div>
      </div>
      <div class="speed-cluster">
        <div class="speed-value"><strong data-speed>0</strong><span data-units>KM/H</span></div>
        <div class="gear-value" data-gear>N</div>
        <div class="rpm-track"><i data-rpm-fill></i><b data-rpm-redline></b></div>
        <div class="nitro-track"><span>NITRO</span><i data-nitro-fill></i></div>
      </div>
      <div class="speed-lines" data-speed-lines></div>
      <div class="debug-panel" data-debug></div>
    `;
    root.appendChild(this.el);
    this.refs = {};
    this.el.querySelectorAll('[data-lap],[data-position],[data-lap-time],[data-delta],[data-wrong-way],[data-mode],[data-surface],[data-drift-score],[data-drift-angle],[data-drift-multiplier],[data-combo-fill],[data-speed],[data-units],[data-gear],[data-rpm-fill],[data-nitro-fill],[data-speed-lines],[data-debug],[data-countdown]').forEach((node) => {
      const key = [...node.attributes].find((attribute) => attribute.name.startsWith('data-'))?.name.slice(5);
      if (key) this.refs[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = node;
    });
    this.units = 'kmh';
    this.visible = true;
  }

  setVisible(value) {
    this.visible = value;
    this.el.classList.toggle('hidden', !value);
  }

  setMode(mode) {
    if (this.refs.mode) this.refs.mode.textContent = mode.replace(/_/g, ' ').toUpperCase();
  }

  setUnits(units) {
    this.units = units;
    if (this.refs.units) this.refs.units.textContent = units === 'mph' ? 'MPH' : 'KM/H';
  }

  update(data = {}) {
    const kmh = data.speedKmh ?? 0;
    const speed = this.units === 'mph' ? kmh * 0.621371 : kmh;
    if (this.refs.speed) this.refs.speed.textContent = Math.round(speed).toString();
    if (this.refs.gear) this.refs.gear.textContent = data.gear ?? 'N';
    if (this.refs.lap) this.refs.lap.textContent = `${data.lap ?? 1}/${data.laps ?? 3}`;
    if (this.refs.position) this.refs.position.textContent = `${data.position ?? 1}/${data.totalCars ?? 1}`;
    if (this.refs.lapTime) this.refs.lapTime.textContent = formatTime(data.lapTime);
    if (this.refs.delta) {
      const best = data.bestLap ? formatTime(data.bestLap) : '—';
      this.refs.delta.textContent = `BEST ${best}`;
    }
    if (this.refs.wrongWay) this.refs.wrongWay.classList.toggle('visible', Boolean(data.wrongWay));
    if (this.refs.surface) this.refs.surface.textContent = (data.surface || 'asphalt').toUpperCase();
    const drift = data.drift || {};
    if (this.refs.driftScore) this.refs.driftScore.textContent = Math.round(drift.score || 0).toLocaleString();
    if (this.refs.driftAngle) this.refs.driftAngle.textContent = `${Math.round(Math.abs(drift.angleDeg || 0))}°`;
    if (this.refs.driftMultiplier) this.refs.driftMultiplier.textContent = `x${drift.multiplier || 1}`;
    if (this.refs.comboFill) this.refs.comboFill.style.width = `${Math.min(100, (drift.comboTimer || 0) / 1.5 * 100)}%`;
    this.el.classList.toggle('drifting', Boolean(drift.drifting));
    if (this.refs.rpmFill) this.refs.rpmFill.style.width = `${Math.min(100, ((data.rpm || 0) / 7500) * 100)}%`;
    if (this.refs.nitroFill) this.refs.nitroFill.style.width = `${Math.max(0, Math.min(100, data.nitro ?? 100))}%`;
    if (this.refs.speedLines) this.refs.speedLines.style.opacity = `${Math.min(0.75, Math.max(0, (kmh - 85) / 120))}`;
    if (data.debug && this.refs.debug) this.refs.debug.textContent = data.debug;
  }

  showCountdown(value) {
    if (!this.refs.countdown) return;
    this.refs.countdown.textContent = value || '';
    this.refs.countdown.classList.toggle('visible', Boolean(value));
  }
}
