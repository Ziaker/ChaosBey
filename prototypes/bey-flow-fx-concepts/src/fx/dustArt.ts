// ============================================================
// BEY FLOW FX LAB — DUST ART (drawn from the owner's reference sheets)
// The first rounds drew the dust as circle clusters with a dark outline and it
// read as stickers. The sheets the owner sent do something else:
//
//   * flat white silhouettes, NO outline, with at most one soft grey second tone
//     on the underside (the black-background sheet);
//   * scalloped edges made of lobes of very different sizes (big in the middle,
//     small at the ends), a few small satellite puffs, a flat ragged base;
//   * negative space: flame-like tongues cut into the mass, a hollow in the ring;
//   * swept brush tails: thin tapered strokes that run off the base, some
//     detached, ending in needle points;
//   * the ground crown: a ring of puffs with long thin spikes radiating out.
//
// Everything here is plain 2D canvas drawing from a seeded generator (no THREE),
// so one drawing is always the same. `drawDust` paints the flat cel shapes;
// `erosionField` turns them into an alpha ramp (distance from the edge), so the
// effect can DISSOLVE by raising an alpha-test threshold: the thin tails and
// spikes die first and the mass shrinks from its edges, like hand-drawn smoke,
// instead of a plain opacity fade.
// ============================================================

export type DustKind = 'wave' | 'puff' | 'crown' | 'burst';

export interface DustSize {
  readonly w: number;
  readonly h: number;
}

/** Canvas size for each kind. */
export const DUST_SIZES: Readonly<Record<DustKind, DustSize>> = {
  wave: { w: 1024, h: 384 },
  puff: { w: 512, h: 384 },
  crown: { w: 768, h: 768 },
  burst: { w: 768, h: 768 },
};

export const DUST_VARIANTS = 4;

/** How far from the edge the erosion ramp reaches, as a fraction of the canvas width. */
export const ERODE_REACH = 0.07;

export const WHITE = '#ffffff';
export const GREY = '#c9d0dc';

/** mulberry32: a small deterministic generator. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A circle lobe: centre and radius in pixels. */
export interface Lobe {
  x: number;
  y: number;
  r: number;
}

/** A scalloped mass: a smooth core polygon plus bump circles sitting ON its top outline, so every bump leaves a clear cusp. */
export interface Mass {
  readonly core: ReadonlyArray<readonly [number, number]>;
  readonly lobes: readonly Lobe[];
  readonly x0: number;
  readonly x1: number;
  readonly base: number;
}

/**
 * A cumulus sitting on a base line. The top outline rises and falls like a bell; bumps of very different sizes are
 * strung along it with half of each sticking out (that is what keeps the cusps between them, as in the sheets), a few
 * bigger "hero" bumps near the peak, and small satellites off the top. Pure, so the tests can check it.
 */
export function cumulusMass(rand: () => number, x0: number, x1: number, base: number, height: number): Mass {
  const peak = 0.35 + rand() * 0.3;
  const profile = (u: number): number => {
    // A skewed hump: steeper on the side of the peak that is nearer its end.
    const k = u < peak ? u / peak : (1 - u) / (1 - peak);
    return Math.pow(Math.sin((Math.PI / 2) * Math.min(1, Math.max(0, k))), 0.8);
  };
  const topAt = (u: number): number => base - height * (0.18 + 0.82 * profile(u));
  const core: Array<readonly [number, number]> = [[x0, base]];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    core.push([x0 + (x1 - x0) * u, topAt(u) + height * 0.1]);
  }
  core.push([x1, base]);

  const lobes: Lobe[] = [];
  // Bumps along the outline: radius varies a lot and shrinks toward both ends.
  let u = 0.02;
  while (u < 0.98) {
    const ends = Math.min(1, Math.min(u, 1 - u) * 4);
    const r = height * (0.07 + rand() * 0.15) * (0.45 + 0.55 * ends) * (0.6 + 0.6 * profile(u));
    const x = x0 + (x1 - x0) * u;
    lobes.push({ x, y: topAt(u) + r * 0.3, r: Math.max(r, height * 0.04) });
    u += (r * 1.25) / (x1 - x0);
  }
  // The ends and the base are not a ruler: round lobes close each end, and small bumps ride the base line.
  for (const side of [0, 1]) {
    const r = height * (0.16 + rand() * 0.1);
    lobes.push({ x: side === 0 ? x0 + r * 0.55 : x1 - r * 0.55, y: base - r * 0.85, r });
  }
  const baseBumps = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < baseBumps; i++) {
    const r = height * (0.05 + rand() * 0.07);
    lobes.push({ x: x0 + (x1 - x0) * (0.08 + rand() * 0.84), y: base - r * 0.1, r });
  }
  // Hero bumps near the peak.
  const heroes = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < heroes; i++) {
    const hu = peak + (rand() - 0.5) * 0.35;
    const r = height * (0.2 + rand() * 0.12);
    lobes.push({ x: x0 + (x1 - x0) * Math.min(0.95, Math.max(0.05, hu)), y: topAt(hu) + r * 0.55, r });
  }
  // Satellites: small puffs just off the top.
  const sat = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < sat; i++) {
    const host = lobes[Math.floor(rand() * lobes.length)]!;
    const a = -Math.PI / 2 + (rand() - 0.5) * 2.4;
    lobes.push({ x: host.x + Math.cos(a) * host.r * 1.1, y: host.y + Math.sin(a) * host.r * 1.1, r: host.r * (0.18 + rand() * 0.16) });
  }
  return { core, lobes, x0, x1, base };
}

