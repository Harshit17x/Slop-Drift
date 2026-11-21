#!/usr/bin/env python3
"""Build the car audio sprites used by src/audio/AudioEngine.js from the raw recordings in car-sound/.

    python3 tools/audio/build_car_audio.py            # writes src/assets/audio/*.m4a + src/audio/audioSprites.js

Needs numpy + scipy, and afconvert (macOS) or ffmpeg for the AAC encode.

Engine model: the BigSoundBank recording is a real engine doing two slow throttle ramps (firing
fundamental ~78 Hz -> ~160 Hz) each followed by a closed-throttle decay. Every engine cycle is marked
(phase of the tracked fundamental, aligned to the firing pulse), cut into a pitch-synchronous grain, and
pooled as on-load (rising rpm, throttle open) or off-load (falling rpm, throttle shut, overrun). Each
output layer is a seamless loop re-synthesised by pitch-synchronous overlap-add (TD-PSOLA) at a fixed
rpm: grains are re-spaced at the target firing period (so the firing rate is exact) and resampled by a
moderate factor (so the pulse shape tightens with rpm, as valve events do, without chipmunking the
exhaust resonances). Grain order, spacing and level get small random variation, like a real engine.
The runtime crossfades the layers by rpm with playbackRate = rpm / layerRpm (always within ~0.74..1.35).

Loops are written tiled (two periods + margin) so the runtime can cut one exact period out of the middle
regardless of AAC encoder delay; one-shots get leading-silence trimmed at runtime.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import scipy.io.wavfile as wavfile
import scipy.signal as ss

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'car-sound')
OUT = os.environ.get('CAR_AUDIO_OUT') or os.path.join(ROOT, 'src', 'assets', 'audio')
MANIFEST = os.environ.get('CAR_AUDIO_MANIFEST') or os.path.join(ROOT, 'src', 'audio', 'audioSprites.js')
SR = 44100
RNG = np.random.default_rng(20261121)

BSB_ENGINE = 'VEHCar_Car engine 2 (ID 0291)_BigSoundBank.com.wav'
BSB_SKID = 'VEHSkid_Screeching tires 1 (ID 2368)_BigSoundBank.com.wav'

# Engine layout. Firing frequency = rpm / RPM_PER_HZ (4 firings per revolution, V8-like note:
# 60 Hz at 900 rpm idle, 480 Hz at the 7200 rpm redline).
RPM_PER_HZ = 15.0
LAYER_RPM = [int(round(900 * (7600 / 900) ** (i / 7))) for i in range(8)]
LOOP_SECONDS = 1.6   # multiple of 10 ms so it is an integer sample count at 44.1k / 48k / 96k
SLOT_PAD = 0.2
SOURCE_HZ = 110.0


# ---------------------------------------------------------------------------------------------- io

def load(name, sr=SR):
    path = os.path.join(SRC, name)
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    try:
        if name.endswith('.wav'):
            rate, x = wavfile.read(path)
            if x.dtype.kind == 'i':
                x = x.astype(np.float64) / np.iinfo(x.dtype).max
            else:
                x = x.astype(np.float64)
        else:
            dec = shutil.which('ffmpeg')
            if not dec:
                raise SystemExit('ffmpeg needed to decode ' + name)
            subprocess.run([dec, '-loglevel', 'error', '-y', '-i', path, '-c:a', 'pcm_f32le', tmp], check=True)
            rate, x = wavfile.read(tmp)
            x = x.astype(np.float64)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if rate != sr:
        x = ss.resample_poly(x, sr, rate)
    return x


def encode(x, name, kbps=96):
    """Write mono float audio as AAC .m4a."""
    os.makedirs(OUT, exist_ok=True)
    peak = np.abs(x).max()
    if peak > 0.98:
        x = x * (0.98 / peak)
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False).name
    out = os.path.join(OUT, name)
    try:
        wavfile.write(tmp, SR, (x * 32767).astype(np.int16))
        if shutil.which('afconvert'):
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', '-b', str(kbps * 1000), '-q', '127', tmp, out], check=True)
        else:
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-c:a', 'aac', '-b:a', f'{kbps}k', out], check=True)
    finally:
        os.unlink(tmp)
    return os.path.getsize(out)


# ------------------------------------------------------------------------------------------ helpers

def butter(x, freq, kind='low', order=2):
    b, a = ss.butter(order, np.asarray(freq) / (SR / 2), kind)
    return ss.filtfilt(b, a, x)


def rms(x):
    return float(np.sqrt(np.mean(x * x) + 1e-20))


def resample(x, factor):
    """Speed up by `factor` (>1 = shorter and higher), linear interpolation on a band-limited signal."""
    n = max(2, int(round(len(x) / factor)))
    pos = np.arange(n) * factor
    return np.interp(pos, np.arange(len(x)), x)


def fade(x, fin=0.002, fout=0.01):
    x = x.copy()
    a = max(1, int(fin * SR))
    b = max(1, int(fout * SR))
    x[:a] *= np.linspace(0, 1, a)
    x[-b:] *= np.linspace(1, 0, b) ** 2
    return x


def seamless(x, loop_s, xfade_s):
    """Equal-power crossfade the tail over the head -> one loop of loop_s seconds."""
    n = int(round(loop_s * SR))
    xf = int(round(xfade_s * SR))
    seg = x[: n + xf].copy()
    t = np.linspace(0, np.pi / 2, xf)
    head = seg[:xf] * np.sin(t) + seg[n:n + xf] * np.cos(t)
    out = seg[:n].copy()
    out[:xf] = head
    return out


def tile(loop, pad=SLOT_PAD):
    """Two periods + a margin, so any one-period window in the middle loops seamlessly."""
    return np.concatenate([loop, loop, loop[: int(pad * SR)]])


def fit(x, n):
    return np.pad(x, (0, max(0, n - len(x))))[:n]


def circular_ola(n, events):
    out = np.zeros(n)
    for pos, grain in events:
        idx = (np.arange(len(grain)) + int(pos)) % n
        np.add.at(out, idx, grain)
    return out


# ------------------------------------------------------------------------------------------- engine

def track_f0(x):
    """Harmonic-sum f0 track constrained by dynamic programming (no octave jumps)."""
    hop = 256
    f, t, Z = ss.stft(x, SR, nperseg=4096, noverlap=4096 - hop, nfft=16384)
    M = np.abs(Z) ** 0.5
    cands = np.arange(68.0, 172.0, 0.25)
    df = f[1]
    score = np.zeros((len(cands), len(t)))
    for i, c in enumerate(cands):
        for k in range(1, 9):
            idx = int(round(k * c / df))
            score[i] += M[idx] / k ** 0.3
    score /= score.max(axis=0, keepdims=True) + 1e-12
    # Viterbi: penalise log-frequency jumps, max ~1.2 % per 5.8 ms hop.
    lc = np.log(cands)
    jump = np.abs(lc[:, None] - lc[None, :])
    trans = -40.0 * jump
    trans[jump > 0.012] = -1e9
    acc = score[:, 0].copy()
    back = np.zeros((len(cands), len(t)), dtype=np.int32)
    for j in range(1, len(t)):
        tot = acc[None, :] + trans
        back[:, j] = np.argmax(tot, axis=1)
        acc = tot[np.arange(len(cands)), back[:, j]] + score[:, j]
    path = np.zeros(len(t), dtype=np.int32)
    path[-1] = int(np.argmax(acc))
    for j in range(len(t) - 1, 0, -1):
        path[j - 1] = back[path[j], j]
    f0 = ss.savgol_filter(cands[path], 31, 2)
    return t, f0


def pitch_marks(x, t, f0):
    """Cycle marks from the demodulated phase of the fundamental, aligned to the firing pulse."""
    n = len(x)
    ts = np.arange(n) / SR
    fs = np.interp(ts, t, f0)
    phi = 2 * np.pi * np.cumsum(fs) / SR
    z = x * np.exp(-1j * phi)
    zb = butter(z.real, 25) + 1j * butter(z.imag, 25)
    theta = np.unwrap(np.angle(zb))
    phase = phi + theta
    # Align marks to the pulse: phase offset where the high-passed energy peaks on average.
    env = butter(butter(x, 400, 'high') ** 2, 300)
    bins = np.mod(phase, 2 * np.pi)
    hist = np.bincount((bins / (2 * np.pi) * 64).astype(int) % 64, weights=env, minlength=64)
    hist /= np.bincount((bins / (2 * np.pi) * 64).astype(int) % 64, minlength=64) + 1e-9
    psi = (np.argmax(np.convolve(np.r_[hist, hist, hist], np.ones(5) / 5, 'same')[64:128]) + 0.5) / 64 * 2 * np.pi
    cyc = (phase - psi) / (2 * np.pi)
    marks = np.nonzero(np.diff(np.floor(cyc)) > 0)[0] + 1
    return marks, fs


def collect_grains(x, marks, fs, windows):
    hp = butter(x, 2500, 'high')
    e = np.sqrt(np.convolve(hp * hp, np.ones(176) / 176, 'same'))
    base = ss.medfilt(e[::32], 101).repeat(32)[: len(e)] + 1e-6
    spiky = e / base
    grains = []
    for i in range(1, len(marks) - 1):
        m = marks[i]
        t = m / SR
        if not any(a <= t <= b for a, b in windows):
            continue
        left, right = m - marks[i - 1], marks[i + 1] - m
        seg = x[m - left: m + right]
        if spiky[m - left: m + right].max() > 2.2:
            continue  # an overrun crackle: those become one-shots, never part of a loop
        grains.append({'f': fs[m], 'seg': seg, 'left': left, 'right': right, 'rms': rms(seg)})
    return grains


def synth_layer(pool, rpm, seconds):
    """One seamless loop at a fixed rpm by pitch-synchronous overlap-add of real engine cycles."""
    F = rpm / RPM_PER_HZ
    fsrc = np.array([g['f'] for g in pool])
    lo_f = float(np.percentile(fsrc, 2))
    # Source grains: the cleanest, most harmonic part of the ramps sits around 105-115 Hz firing.
    # Resample factor grows gently with rpm (pulse tightening); the rest of the ratio is re-spacing.
    if F >= SOURCE_HZ:
        rs = (F / SOURCE_HZ) ** 0.62
        want = SOURCE_HZ
    else:
        want = float(np.clip(F, lo_f, SOURCE_HZ))
        rs = F / want
    dist = np.abs(np.log(fsrc / want))
    cand = np.sort(np.argsort(dist)[: max(24, int(np.sum(dist < 0.07)))])
    level = np.median([pool[i]['rms'] for i in cand])
    n = int(round(seconds * SR))
    period = SR / F
    count = int(round(n / period))
    # Cycle-to-cycle period variation: ~0.45 % at idle, ~0.15 % near redline.
    jit = 0.0035 * np.sqrt(80.0 / F)
    jitter = ss.lfilter([1.0], [1.0, -0.6], RNG.normal(0, jit, count))
    steps = period * (1 + jitter)
    steps *= n / steps.sum()
    pos = np.concatenate([[0.0], np.cumsum(steps)[:-1]])
    events = []
    ci = int(RNG.integers(len(cand)))
    step = 1
    for k in range(count):
        # Walk through consecutive recorded cycles (keeps the real cycle-to-cycle character),
        # bouncing at the ends of each contiguous run and jumping elsewhere now and then.
        nxt = ci + step
        if nxt < 0 or nxt >= len(cand) or cand[nxt] != cand[ci] + step or RNG.random() < 0.04:
            step = -step
            nxt = ci + step
            if nxt < 0 or nxt >= len(cand) or cand[nxt] != cand[ci] + step or RNG.random() < 0.5:
                nxt = int(RNG.integers(len(cand)))
        ci = nxt
        g = pool[cand[ci]]
        sig = resample(g['seg'], rs)
        c = int(round(g['left'] / rs))
        h = int(min(g['left'] / rs, period))
        h2 = int(min(g['right'] / rs, period))
        lo, hi = max(0, c - h), min(len(sig), c + h2)
        win = np.concatenate([np.hanning(2 * (c - lo) + 1)[: c - lo], np.hanning(2 * (hi - c) + 1)[hi - c:]])
        grain = sig[lo:hi] * win[: hi - lo] * (level / (g['rms'] + 1e-9)) ** 0.6 * (1 + RNG.normal(0, 0.04))
        events.append((pos[k] - (c - lo), grain))
    y = circular_ola(n, events)
    # Remove DC / sub-rumble and codec-unfriendly top end; work circularly so the loop stays seamless.
    Y = np.fft.rfft(y)
    fr = np.fft.rfftfreq(n, 1 / SR)
    Y *= 1 / np.sqrt(1 + (22 / np.maximum(fr, 1e-3)) ** 4)
    Y *= 1 / np.sqrt(1 + (fr / 15000) ** 8)
    y = np.fft.irfft(Y, n)
    return y / rms(y) * 0.12, rs, want


def build_engine():
    x = load(BSB_ENGINE)
    x = x / np.abs(x).max() * 0.9
    t, f0 = track_f0(x)
    marks, fs = pitch_marks(x, t, f0)
    on = collect_grains(x, marks, fs, [(0.40, 1.62), (2.68, 3.86)])
    off = collect_grains(x, marks, fs, [(1.70, 2.60), (3.92, 5.15)])
    print(f'engine: {len(marks)} cycles marked, {len(on)} on-load grains '
          f'({min(g["f"] for g in on):.0f}-{max(g["f"] for g in on):.0f} Hz), {len(off)} off-load grains '
          f'({min(g["f"] for g in off):.0f}-{max(g["f"] for g in off):.0f} Hz)')
    slots = []
    audio = []
    cursor = 0.0
    for load_name, pool in (('on', on), ('off', off)):
        for rpm in LAYER_RPM:
            y, rs, want = synth_layer(pool, rpm, LOOP_SECONDS)
            print(f'  {load_name} {rpm:5d} rpm  firing {rpm / RPM_PER_HZ:6.1f} Hz  resample x{rs:.2f}  grains @ ~{want:.0f} Hz')
            seg = tile(y)
            slots.append({'load': load_name, 'rpm': rpm, 'start': round(cursor, 4)})
            audio.append(seg)
            cursor += len(seg) / SR
    size = encode(np.concatenate(audio), 'engine.m4a', kbps=96)
    return {'file': 'engine.m4a', 'loop': LOOP_SECONDS, 'layers': slots, 'bytes': size}


# ------------------------------------------------------------------------------------- loops / sfx

def crackles():
    """Real overrun crackles cut from the decel phases of the engine recording."""
    x = load(BSB_ENGINE)
    x = x / np.abs(x).max() * 0.9
    hits = [2.081, 2.147, 2.233, 2.306, 4.067, 4.141, 4.241, 4.423]
    pops = []
    for h in hits:
        i = int((h - 0.004) * SR)
        seg = x[i: i + int(0.05 * SR)]
        seg = butter(seg, 260, 'high')
        env = np.exp(-np.arange(len(seg)) / (0.012 * SR))
        pops.append(fade(seg * env, 0.0008, 0.008))
    # "Brap" bursts: the real multi-crackle clusters (upshift blat / limiter backfire).
    braps = []
    for a, b in ((2.075, 2.150), (4.135, 4.260), (2.140, 2.240)):
        seg = x[int(a * SR): int(b * SR)]
        seg = butter(seg, 140, 'high')
        braps.append(fade(seg, 0.001, 0.02))
    return pops, braps


def build_loops_and_sfx():
    impact = load('kenney_impact.ogg')
    impact = impact / np.abs(impact).max() * 0.9
    shift = load('gear-shift.wav')
    nitro = load('nitro.ogg')
    kskid = load('kenney_skid.ogg')
    bskid = load(BSB_SKID)

    loops = {}
    # Tyre screech: Kenney skid (steady, lighter) and BigSoundBank screech (heavier, lower).
    loops['skid'] = seamless(kskid[int(0.3 * SR):], 2.4, 0.25)
    loops['skidHeavy'] = seamless(bskid[int(0.42 * SR):], 1.2, 0.2)
    # Nitro: the steady middle of the recorded N2O hiss.
    loops['nitro'] = seamless(nitro[int(1.2 * SR):], 3.0, 0.4)

    # Gravel crunch: thousands of tiny real impact transients (stones) at random times and pitches.
    n = int(2.0 * SR)
    tick = butter(impact[: int(0.012 * SR)], 900, 'high')
    events = []
    for p in RNG.uniform(0, n, 900):
        g = resample(tick, RNG.uniform(0.6, 2.2))
        g = g * np.hanning(len(g)) * RNG.exponential(0.25)
        events.append((p, g))
    gravel = circular_ola(n, events)
    loops['gravel'] = gravel

    # Metal / body scrape: a dense granular stream of the impact's metallic ring over a grinding
    # friction bed (recorded hiss, band-limited and chattered by a rough random envelope).
    ring = butter(impact[int(0.01 * SR): int(0.28 * SR)], 500, 'high')
    ring = ring / rms(ring)
    events = []
    for p in RNG.uniform(0, n, 700):
        a = RNG.integers(0, len(ring) - int(0.04 * SR))
        g = resample(ring[a: a + int(RNG.uniform(0.012, 0.035) * SR)], RNG.uniform(0.75, 1.4))
        events.append((p, g * np.hanning(len(g)) * RNG.uniform(0.4, 1.0)))
    grains = circular_ola(n, events)
    bed = seamless(butter(nitro[int(1.5 * SR):], (900, 6000), 'band'), n / SR, 0.1)
    chatter = np.abs(np.fft.irfft(np.fft.rfft(RNG.normal(0, 1, n)) * (np.fft.rfftfreq(n, 1 / SR) < 35), n))
    bed = bed / rms(bed) * (0.4 + chatter / rms(chatter))
    scrape = grains / rms(grains) + 0.6 * bed / rms(bed)
    loops['scrape'] = scrape

    loop_slots = {}
    audio = []
    cursor = 0.0
    for name, y in loops.items():
        y = y - y.mean()
        y = y / rms(y) * 0.12
        seg = tile(y)
        loop_slots[name] = {'start': round(cursor, 4), 'loop': round(len(y) / SR, 4)}
        audio.append(seg)
        cursor += len(seg) / SR
    loop_bytes = encode(np.concatenate(audio), 'loops.m4a', kbps=96)

    # One-shots.
    pops, braps = crackles()
    shots = {}
    for i, p in enumerate(pops):
        shots[f'crackle{i}'] = p
    for i, b in enumerate(braps):
        shots[f'brap{i}'] = b
    clunk = shift[: int(0.14 * SR)]
    thud = butter(impact, 380)[: int(0.12 * SR)]
    shots['clunkUp'] = fade(clunk + 0.35 * fit(resample(thud, 1.3), len(clunk)), 0.0005, 0.03)
    low = resample(clunk, 0.86)
    shots['clunkDown'] = fade(low + 0.45 * fit(thud, len(low)), 0.0005, 0.03)
    tick = butter(shift[: int(0.03 * SR)], 2200, 'high')
    shots['solenoid'] = fade(tick * np.exp(-np.arange(len(tick)) / (0.006 * SR)), 0.0003, 0.005)
    purge = butter(nitro[int(2.0 * SR): int(2.9 * SR)], 1400, 'high')
    shots['purge'] = fade(purge * np.exp(-np.arange(len(purge)) / (0.18 * SR)), 0.003, 0.05)
    shots['impactLight'] = fade(butter(impact, 320, 'high')[: int(0.16 * SR)] * np.exp(-np.arange(int(0.16 * SR)) / (0.045 * SR)), 0.0003, 0.02)
    shots['impact'] = fade(impact[: int(0.5 * SR)], 0.0003, 0.08)
    body = butter(resample(impact, 0.62), 420)[: int(0.75 * SR)]
    shots['impactBody'] = fade(body, 0.002, 0.12)
    debris = np.zeros(int(0.6 * SR))
    hi = butter(impact[: int(0.2 * SR)], 1800, 'high')
    for k in range(12):
        a0 = int(RNG.integers(0, int(0.08 * SR)))
        g = resample(hi[a0: a0 + int(RNG.uniform(0.04, 0.1) * SR)], RNG.uniform(1.1, 2.1))
        g = fade(g * np.exp(-np.arange(len(g)) / (RNG.uniform(0.008, 0.025) * SR)), 0.0004, 0.004)
        g = g * RNG.uniform(0.25, 0.8) * np.exp(-k / 6)
        at = int(min(0.45, RNG.exponential(0.12)) * SR) if k else 0
        debris[at: at + len(g)] += g[: len(debris) - at]
    shots['debris'] = fade(debris, 0.0005, 0.08)
    land = butter(resample(impact, 0.5), 260)[: int(0.4 * SR)]
    shots['landing'] = fade(land, 0.003, 0.08)
    chirp = bskid[int(0.04 * SR): int(0.40 * SR)]
    shots['chirp'] = fade(chirp * np.linspace(1, 0.3, len(chirp)), 0.004, 0.08)

    shot_slots = {}
    audio = []
    cursor = 0.0
    lead = int(0.06 * SR)
    for name, y in shots.items():
        y = y / (np.abs(y).max() + 1e-9) * 0.9
        seg = np.concatenate([np.zeros(lead), y, np.zeros(int(0.12 * SR))])
        shot_slots[name] = {'start': round(cursor, 4), 'length': round(len(seg) / SR, 4)}
        audio.append(seg)
        cursor += len(seg) / SR
    shot_bytes = encode(np.concatenate(audio), 'sfx.m4a', kbps=112)
    return ({'file': 'loops.m4a', 'slots': loop_slots, 'bytes': loop_bytes},
            {'file': 'sfx.m4a', 'slots': shot_slots, 'bytes': shot_bytes})


def write_manifest(engine, loops, sfx):
    data = {
        'engine': {'loop': engine['loop'], 'rpmPerHz': RPM_PER_HZ, 'layers': engine['layers']},
        'loops': loops['slots'],
        'sfx': sfx['slots'],
    }
    body = json.dumps(data, indent=2)
    with open(MANIFEST, 'w') as fh:
        fh.write('// Generated by tools/audio/build_car_audio.py -- do not edit by hand.\n')
        fh.write('// Slot offsets (seconds) inside src/assets/audio/{engine,loops,sfx}.m4a.\n')
        fh.write(f'export const SPRITES = {body};\n')


def main():
    engine = build_engine()
    loops, sfx = build_loops_and_sfx()
    write_manifest(engine, loops, sfx)
    total = engine['bytes'] + loops['bytes'] + sfx['bytes']
    print(f'engine.m4a {engine["bytes"] / 1024:.0f} KB, loops.m4a {loops["bytes"] / 1024:.0f} KB, '
          f'sfx.m4a {sfx["bytes"] / 1024:.0f} KB, total {total / 1024:.0f} KB')


if __name__ == '__main__':
    sys.exit(main())
