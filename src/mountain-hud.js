import { DEFAULT_SETTINGS, PAINT_OPTIONS, QUALITY_PRESETS, normalizeSettings } from './mountain-config.js';

function formatTime(seconds = 0) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toFixed(2).padStart(5, '0')}`;
}

function formatNumber(value) {
  return Math.round(Number(value) || 0).toLocaleString();
}

function createOptionMarkup(options, selected) {
  return options.map((option) => `<option value="${option.value}"${option.value === selected ? ' selected' : ''}>${option.label}</option>`).join('');
}

export class MountainHUD {
  constructor(root, settings = DEFAULT_SETTINGS) {
    this.root = root;
    this.root.classList.add('mountain-app');
    this.settings = normalizeSettings(settings);
    this.trackPoints = [];
    this.trackBounds = null;
    this.debugVisible = false;
    this.onStart = () => {};
    this.onPause = () => {};
    this.onResume = () => {};
    this.onRestart = () => {};
    this.onMenu = () => {};
    this.onOpenSettings = () => {};
    this.onCloseSettings = () => {};
    this.onApplySettings = () => {};
    this.onFullscreen = () => {};
    this.el = document.createElement('div');
    this.el.className = 'mountain-ui';
    this.el.innerHTML = `
      <section class="mountain-hud" data-hud>
        <div class="hud-brand"><span class="hud-kicker">MOUNTAIN STAGE 04</span><strong>RIDGE<span>RUN</span></strong></div>
        <div class="hud-top-left">
          <div class="hud-chip hud-mode-chip"><span>STAGE</span><strong data-run-mode>SPRINT</strong></div>
          <div class="hud-chip"><span>LAP</span><strong data-lap>1/1</strong></div>
          <div class="hud-chip hud-time"><span>TIME</span><strong data-time>0:00.00</strong></div>
          <div class="hud-chip hud-drift-chip"><span>DRIFT</span><strong data-drift-top>0</strong></div>
        </div>
        <div class="hud-top-center"><div class="hud-countdown" data-countdown></div><div class="hud-status" data-status>READY</div><div class="hud-wrong-way" data-wrong-way>WRONG WAY</div></div>
        <button class="hud-action hud-pause hud-pause-float" data-pause aria-label="Pause">Ⅱ</button>
        <div class="hud-top-right"><button class="hud-action hud-camera" data-camera>CAM</button><button class="hud-action hud-fullscreen" data-fullscreen aria-label="Fullscreen">⛶</button></div>
        <div class="hud-left-bottom"><div class="minimap-shell"><canvas width="220" height="220" data-minimap></canvas><span>STAGE MAP</span><b class="minimap-north">N</b></div><div class="surface-card"><span>SURFACE</span><strong data-surface>ASPHALT</strong></div></div>
        <div class="drift-card" data-drift-card><span class="drift-label">DRIFT COMBO</span><strong data-drift-score>0</strong><div class="drift-meta"><span data-drift-angle>0°</span><span data-drift-multiplier>x1</span></div><div class="drift-bar"><i data-drift-fill></i></div></div>
         <div class="speed-card"><div class="speed-ring"><div class="speed-ring-markings"></div><div class="speed-ring-numbers" aria-hidden="true"><span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span></div><i class="rpm-needle" data-rpm-needle aria-hidden="true"></i><div class="speed-readout"><strong data-speed>0</strong><span data-units>KM/H</span></div><div class="gear-readout"><span>GEAR</span><strong data-gear>N</strong></div><div class="gauge-label speed-rpm-label"><span>RPM</span><span data-rpm-value>900</span></div><div class="gauge rpm-gauge"><i data-rpm-fill></i></div></div><div class="nitro-column"><div class="gauge-label nitro-label"><span>N2O</span><span data-boost-value>100%</span></div><div class="gauge boost-gauge"><i data-boost-fill></i></div></div><div class="boost-cta" aria-label="Boost available"><strong>BOOST</strong><span>SHIFT</span></div></div>
        <div class="hud-debug hidden" data-debug></div>
      </section>
      <section class="screen menu-screen" data-menu>
        <div class="screen-card menu-card">
          <div class="eyebrow">MOUNTAIN STAGE / RALLY CHALLENGE</div>
          <h1>DESCEND<br><span>THE RIDGE</span></h1>
          <p class="screen-copy">Pick a line, commit to the descent, and keep the car clean through a procedural mountain stage built for speed and style.</p>
          <div class="menu-stage-strip"><span>STAGE 04</span><span>ALT. 2,840 M</span><span>RALLY / DRIFT</span></div>
          <div class="mode-grid"><button class="primary-button" data-start="sprint">SUMMIT SPRINT<span>1 LAP / TIME TRIAL</span></button><button class="secondary-button" data-start="drift">DRIFT SESSION<span>90 SEC / BANK SCORE</span></button><button class="secondary-button" data-start="circuit">RIDGE CIRCUIT<span>2 LAPS / ENDURANCE</span></button><button class="secondary-button" data-start="roam">FREE ROAM<span>EXPLORE THE TERRAIN</span></button></div>
          <div class="menu-actions"><button class="text-button" data-settings>SETTINGS</button><button class="text-button" data-menu-fullscreen>FULLSCREEN</button></div>
          <div class="menu-footer"><span>WASD / ARROWS DRIVE</span><span>SPACE DRIFT</span><span>C CAMERA</span><span>ESC PAUSE</span></div>
        </div>
      </section>
      <section class="screen pause-screen hidden" data-pause-screen>
        <div class="screen-card compact-card"><div class="eyebrow">STAGE PAUSED</div><h2>PAUSED</h2><p class="screen-copy" data-pause-copy>Take a breath. The ridge will wait.</p><div class="stack-actions"><button class="primary-button" data-resume>RESUME</button><button class="secondary-button" data-restart>RESTART RUN</button><button class="secondary-button" data-pause-settings>SETTINGS</button><button class="text-button" data-pause-menu>RETURN TO MENU</button></div></div>
      </section>
      <section class="screen finish-screen hidden" data-finish>
        <div class="screen-card compact-card"><div class="eyebrow" data-finish-kicker>RUN COMPLETE</div><h2 data-finish-title>Nice line.</h2><p class="screen-copy" data-finish-copy>The mountain keeps the score.</p><div class="result-grid"><div><span>TIME</span><strong data-result-time>0:00.00</strong></div><div><span>DRIFT BANK</span><strong data-result-score>0</strong></div><div><span>TOP SPEED</span><strong data-result-speed>0 KM/H</strong></div><div><span>RESPAWNS</span><strong data-result-respawns>0</strong></div></div><div class="stack-actions"><button class="primary-button" data-finish-restart>RUN IT BACK</button><button class="secondary-button" data-finish-menu>RETURN TO MENU</button></div></div>
      </section>
      <section class="screen settings-screen hidden" data-settings-screen>
        <div class="screen-card settings-card"><div class="settings-header"><div><div class="eyebrow">RALLY OPTIONS</div><h2>SETTINGS</h2></div><button class="close-button" data-close-settings aria-label="Close settings">×</button></div><div class="settings-grid"><label>Quality<select data-setting="quality">${createOptionMarkup(Object.keys(QUALITY_PRESETS).map((value) => ({ value, label: value })), this.settings.quality)}</select></label><label>Time of day<select data-setting="timeOfDay"><option value="dawn">Dawn</option><option value="day">Day</option><option value="sunset">Sunset</option><option value="night">Night</option></select></label><label>Paint<select data-setting="paint">${createOptionMarkup(PAINT_OPTIONS.map((option) => ({ value: option.id, label: option.label })), this.settings.paint)}</select></label><label>Handling preset<select data-setting="handling"><option value="Arcade">Arcade</option><option value="Balanced">Balanced</option><option value="Sim">Sim</option></select></label><label>Units<select data-setting="units"><option value="kmh">KM/H</option><option value="mph">MPH</option></select></label><label>Transmission<select data-setting="transmission"><option value="auto">Automatic</option><option value="manual">Manual</option></select></label><label class="range-field">Drift assist<div class="range-line"><input type="range" min="0" max="1" step="0.01" data-setting="driftAssist"><output data-drift-setting-value>0.68</output></div></label><label class="toggle-field"><input type="checkbox" data-setting="abs"><span>ABS</span><small>Brake stability assist</small></label></div><div class="settings-actions"><button class="primary-button" data-apply-settings>APPLY SETTINGS</button><button class="text-button" data-reset-settings>RESET DEFAULTS</button></div><div class="settings-hint">Changes persist locally in this browser. Keyboard bindings remain W/S/A/D, arrows, Space, C, R, T, Q/E, H, M, P, and F.</div></div>
      </section>
    `;
    this.root.appendChild(this.el);
    this.refs = {};
     this.el.querySelectorAll('[data-hud],[data-run-mode],[data-lap],[data-time],[data-countdown],[data-status],[data-wrong-way],[data-camera],[data-surface],[data-minimap],[data-drift-card],[data-drift-score],[data-drift-top],[data-drift-angle],[data-drift-multiplier],[data-drift-fill],[data-speed],[data-units],[data-gear],[data-rpm-value],[data-rpm-fill],[data-rpm-needle],[data-boost-value],[data-boost-fill],[data-debug],[data-menu],[data-pause-screen],[data-finish],[data-finish-kicker],[data-finish-title],[data-finish-copy],[data-result-time],[data-result-score],[data-result-speed],[data-result-respawns],[data-settings-screen],[data-pause-copy]').forEach((node) => {
      const name = [...node.attributes].find((attribute) => attribute.name.startsWith('data-'))?.name.slice(5);
      if (name) this.refs[name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = node;
    });
    this.refs.settings = Object.fromEntries([...this.el.querySelectorAll('[data-setting]')].map((node) => [node.dataset.setting, node]));
    this.refs.driftSettingValue = this.el.querySelector('[data-drift-setting-value]');
    this.refs.minimapContext = this.refs.minimap.getContext('2d');
    this.bindEvents();
    this.setSettings(this.settings);
    this.showMenu();
  }

  bindEvents() {
    this.el.querySelectorAll('[data-start]').forEach((button) => button.addEventListener('click', () => { this.onStart(button.dataset.start); }));
    this.el.querySelector('[data-settings]').addEventListener('click', () => this.openSettings('menu'));
    this.el.querySelector('[data-menu-fullscreen]').addEventListener('click', () => this.onFullscreen());
    this.el.querySelector('[data-camera]').addEventListener('click', () => this.onCamera?.());
    this.el.querySelector('[data-fullscreen]').addEventListener('click', () => this.onFullscreen());
    this.el.querySelector('[data-pause]').addEventListener('click', () => this.onPause());
    this.el.querySelector('[data-resume]').addEventListener('click', () => this.onResume());
    this.el.querySelector('[data-restart]').addEventListener('click', () => this.onRestart());
    this.el.querySelector('[data-pause-settings]').addEventListener('click', () => this.openSettings('pause'));
    this.el.querySelector('[data-pause-menu]').addEventListener('click', () => this.onMenu());
    this.el.querySelector('[data-finish-restart]').addEventListener('click', () => this.onRestart());
    this.el.querySelector('[data-finish-menu]').addEventListener('click', () => this.onMenu());
    this.el.querySelector('[data-close-settings]').addEventListener('click', () => { this.hideSettings(); this.onCloseSettings(); });
    this.el.querySelector('[data-apply-settings]').addEventListener('click', () => { this.settings = this.readSettings(); this.hideSettings(); this.onApplySettings(this.settings); });
    this.el.querySelector('[data-reset-settings]').addEventListener('click', () => this.setSettings(DEFAULT_SETTINGS));
    this.refs.settings.driftAssist.addEventListener('input', () => { this.refs.driftSettingValue.textContent = Number(this.refs.settings.driftAssist.value).toFixed(2); });
  }

  get touchRoot() {
    return this.el.querySelector('.mountain-touch-controls');
  }

  setSettings(settings) {
    this.settings = normalizeSettings(settings);
    Object.entries(this.refs.settings).forEach(([key, input]) => {
      if (key === 'abs') input.checked = this.settings[key];
      else input.value = this.settings[key];
    });
    this.refs.driftSettingValue.textContent = Number(this.settings.driftAssist).toFixed(2);
  }

  readSettings() {
    return normalizeSettings({
      quality: this.refs.settings.quality.value,
      timeOfDay: this.refs.settings.timeOfDay.value,
      paint: this.refs.settings.paint.value,
      handling: this.refs.settings.handling.value,
      units: this.refs.settings.units.value,
      transmission: this.refs.settings.transmission.value,
      driftAssist: Number(this.refs.settings.driftAssist.value),
      abs: this.refs.settings.abs.checked,
    });
  }

  setTrack(points, bounds) {
    this.trackPoints = points || [];
    this.trackBounds = bounds || null;
  }

  showMenu() {
    this.refs.menu.classList.remove('hidden');
    this.refs.pauseScreen.classList.add('hidden');
    this.refs.finish.classList.add('hidden');
    this.refs.settingsScreen.classList.add('hidden');
    this.refs.hud.classList.add('dimmed');
  }

  showRace() {
    this.refs.menu.classList.add('hidden');
    this.refs.pauseScreen.classList.add('hidden');
    this.refs.finish.classList.add('hidden');
    this.refs.settingsScreen.classList.add('hidden');
    this.refs.hud.classList.remove('dimmed');
  }

  showPause(mode = 'RUN SUSPENDED') {
    this.refs.menu.classList.add('hidden');
    this.refs.pauseScreen.classList.remove('hidden');
    this.refs.finish.classList.add('hidden');
    this.refs.settingsScreen.classList.add('hidden');
    this.refs.pauseCopy.textContent = mode;
  }

  showFinish(result = {}) {
    this.refs.menu.classList.add('hidden');
    this.refs.pauseScreen.classList.add('hidden');
    this.refs.finish.classList.remove('hidden');
    this.refs.settingsScreen.classList.add('hidden');
    this.refs.finishKicker.textContent = result.mode === 'drift' ? 'DRIFT SESSION COMPLETE' : 'RUN COMPLETE';
    this.refs.finishTitle.textContent = result.mode === 'roam' ? 'Summit reached.' : result.score > 0 ? 'Clean rotation.' : 'Line secured.';
    this.refs.finishCopy.textContent = result.mode === 'drift' ? 'The bank is yours. Try a longer link.' : 'The mountain keeps the score.';
    this.refs.resultTime.textContent = formatTime(result.time);
    this.refs.resultScore.textContent = formatNumber(result.score);
    this.refs.resultSpeed.textContent = `${Math.round(result.topSpeed || 0)} KM/H`;
    this.refs.resultRespawns.textContent = `${Math.round(result.respawns || 0)}`;
  }

  openSettings(source = 'menu') {
    this.settingsSource = source;
    this.refs.menu.classList.add('hidden');
    this.refs.pauseScreen.classList.add('hidden');
    this.refs.finish.classList.add('hidden');
    this.refs.settingsScreen.classList.remove('hidden');
  }

  hideSettings() {
    this.refs.settingsScreen.classList.add('hidden');
  }

  setCountdown(value) {
    this.refs.countdown.textContent = value || '';
    this.refs.countdown.classList.toggle('visible', Boolean(value));
  }

  setStateLabel(value) {
    this.refs.status.textContent = value;
  }

  setDebugVisible(value) {
    this.debugVisible = Boolean(value);
    this.refs.debug.classList.toggle('hidden', !this.debugVisible);
  }

  updateDebug(text) {
    if (this.debugVisible) this.refs.debug.textContent = text;
  }

  mapPoint(point, width, height) {
    if (!this.trackBounds) return { x: width * 0.5, y: height * 0.5 };
    const padding = 16;
    const x = (point.x - this.trackBounds.minX) / Math.max(1, this.trackBounds.maxX - this.trackBounds.minX) * (width - padding * 2) + padding;
    const y = (1 - (point.z - this.trackBounds.minZ) / Math.max(1, this.trackBounds.maxZ - this.trackBounds.minZ)) * (height - padding * 2) + padding;
    return { x, y };
  }

  drawMinimap(position, forward) {
    const canvas = this.refs.minimap;
    const context = this.refs.minimapContext;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(14, 31, 39, 0.96)';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = 'rgba(199, 255, 82, 0.14)';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(width * 0.5, height * 0.5, width * 0.34, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(width * 0.5, 12);
    context.lineTo(width * 0.5, height - 12);
    context.moveTo(12, height * 0.5);
    context.lineTo(width - 12, height * 0.5);
    context.stroke();
    if (this.trackPoints.length > 1) {
      context.strokeStyle = 'rgba(218, 239, 160, 0.2)';
      context.lineWidth = 7;
      context.beginPath();
      this.trackPoints.forEach((point, index) => {
        const mapped = this.mapPoint(point, width, height);
        if (index === 0) context.moveTo(mapped.x, mapped.y);
        else context.lineTo(mapped.x, mapped.y);
      });
      context.closePath();
      context.stroke();
      context.strokeStyle = 'rgba(199, 255, 82, 0.92)';
      context.lineWidth = 2.4;
      context.beginPath();
      this.trackPoints.forEach((point, index) => {
        const mapped = this.mapPoint(point, width, height);
        if (index === 0) context.moveTo(mapped.x, mapped.y);
        else context.lineTo(mapped.x, mapped.y);
      });
      context.closePath();
      context.stroke();
    }
    const player = this.mapPoint(position || { x: 0, z: 0 }, width, height);
    const angle = Math.atan2(forward?.x || 0, -(forward?.z || 1));
    context.save();
    context.translate(player.x, player.y);
    context.rotate(angle);
    context.fillStyle = '#c7ff52';
    context.strokeStyle = '#15231f';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(4.5, 5);
    context.lineTo(-4.5, 5);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  update({ pose = {}, session = {}, mode = 'sprint', camera = 'CHASE', debug = '' } = {}) {
    const speedKmh = pose.speedKmh || 0;
    const shownSpeed = this.settings.units === 'mph' ? speedKmh * 0.621371 : speedKmh;
    this.refs.runMode.textContent = mode.toUpperCase();
    this.refs.lap.textContent = `${session.lap || 1}/${session.laps || 1}`;
    this.refs.time.textContent = formatTime(session.elapsed || 0);
    this.refs.camera.textContent = camera;
    this.refs.surface.textContent = String(pose.surface || 'asphalt').toUpperCase();
    this.refs.speed.textContent = `${Math.round(shownSpeed)}`;
    this.refs.units.textContent = this.settings.units === 'mph' ? 'MPH' : 'KM/H';
    this.refs.gear.textContent = session.gear || 'N';
    this.refs.rpmValue.textContent = `${Math.round(session.rpm || 900)}`;
    this.refs.rpmFill.style.width = `${Math.min(100, Math.max(0, (session.rpm || 0) / 7600 * 100))}%`;
    const boostPercent = Math.min(100, Math.max(0, session.boost ?? 100));
     this.refs.boostValue.textContent = `${Math.round(boostPercent)}%`;
     this.refs.boostFill.style.width = `${boostPercent}%`;
     this.refs.boostFill.style.height = `${boostPercent}%`;
     const rpm = Math.min(7600, Math.max(0, Number(session.rpm) || 0));
     const needleAngle = -132 + (rpm / 7600) * 264;
     this.refs.rpmNeedle.style.transform = `rotate(${needleAngle}deg)`;
    const drift = pose.drift || {};
    const driftScore = (drift.bank || 0) + (drift.score || 0);
    this.refs.driftScore.textContent = formatNumber(driftScore);
    this.refs.driftTop.textContent = formatNumber(driftScore);
    this.refs.driftAngle.textContent = `${Math.round(Math.abs(drift.angleDeg || 0))}°`;
    this.refs.driftMultiplier.textContent = `x${drift.multiplier || 1}`;
    this.refs.driftFill.style.width = `${Math.min(100, Math.max(0, (drift.comboTimer || 0) / 1.35 * 100))}%`;
    this.refs.driftCard.classList.toggle('active', Boolean(drift.drifting));
    this.refs.wrongWay.classList.toggle('visible', Boolean(session.wrongWay));
    this.updateDebug(debug);
    this.drawMinimap(pose.position, pose.forward);
  }

  destroy() {
    this.el.remove();
  }
}
