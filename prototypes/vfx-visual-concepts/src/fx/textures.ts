// ============================================================
// VFX LAB — PROCEDURAL SPRITE TEXTURES
// All effect textures are drawn on canvases at runtime (no image assets).
// Cached per page; never disposed (tiny, shared by every effect).
// ============================================================

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, size: number, draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(canvas);
  cache.set(key, t);
  return t;
}

/** Soft round glow. */
export const softDot = (): THREE.CanvasTexture => make('dot', 64, (g, s) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});

/** Lumpy smoke / dust puff. */
export const smokePuff = (): THREE.CanvasTexture => make('smoke', 128, (g, s) => {
  for (let i = 0; i < 14; i++) {
    const x = s / 2 + Math.cos(i * 2.4) * s * 0.16 * ((i % 3) + 1) * 0.5;
    const y = s / 2 + Math.sin(i * 1.7) * s * 0.16 * ((i % 4) + 1) * 0.45;
    const r = s * (0.18 + (i % 5) * 0.03);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
});

/** Anime impact star: spiky burst with a solid core. */
export const impactStar = (spikes = 10): THREE.CanvasTexture => make(`star${spikes}`, 256, (g, s) => {
  const c = s / 2;
  g.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const long = i % 2 === 0;
    const r = long ? c * (0.78 + ((i * 37) % 7) * 0.03) : c * 0.3;
    if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
});

/** Thin bright ring (for flat shockwaves). */
export const ringTexture = (): THREE.CanvasTexture => make('ring', 256, (g, s) => {
  const c = s / 2;
  const r = g.createRadialGradient(c, c, c * 0.62, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.55, 'rgba(255,255,255,1)');
  r.addColorStop(0.75, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});

/** Dark scuff / scorch mark for floor decals. */
export const scuffMark = (): THREE.CanvasTexture => make('scuff', 128, (g, s) => {
  const c = s / 2;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const len = c * (0.35 + ((i * 53) % 11) / 16);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * c * 0.12, c + Math.sin(a) * c * 0.12);
    g.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    g.stroke();
  }
  const r = g.createRadialGradient(c, c, 0, c, c, c * 0.45);
  r.addColorStop(0, 'rgba(0,0,0,0.7)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
});

/** Stylized ground crack (anime landing). */
export const crackMark = (): THREE.CanvasTexture => make('crack', 256, (g, s) => {
  const c = s / 2;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    let a = (i / 9) * Math.PI * 2 + (i % 2) * 0.2;
    let x = c;
    let y = c;
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) {
      a += ((k * 7 + i * 3) % 5 - 2) * 0.12;
      x += Math.cos(a) * s * 0.09;
      y += Math.sin(a) * s * 0.09;
      g.lineWidth = Math.max(1, 6 - k);
      g.lineTo(x, y);
    }
    g.stroke();
  }
});

/** Anime shockwave ring with a jagged, spiky outer edge (sonic-boom look). */
export const jaggedRing = (): THREE.CanvasTexture => make('jaggedRing', 512, (g, s) => {
  const c = s / 2;
  const teeth = 64;
  g.beginPath();
  for (let i = 0; i <= teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const spike = i % 2 === 0 ? 0.98 - ((i * 37) % 9) * 0.018 : 0.84;
    const r = c * spike;
    if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.closePath();
  g.arc(c, c, c * 0.74, 0, Math.PI * 2, true);
  g.fillStyle = '#ffffff';
  g.fill('evenodd');
  // Soft grey inner shade (two-tone cel look).
  g.globalCompositeOperation = 'source-atop';
  g.strokeStyle = 'rgba(150,160,175,0.55)';
  g.lineWidth = c * 0.05;
  g.beginPath();
  g.arc(c, c, c * 0.77, 0, Math.PI * 2);
  g.stroke();
});

/** Long torn brush stroke: jagged top/bottom edges, tapering to a point on the right. */
export const tornStreak = (): THREE.CanvasTexture => make('tornStreak', 512, (g, s) => {
  const h = s / 4;
  const mid = s / 2;
  const top: Array<[number, number]> = [];
  const bot: Array<[number, number]> = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const width = h * Math.pow(1 - t, 0.8) * Math.min(1, t * 8 + 0.3);
    const jag = (i % 2 === 0 ? 1 : 0.55) * (0.8 + ((i * 29) % 7) / 20);
    top.push([t * s, mid - width * jag]);
    bot.push([t * s, mid + width * (i % 3 === 0 ? 0.6 : 1) * 0.8]);
  }
  g.beginPath();
  top.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i]![0], bot[i]![1]);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  // Grey lower band = second cel tone.
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150,158,170,0.7)';
  g.fillRect(0, mid + h * 0.15, s, h);
});

/** Toon smoke: 3 flat grey tones with hard edges (cel-shaded dust cloud). */
export const toonSmoke = (): THREE.CanvasTexture => make('toonSmoke', 256, (g, s) => {
  const blobs: Array<[number, number, number]> = [];
  for (let i = 0; i < 9; i++) blobs.push([s * (0.3 + ((i * 37) % 40) / 100), s * (0.35 + ((i * 53) % 30) / 100), s * (0.13 + ((i * 17) % 8) / 100)]);
  const layer = (color: string, dx: number, dy: number, grow: number): void => {
    g.fillStyle = color;
    for (const [x, y, r] of blobs) {
      g.beginPath();
      g.arc(x + dx, y + dy, r * grow, 0, Math.PI * 2);
      g.fill();
    }
  };
  layer('#8d939c', 0, 0, 1);
  layer('#b9bec6', -s * 0.02, -s * 0.03, 0.85);
  layer('#e8ebef', -s * 0.04, -s * 0.06, 0.6);
});
