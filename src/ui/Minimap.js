export class Minimap {
  constructor(root) {
    this.el = document.createElement('canvas');
    this.el.className = 'minimap';
    this.el.width = 240;
    this.el.height = 160;
    root.appendChild(this.el);
    this.ctx = this.el.getContext('2d');
    this.points = [];
    this.bounds = null;
  }

  setTrack(points, bounds) {
    this.points = points || [];
    this.bounds = bounds;
  }

  map(point) {
    if (!this.bounds) return { x: this.el.width / 2, y: this.el.height / 2 };
    const x = (point.x - this.bounds.min.x) / Math.max(1, this.bounds.max.x - this.bounds.min.x) * (this.el.width - 24) + 12;
    const y = (1 - (point.z - this.bounds.min.z) / Math.max(1, this.bounds.max.z - this.bounds.min.z)) * (this.el.height - 24) + 12;
    return { x, y };
  }

  update(playerPosition, aiPositions = []) {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.fillStyle = 'rgba(3, 8, 14, 0.78)';
    ctx.fillRect(0, 0, this.el.width, this.el.height);
    if (this.points.length) {
      ctx.strokeStyle = 'rgba(126, 247, 186, 0.72)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.points.forEach((point, index) => { const p = this.map(point); if (index) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.closePath();
      ctx.stroke();
    }
    aiPositions.forEach((position) => {
      const p = this.map(position);
      ctx.fillStyle = '#f35b6f';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
    });
    const player = this.map(playerPosition || { x: 0, z: 0 });
    ctx.fillStyle = '#ffe66d';
    ctx.beginPath(); ctx.arc(player.x, player.y, 4, 0, Math.PI * 2); ctx.fill();
  }
}