type Ctx = CanvasRenderingContext2D;

function fillLobes(g: Ctx, lobes: readonly Lobe[], dx: number, dy: number, grow: number): void {
  for (const l of lobes) {
    g.beginPath();
    g.arc(l.x + dx, l.y + dy, l.r * grow, 0, Math.PI * 2);
    g.fill();
  }
}

/** A thin tapered stroke from (x0, y) to (x1, y), thick at x0, a needle at x1, bowing by `bow` pixels. */
function sliver(g: Ctx, x0: number, x1: number, y: number, thick: number, bow: number): void {
  const steps = 24;
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = x0 + (x1 - x0) * u;
    const yy = y - Math.sin(u * Math.PI) * bow - (thick * (1 - u) ** 1.3) / 2;
    if (i === 0) g.moveTo(x, yy);
    else g.lineTo(x, yy);
  }
  for (let i = steps; i >= 0; i--) {
    const u = i / steps;
    const x = x0 + (x1 - x0) * u;
    g.lineTo(x, y - Math.sin(u * Math.PI) * bow + (thick * (1 - u) ** 1.3) / 2);
  }
  g.closePath();
  g.fill();
}

/** A flame-like tongue cut into the mass: a round belly and a long tail that sweeps up and toward `dir` (±1), then curls. */
function tongue(g: Ctx, x: number, y: number, size: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir, 1);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-size * 0.55, -size * 0.05, -size * 0.6, -size * 0.75, -size * 0.05, -size * 0.7);
  // The long swept tail, curling at the tip.
  g.bezierCurveTo(size * 0.2, -size * 1.0, size * 0.75, -size * 1.5, size * 1.5, -size * 1.45);
  g.bezierCurveTo(size * 1.1, -size * 1.3, size * 0.9, -size * 0.9, size * 0.7, -size * 0.55);
  g.bezierCurveTo(size * 0.55, -size * 0.2, size * 0.35, -size * 0.02, 0, 0);
  g.closePath();
  g.fill();
  g.restore();
}

export type Tongue = readonly [x: number, y: number, size: number, dir: number];

/** Paints the mass flat under a transform (shift and scale about its centre), cutting the tongues out with destination-out. */
function paintMass(g: Ctx, m: Mass, tongues: readonly Tongue[], color: string, dx: number, dy: number, scale: number): void {
  const cx = (m.x0 + m.x1) / 2;
  const cy = m.base;
  g.save();
  // Flat base: nothing under the base line.
  g.beginPath();
  g.rect(-2000, -2000, 6000, 2000 + m.base + dy + (m.base - m.x0) * 0 + 6);
  g.clip();
  g.translate(cx + dx, cy + dy);
  g.scale(scale, scale);
  g.translate(-cx, -cy);
  g.fillStyle = color;
  g.beginPath();
  m.core.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.fill();
  fillLobes(g, m.lobes, 0, 0, 1);
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  for (const [tx, ty, ts, dir] of tongues) tongue(g, tx, ty, ts, dir);
  g.restore();
}

/** The two-tone paint: a grey silhouette, then the lit white one pulled up/left and a bit smaller so grey shows on the underside. */
function twoTone(g: Ctx, m: Mass, tongues: readonly Tongue[], w: number, h: number): void {
  paintMass(g, m, tongues, GREY, w * 0.008, h * 0.02, 1);
  paintMass(g, m, tongues, WHITE, -w * 0.006, -h * 0.026, 0.95);
}

/**
 * Flame tongues cut into the top of the mass, their tails breaking through the outline into notches, all sweeping the
 * same way (with the motion), like the big cloud of the first sheet: few, of different sizes.
 */
