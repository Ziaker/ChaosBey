// ============================================================
// ARENA A — FOUNDRY PIT (industrial steel bowl)
// Brushed-steel bowl with welded plate seams, a riveted wall of heavy
// steel segments with hazard striping, and warm overhead work lamps hung
// from a ring truss in a dark, hazy hall.
// ============================================================

import * as THREE from 'three';
import { ARENA_RADIUS, bowlFloor, canvasTexture, disposeTree, floorCanvas, onCircle, seededRandom, shadowed, skyDome } from './common';
import type { ArenaConcept, BuiltArena } from './types';

// ---------------- TUNING ----------------
const BOWL_DEPTH = 2.2;             // Default rim height above the center (m). Classic dish.
const WALL_HEIGHT = 1.8;            // Visible wall height above the rim (m).
const WALL_SEGMENTS = 16;           // Heavy steel wall panels around the ring.
const LAMP_COUNT = 4;               // Overhead work lamps.
const LAMP_COLOR = 0xffc38a;        // Warm sodium-ish work light.
const LAMP_INTENSITY = 260;         // Spot light intensity (physically based units).
const CLASH_LAMP_COLOR = 0xffffff;  // Lamps go white-hot during a Clash.
const HAZARD_ORANGE = '#f28a1c';
// -----------------------------------------

// Parabolic dish: flatter in the middle, steeper toward the wall.
const bowlProfile = (depth: number) => (r: number): number => depth * Math.pow(Math.min(r, ARENA_RADIUS) / ARENA_RADIUS, 2);

