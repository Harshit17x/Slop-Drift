function button(label, className = '') {
  const node = document.createElement('button');
  node.className = `ui-button ${className}`;
  node.textContent = label;
  return node;
}

export class Menu {
  constructor(root) {
    this.root = root;
    this.el = document.createElement('section');
    this.el.className = 'menu-overlay';
    this.el.innerHTML = `
      <div class="menu-card">
        <div class="eyebrow">HUNGARORING // DRIFT LAB</div>
        <h1>APEX<br><span>RUN</span></h1>
        <p class="menu-subtitle">Arcade-sim handling · synthesized audio · pure browser physics</p>
        <div class="menu-actions"></div>
        <div class="menu-footer"><span>WASD / ARROWS TO DRIVE</span><span>F1 DEBUG</span></div>
      </div>
    `;
    root.appendChild(this.el);
    this.actions = this.el.querySelector('.menu-actions');
    this.onStart = () => {};
    this.onSettings = () => {};
    this.renderMain();
  }

  renderMain() {
    this.actions.replaceChildren();
    const modes = [
      ['Time Trial', 'time-trial'], ['Race vs AI', 'race'], ['Drift Challenge', 'drift'], ['Free Roam', 'free-roam'],
    ];
    modes.forEach(([label, id], index) => {
      const action = button(label, index === 0 ? 'primary' : '');
      action.addEventListener('click', () => this.onStart(id));
      this.actions.appendChild(action);
    });
    const settings = button('Settings');
    settings.addEventListener('click', () => this.onSettings());
    this.actions.appendChild(settings);
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }
}