function tonguesFor(rand: () => number, m: Mass, height: number, count: number, dir: number): Tongue[] {
  const out: Tongue[] = [];
  for (let i = 0; i < count; i++) {
    const u = 0.25 + ((i + 0.3 + rand() * 0.5) / count) * 0.5;
    const size = height * (0.12 + rand() * 0.16);
    out.push([m.x0 + (m.x1 - m.x0) * u, m.base - height * (0.42 + rand() * 0.22), size, dir]);
  }
  return out;
}

function drawWave(g: Ctx, rand: () => number, w: number, h: number): void {
  const base = h * 0.84;
  const x0 = w * 0.4;
  const x1 = w * 0.97;
  const height = h * (0.62 + rand() * 0.1);
  const m = cumulusMass(rand, x0, x1, base, height);
  twoTone(g, m, tonguesFor(rand, m, height, 2 + Math.floor(rand() * 2), -1), w, h);
  // Swept brush tails running off the base toward the left (toward the Bey): the first joined to the mass, the rest detached.
  g.fillStyle = WHITE;
  const tails = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < tails; i++) {
    const y = base - h * 0.012 - i * h * (0.05 + rand() * 0.03);
    const len = w * (0.5 - i * 0.07 + rand() * 0.06);
    const start = i === 0 ? x0 + w * 0.06 : x0 + w * (0.02 + rand() * 0.1) - i * w * 0.02;
    sliver(g, start, Math.max(w * 0.02, start - len), y, h * (i === 0 ? 0.075 : 0.034), h * (0.03 + rand() * 0.04));
  }
}

function drawPuff(g: Ctx, rand: () => number, w: number, h: number): void {
  const base = h * 0.86;
  const x0 = w * 0.14;
  const x1 = w * 0.92;
  const height = h * (0.7 + rand() * 0.12);
  const m = cumulusMass(rand, x0, x1, base, height);
  twoTone(g, m, tonguesFor(rand, m, height, 2, rand() < 0.5 ? -1 : 1), w, h);
  g.fillStyle = WHITE;
  for (let i = 0; i < 2; i++) sliver(g, x0 + w * 0.05, w * (0.01 + i * 0.05), base - h * (0.01 + i * 0.06), h * (i === 0 ? 0.06 : 0.03), h * 0.03);
}

/** A ring of puffs with spikes radiating out and a hollow centre (the ground crown). */
function drawCrown(g: Ctx, rand: () => number, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const ringR = w * 0.3;
  const lobes: Lobe[] = [];
  const n = 16 + Math.floor(rand() * 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const r = w * (0.045 + rand() * 0.05);
    const d = ringR * (0.92 + rand() * 0.2);
    lobes.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r });
    if (rand() < 0.5) lobes.push({ x: cx + Math.cos(a + 0.12) * d * 1.15, y: cy + Math.sin(a + 0.12) * d * 1.15, r: r * 0.55 });
  }
  // The spikes use their own seeded stream so the grey and the white copies match exactly.
  const seed = Math.floor(rand() * 1e9);
  const spikes = (color: string, dx: number, dy: number): void => {
    const rr = rng(seed);
    g.fillStyle = color;
    const m = 34;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + (rr() - 0.5) * 0.14;
      const long = rr() < 0.3;
      const inner = ringR * 0.95;
      const outer = ringR * (long ? 1.55 + rr() * 0.5 : 1.15 + rr() * 0.3);
      const half = (w * (long ? 0.006 : 0.012) * (0.8 + rr() * 0.5)) / ringR;
      g.beginPath();
      g.moveTo(cx + dx + Math.cos(a - half) * inner, cy + dy + Math.sin(a - half) * inner);
      g.lineTo(cx + dx + Math.cos(a) * outer, cy + dy + Math.sin(a) * outer);
      g.lineTo(cx + dx + Math.cos(a + half) * inner, cy + dy + Math.sin(a + half) * inner);
      g.closePath();
      g.fill();
    }
  };
  g.fillStyle = GREY;
  fillLobes(g, lobes, w * 0.004, h * 0.012, 1);
  spikes(GREY, w * 0.004, h * 0.012);
  g.fillStyle = WHITE;
  fillLobes(g, lobes, -w * 0.003, -h * 0.01, 0.92);
  spikes(WHITE, -w * 0.003, -h * 0.01);
  // Hollow centre.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(cx, cy, ringR * 0.72, ringR * 0.72, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // A few detached slivers drifting outside the spikes.
  g.fillStyle = WHITE;
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const d = ringR * (1.7 + rand() * 0.4);
    g.save();
    g.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    g.rotate(a);
    sliver(g, 0, w * 0.06, 0, w * 0.01, 2);
    g.restore();
  }
}

