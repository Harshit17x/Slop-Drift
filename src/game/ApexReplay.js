import {Vector3, Quaternion} from 'three';

const framesPerChunk = 256;
const valuesPerCar = 8;
const a = new Vector3(), b = new Vector3(), q = new Quaternion(), r = new Quaternion();

// One chunk holds 32 seconds at 8 Hz. Keep transforms for the whole session,
// including cars outside the live camera's culling radius.
export class ApexReplay {
  constructor(entrants) {
    this.stride = entrants * valuesPerCar;
    this.frames = 0;
    this.chunks = [];
    this.interval = .125;
    this.nextSample = 0;
  }
  record(time, player, field) {
    if (time < this.nextSample) return;
    this.nextSample += this.interval;
    const frame = this.frames % framesPerChunk;
    if (frame === 0) this.chunks.push(new Float32Array(framesPerChunk * this.stride));
    const chunk = this.chunks.at(-1);
    let offset = frame * this.stride;
    const write = (p, rotation, active) => {
      p.toArray(chunk, offset);
      rotation.toArray(chunk, offset + 3);
      chunk[offset + 7] = active ? 1 : 0;
      offset += valuesPerCar;
    };
    write(player.position, player.quaternion, true);
    for (const bot of field) write(bot.car.position, bot.car.quaternion, !bot.done);
    this.frames++;
  }
  get duration() { return Math.max(0, (this.frames - 1) * this.interval); }
  apply(seconds, index, object) {
    if (!this.frames) return;
    const sample = Math.max(0, Math.min(this.frames - 1, seconds / this.interval));
    const first = Math.floor(sample), last = Math.min(first + 1, this.frames - 1);
    const c = this.chunks[Math.floor(first / framesPerChunk)], d = this.chunks[Math.floor(last / framesPerChunk)];
    const i = first % framesPerChunk * this.stride + index * valuesPerCar;
    const j = last % framesPerChunk * this.stride + index * valuesPerCar;
    object.position.copy(a.fromArray(c, i)).lerp(b.fromArray(d, j), sample - first);
    object.quaternion.copy(q.fromArray(c, i + 3)).slerp(r.fromArray(d, j + 3), sample - first);
    object.visible = !!c[i + 7];
  }
}