function paintFloor(): { color: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const { canvas, g, c, px } = floorCanvas();
  const rnd = seededRandom(11);
  g.fillStyle = '#3a3e45';
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Brushed noise.
  for (let i = 0; i < 26000; i++) {
    const v = 50 + rnd() * 26;
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},0.35)`;
    g.fillRect(rnd() * canvas.width, rnd() * canvas.height, 1 + rnd() * 18, 1);
  }
  // Center plate.
  g.fillStyle = '#4a4f57';
  g.beginPath(); g.arc(c, c, px(2.2), 0, Math.PI * 2); g.fill();
  g.lineWidth = px(0.06); g.strokeStyle = '#1d2024';
  g.stroke();
  // Welded radial seams with rivets.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.strokeStyle = '#1f2226';
    g.lineWidth = px(0.05);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * px(2.2), c + Math.sin(a) * px(2.2));
    g.lineTo(c + Math.cos(a) * px(12), c + Math.sin(a) * px(12));
    g.stroke();
    for (let r = 2.8; r < 11; r += 0.7) {
      g.fillStyle = '#6b717b';
      g.beginPath(); g.arc(c + Math.cos(a) * px(r) + px(0.12), c + Math.sin(a) * px(r), px(0.05), 0, Math.PI * 2); g.fill();
    }
  }
  // Concentric guide rings.
  for (const r of [5, 8.5]) {
    g.strokeStyle = 'rgba(15,17,20,0.9)';
    g.lineWidth = px(0.08);
    g.beginPath(); g.arc(c, c, px(r), 0, Math.PI * 2); g.stroke();
  }
  // Hazard band near the wall.
  const stripes = 96;
  for (let i = 0; i < stripes; i++) {
    const a0 = (i / stripes) * Math.PI * 2;
    const a1 = ((i + 1) / stripes) * Math.PI * 2;
    g.fillStyle = i % 2 === 0 ? HAZARD_ORANGE : '#15171a';
    g.beginPath();
    g.arc(c, c, px(11.95), a0, a1);
    g.arc(c, c, px(11.2), a1 + 0.02, a0 + 0.02, true);
    g.closePath();
    g.fill();
  }
  // Roughness map: seams/rings rougher, plates smoother.
  const r = floorCanvas(512);
  r.g.drawImage(canvas, 0, 0, 512, 512);
  const img = r.g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 255 - img.data[i]! * 0.9;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(80, Math.min(230, v));
  }
  r.g.putImageData(img, 0, 0);
  return { color: canvasTexture(canvas), rough: canvasTexture(r.canvas, false) };
}

function hazardTexture(): THREE.CanvasTexture {
  const { canvas, g } = floorCanvas(256);
  g.fillStyle = '#15171a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = HAZARD_ORANGE;
  for (let i = -4; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 64, 256); g.lineTo(i * 64 + 32, 256); g.lineTo(i * 64 + 96, 0); g.lineTo(i * 64 + 64, 0);
    g.fill();
  }
  const t = canvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(24, 1);
  return t;
}

export const FOUNDRY_PIT: ArenaConcept = {
  id: 'arena-a',
  letter: 'A',
  headline: 'Foundry Pit',
  description: 'Industrial steel bowl in a dark hall: welded plates, a riveted wall of heavy panels with hazard striping, and warm work lamps overhead.',
  answers: {
    architecture: 'Industrial machine pit: steel panels, ring truss, catwalk grating',
    floor: 'Brushed steel plates, welded seams, rivets; hazard band before the wall',
    boundary: '16 heavy riveted steel panels, hazard-striped top rail',
    lighting: '4 warm overhead work lamps (spots), dim cool fill, haze',
    background: 'Near-black hall fading into fog',
    impact: 'Orange-yellow sparks; hazard stripes glow and lamps flare white on Clash',
  },
  defaultDepth: BOWL_DEPTH,
  build(depth = BOWL_DEPTH): BuiltArena {
    const heightAt = bowlProfile(depth);
    const root = new THREE.Group();
    const R = ARENA_RADIUS;
    const rim = heightAt(R);

    const floorTex = paintFloor();
    const floor = shadowed(new THREE.Mesh(
      bowlFloor(R, heightAt),
      new THREE.MeshStandardMaterial({ map: floorTex.color, roughnessMap: floorTex.rough, metalness: 0.75, roughness: 1 }),
    ), false, true);
    root.add(floor);

    // Wall: heavy panels + base + hazard rail.
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x4b5058, metalness: 0.85, roughness: 0.42 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.7, roughness: 0.6 });
    const boltMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.3 });
    const chord = 2 * (R + 0.35) * Math.sin(Math.PI / WALL_SEGMENTS) * 1.02;
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2;
      const panel = onCircle(shadowed(new THREE.Mesh(new THREE.BoxGeometry(chord, WALL_HEIGHT + 0.4, 0.5), panelMat)), R + 0.35, a, rim + WALL_HEIGHT / 2 - 0.2);
      root.add(panel);
      for (let k = -2; k <= 2; k++) {
        for (const y of [-0.55, 0.55]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6).rotateX(Math.PI / 2), boltMat);
          bolt.position.set(k * chord * 0.2, y, 0.27);
          panel.add(bolt);
        }
      }
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.25, WALL_HEIGHT + 0.5, 0.7), darkMat);
      root.add(onCircle(shadowed(rib), R + 0.4, a + Math.PI / WALL_SEGMENTS, rim + WALL_HEIGHT / 2 - 0.15));
    }
    const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.55, metalness: 0.3, emissive: 0xff7a1a, emissiveIntensity: 0 });
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.62, R + 0.62, 0.32, 128, 1, true), hazardMat);
    rail.position.y = rim + WALL_HEIGHT + 0.02;
    root.add(rail);
    const railTop = new THREE.Mesh(new THREE.RingGeometry(R + 0.08, R + 0.66, 128).rotateX(-Math.PI / 2), darkMat);
    railTop.position.y = rim + WALL_HEIGHT + 0.18;
    root.add(railTop);

    // Catwalk grating outside the wall.
    const grate = shadowed(new THREE.Mesh(new THREE.RingGeometry(R + 0.6, R + 5, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x202328, metalness: 0.8, roughness: 0.7, wireframe: false })), false, true);
    grate.position.y = rim + WALL_HEIGHT - 0.1;
    root.add(grate);

    // Lighting: ring truss with work lamps.
    const truss = new THREE.Mesh(new THREE.TorusGeometry(8, 0.18, 8, 96).rotateX(Math.PI / 2), darkMat);
    truss.position.y = 15;
    root.add(truss);
    const lamps: THREE.SpotLight[] = [];
    const lensMat = new THREE.MeshStandardMaterial({ color: 0xffe2bd, emissive: LAMP_COLOR, emissiveIntensity: 2 });
    for (let i = 0; i < LAMP_COUNT; i++) {
      const a = (i / LAMP_COUNT) * Math.PI * 2 + Math.PI / 4;
      const pos = new THREE.Vector3(Math.cos(a) * 8, 14.6, Math.sin(a) * 8);
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 0.8, 16), darkMat);
      housing.position.copy(pos);
      housing.lookAt(0, 0, 0);
      housing.rotateX(Math.PI / 2);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.82, 24), lensMat);
      lens.position.set(0, -0.41, 0);
      lens.rotation.x = Math.PI / 2;
      housing.add(lens);
      root.add(housing);
      const spot = new THREE.SpotLight(LAMP_COLOR, LAMP_INTENSITY, 40, 0.62, 0.55, 1.6);
      spot.position.copy(pos);
      spot.target.position.set(-pos.x * 0.15, 0, -pos.z * 0.15);
      if (i === 0) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(2048, 2048);
        spot.shadow.bias = -0.0003;
        spot.shadow.normalBias = 0.03;
      }
      root.add(spot, spot.target);
      lamps.push(spot);
    }
    root.add(new THREE.HemisphereLight(0x6f7f99, 0x0b0b0c, 0.35));

    const flashLight = new THREE.PointLight(0xffa24a, 0, 9, 2);
    root.add(flashLight);
    root.add(skyDome(0x050608, 0x14161b, 0x050506));
    const fog = new THREE.FogExp2(0x0b0c10, 0.018);
    let flashT = 0;

    const baseColor = new THREE.Color(LAMP_COLOR);
    const clashColor = new THREE.Color(CLASH_LAMP_COLOR);
    return {
      root,
      depth,
      floorHeightAt: heightAt,
      wallRadius: R,
      sparkColors: [0xffe28a, 0xff6a14],
      exposure: 1.0,
      fog,
      environmentIntensity: 0.35,
      update({ time, dt, clash }) {
        const flicker = 1 + 0.03 * Math.sin(time * 37) * Math.sin(time * 11);
        lamps.forEach((l, i) => {
          l.color.copy(baseColor).lerp(clashColor, clash);
          l.intensity = LAMP_INTENSITY * flicker * (1 + clash * (0.6 + 0.4 * Math.sin(time * 18 + i)));
        });
        lensMat.emissiveIntensity = 2 + clash * 4;
        hazardMat.emissiveIntensity = clash * (0.6 + 0.4 * Math.sin(time * 10));
        flashT = Math.max(0, flashT - dt * 4);
        flashLight.intensity = flashT * 60;
      },
      flash(point) {
        flashLight.position.copy(point).setY(point.y + 0.6);
        flashT = 1;
      },
      dispose() {
        disposeTree(root);
      },
    };
  },
};