/** A cloud blast: a big scalloped mass with a few long thin needles, mostly low and to the sides, some detached. */
function drawBurst(g: Ctx, rand: () => number, w: number, h: number): void {
  const base = h * 0.7;
  const x0 = w * 0.16;
  const x1 = w * 0.84;
  const height = h * (0.5 + rand() * 0.08);
  const m = cumulusMass(rand, x0, x1, base, height);
  const cx = w / 2;
  const cy = base - height * 0.3;
  const seed = Math.floor(rand() * 1e9);
  const needles = (color: string, dx: number, dy: number): void => {
    const rr = rng(seed);
    g.fillStyle = color;
    const count = 11;
    for (let i = 0; i < count; i++) {
      // Concentrate the needles low and at the sides: pick an angle, skip most of the ones that point straight up.
      const a = (i / count) * Math.PI * 2 + (rr() - 0.5) * 0.4;
      const up = Math.sin(a) < -0.6;
      const roll = rr();
      if (up && roll < 0.7) continue;
      const long = rr() < 0.35;
      const len = h * (long ? 0.3 + rr() * 0.2 : 0.1 + rr() * 0.12);
      const start = h * (0.3 + rr() * 0.06);
      const half = 0.012 + rr() * 0.012;
      const detach = rr() < 0.3 ? h * 0.05 : 0;
      g.beginPath();
      g.moveTo(cx + dx + Math.cos(a - half) * (start + detach), cy + dy + Math.sin(a - half) * (start + detach) * 0.85);
      g.lineTo(cx + dx + Math.cos(a) * (start + detach + len), cy + dy + Math.sin(a) * (start + detach + len) * 0.85);
      g.lineTo(cx + dx + Math.cos(a + half) * (start + detach), cy + dy + Math.sin(a + half) * (start + detach) * 0.85);
      g.closePath();
      g.fill();
    }
  };
  needles(GREY, w * 0.006, h * 0.016);
  twoTone(g, m, tonguesFor(rand, m, height, 2, rand() < 0.5 ? -1 : 1), w, h);
  needles(WHITE, -w * 0.004, -h * 0.012);
}

/** Paints one dust shape (flat cel colours, transparent background) onto a canvas of `DUST_SIZES[kind]`. */
export function drawDust(g: Ctx, kind: DustKind, variant: number): void {
  const { w, h } = DUST_SIZES[kind];
  const rand = rng(variant * 7919 + kind.length * 104729 + kind.charCodeAt(0));
  g.clearRect(0, 0, w, h);
  if (kind === 'wave') drawWave(g, rand, w, h);
  else if (kind === 'puff') drawPuff(g, rand, w, h);
  else if (kind === 'crown') drawCrown(g, rand, w, h);
  else drawBurst(g, rand, w, h);
}

/**
 * Euclidean-ish distance (chamfer 3-4) from each OPAQUE pixel to the nearest transparent one, in pixels, written into
 * `dist` (0 outside). Pure, so the tests can run it on a tiny alpha map.
 */
export function insideDistance(alpha: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 128): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = alpha[i]! >= threshold ? INF : 0;
  const a = 3;
  const b = 4;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + a, at(x, y - 1) + a, at(x - 1, y - 1) + b, at(x + 1, y - 1) + b);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (d[i] === 0) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + a, at(x, y + 1) + a, at(x + 1, y + 1) + b, at(x - 1, y + 1) + b);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! >= INF ? 0 : d[i]! / a;
  return d;
}

/**
 * Rewrites the alpha of a painted canvas as an erosion ramp: 0 at and outside the edge, rising to 1 at `reach` pixels
 * inside. An alpha test of t then shows the shape eroded by t * reach pixels: tails and spikes vanish first.
 */
export function applyErosionAlpha(g: Ctx, w: number, h: number, reach: number): void {
  const img = g.getImageData(0, 0, w, h);
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = img.data[i * 4 + 3]!;
  const dist = insideDistance(alpha, w, h);
  for (let i = 0; i < w * h; i++) {
    const inside = alpha[i]! >= 128;
    // Pixels just inside the edge keep a little alpha so the shape is whole at threshold 0.
    img.data[i * 4 + 3] = inside ? Math.min(255, Math.round(255 * Math.min(1, (dist[i]! + 0.5) / reach))) : 0;
    if (!inside) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
