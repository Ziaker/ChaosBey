// ============================================================
// ARENA C — TOURNAMENT STADIUM (bright competitive venue)
// Clean light polymer bowl with sports-style markings, a transparent
// polycarbonate wall on metal posts with an LED rail, tiered stands with
// a crowd, and a bright overhead light rig. Maximum readability.
// ============================================================

import * as THREE from 'three';
import { ARENA_RADIUS, bowlFloor, canvasTexture, disposeTree, floorCanvas, seededRandom, shadowed, skyDome } from './common';
import type { ArenaConcept, BuiltArena } from './types';

// ---------------- TUNING ----------------
const BOWL_DEPTH = 2.2;            // Default rim height above the center (m).
const FLAT_CENTER = 2.6;           // Flat center plateau radius (m).
const WALL_HEIGHT = 1.9;           // Polycarbonate wall height (m).
const POSTS = 24;
const RIG_SPOTS = 8;
const RIG_INTENSITY = 230;
const LED_COLOR = 0xe8f2ff;
const CLASH_COLORS = [0x3fa9ff, 0xff4f4f] as const; // LED rail alternates on Clash.
const CROWD = 1500;
// -----------------------------------------

// Flat center plateau, then a curved slope up to the wall.
const bowlProfile = (depth: number) => (r: number): number =>
  r <= FLAT_CENTER ? 0 : depth * Math.pow((Math.min(r, ARENA_RADIUS) - FLAT_CENTER) / (ARENA_RADIUS - FLAT_CENTER), 1.4);

function paintFloor(): THREE.CanvasTexture {
  const { canvas, g, c, px } = floorCanvas();
  const rnd = seededRandom(5);
  g.fillStyle = '#aeb6c1';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 30000; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(120,130,145,0.25)';
    g.fillRect(rnd() * canvas.width, rnd() * canvas.height, 2, 2);
  }
  // Two faint player halves.
  for (const [start, color] of [[Math.PI / 2, 'rgba(63,169,255,0.16)'], [-Math.PI / 2, 'rgba(255,79,79,0.14)']] as const) {
    g.fillStyle = color;
    g.beginPath(); g.arc(c, c, px(10.4), start, start + Math.PI); g.arc(c, c, px(3), start + Math.PI, start, true); g.fill();
  }
  // Lines.
  g.strokeStyle = '#ffffff';
  for (const [r, w] of [[2.6, 0.09], [3, 0.05], [6.5, 0.05], [10.4, 0.1]] as const) {
    g.lineWidth = px(w);
    g.beginPath(); g.arc(c, c, px(r), 0, Math.PI * 2); g.stroke();
  }
  g.lineWidth = px(0.05);
  g.beginPath(); g.moveTo(c - px(10.4), c); g.lineTo(c - px(3), c); g.moveTo(c + px(3), c); g.lineTo(c + px(10.4), c); g.stroke();
  // Faint contour rings every meter so the slope reads on the light floor.
  g.strokeStyle = 'rgba(40,50,64,0.16)';
  g.lineWidth = px(0.03);
  for (let r = 3.5; r < 10.4; r += 1) {
    g.beginPath(); g.arc(c, c, px(r), 0, Math.PI * 2); g.stroke();
  }
  // Outer danger band + ticks.
  g.fillStyle = '#d4463d';
  g.beginPath(); g.arc(c, c, px(12), 0, Math.PI * 2); g.arc(c, c, px(10.6), 0, Math.PI * 2, true); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = px(0.06);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    g.beginPath(); g.moveTo(c + Math.cos(a) * px(10.7), c + Math.sin(a) * px(10.7)); g.lineTo(c + Math.cos(a) * px(11.1), c + Math.sin(a) * px(11.1)); g.stroke();
  }
  // Neutral center emblem: abstract chevron, no text.
  g.fillStyle = '#20262f';
  g.beginPath(); g.arc(c, c, px(2.45), 0, Math.PI * 2); g.fill();
  g.fillStyle = '#e8edf3';
  g.beginPath();
  g.moveTo(c, c - px(1.5)); g.lineTo(c + px(1.3), c + px(0.9)); g.lineTo(c, c + px(0.35)); g.lineTo(c - px(1.3), c + px(0.9));
  g.closePath(); g.fill();
  return canvasTexture(canvas);
}

export const TOURNAMENT_STADIUM: ArenaConcept = {
  id: 'arena-c',
  letter: 'C',
  headline: 'Tournament Stadium',
  description: 'Bright competitive venue: a light polymer bowl with sports markings, a clear polycarbonate wall with an LED rail, stands with a crowd and a big light rig.',
  answers: {
    architecture: 'Indoor esports-style stadium: tiered stands and an overhead ring rig',
    floor: 'Light matte polymer; center circle, two faint player halves, red edge band',
    boundary: 'Clear polycarbonate wall on 24 metal posts, LED top rail',
    lighting: 'Bright neutral key from an 8-spot ring rig, soft even fill',
    background: 'Dim stands with a crowd, dark venue ceiling',
    impact: 'White-yellow sparks; on Clash the LED rail flashes both player colors and the crowd lights up',
  },
  defaultDepth: BOWL_DEPTH,
  build(depth = BOWL_DEPTH): BuiltArena {
    const heightAt = bowlProfile(depth);
    const root = new THREE.Group();
    const R = ARENA_RADIUS;
    const rim = heightAt(R);
    const rnd = seededRandom(9);

    root.add(shadowed(new THREE.Mesh(bowlFloor(R, heightAt), new THREE.MeshStandardMaterial({ map: paintFloor(), roughness: 0.55, metalness: 0 })), false, true));

    // Wall: dark kick plate, clear panels, posts, rail, LED strip.
    const metal = new THREE.MeshStandardMaterial({ color: 0xb8c0cb, metalness: 0.9, roughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.6 });
    const kick = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.35, 128, 1, true), dark));
    kick.position.y = rim + 0.17;
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.1, R + 0.1, WALL_HEIGHT - 0.35, 128, 1, true),
      new THREE.MeshPhysicalMaterial({ color: 0xdcecff, transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false }),
    );
    glass.position.y = rim + 0.35 + (WALL_HEIGHT - 0.35) / 2;
    glass.renderOrder = 2;
    root.add(kick, glass);
    for (let i = 0; i < POSTS; i++) {
      const a = (i / POSTS) * Math.PI * 2;
      const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.14, WALL_HEIGHT + 0.1, 0.22), metal));
      post.position.set(Math.cos(a) * (R + 0.18), rim + (WALL_HEIGHT + 0.1) / 2, Math.sin(a) * (R + 0.18));
      post.lookAt(0, post.position.y, 0);
      root.add(post);
    }
    const rail = shadowed(new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.08, 10, 160).rotateX(Math.PI / 2), metal));
    rail.position.y = rim + WALL_HEIGHT + 0.05;
    const ledMat = new THREE.MeshStandardMaterial({ color: LED_COLOR, emissive: LED_COLOR, emissiveIntensity: 2.2 });
    const led = new THREE.Mesh(new THREE.TorusGeometry(R + 0.12, 0.035, 6, 160).rotateX(Math.PI / 2), ledMat);
    led.position.y = rim + WALL_HEIGHT - 0.06;
    root.add(rail, led);

    // Deck + tiered stands.
    const deck = shadowed(new THREE.Mesh(new THREE.RingGeometry(R + 0.2, 15, 96).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x262b33, roughness: 0.8 })), false, true);
    deck.position.y = rim;
    root.add(deck);
    const standMat = new THREE.MeshStandardMaterial({ color: 0x2e343d, roughness: 0.85 });
    const tiers = 7;
    const seats: THREE.Vector3[] = [];
    for (let t = 0; t < tiers; t++) {
      const r0 = 15 + t * 1.8;
      const y = rim + 0.6 + t * 1.1;
      const step = new THREE.Mesh(new THREE.CylinderGeometry(r0 + 1.8, r0 + 1.8, y, 96, 1, true), standMat);
      step.position.y = y / 2;
      const tread = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.8, 96).rotateX(-Math.PI / 2), standMat);
      tread.position.y = y;
      root.add(step, tread);
      const count = Math.round((CROWD / tiers) * (r0 / 20));
      for (let k = 0; k < count; k++) {
        if (rnd() < 0.18) continue; // empty seats
        const a = rnd() * Math.PI * 2;
        seats.push(new THREE.Vector3(Math.cos(a) * (r0 + 0.9), y + 0.4, Math.sin(a) * (r0 + 0.9)));
      }
    }
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.8, 0.4), crowdMat, seats.length);
    const m = new THREE.Matrix4();
    const palette = [0x3a4a66, 0x5b3a3a, 0x4d5563, 0x2f5a4f, 0x6b6f78, 0x7a5a2e, 0x2c3140, 0x61314a];
    seats.forEach((p, i) => {
      m.makeRotationY(-Math.atan2(p.z, p.x) + Math.PI / 2).setPosition(p);
      crowd.setMatrixAt(i, m);
      crowd.setColorAt(i, new THREE.Color(palette[Math.floor(rnd() * palette.length)]!));
    });
    root.add(crowd);

    // Camera flashes in the crowd (visible during Clash).
    const flashCount = 90;
    const flashGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(flashCount * 3), 3));
    const flashes = new THREE.Points(flashGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, transparent: true, opacity: 0, fog: false }));
    root.add(flashes);
    let flashReshuffle = 0;

    // Light rig.
    root.add(skyDome(0x07090e, 0x131820, 0x0a0c10));
    const rigMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.8, roughness: 0.5 });
    const rig = new THREE.Mesh(new THREE.TorusGeometry(10, 0.3, 8, 96).rotateX(Math.PI / 2), rigMat);
    rig.position.y = 18;
    root.add(rig);
    const spots: THREE.SpotLight[] = [];
    for (let i = 0; i < RIG_SPOTS; i++) {
      const a = (i / RIG_SPOTS) * Math.PI * 2;
      const pos = new THREE.Vector3(Math.cos(a) * 10, 17.6, Math.sin(a) * 10);
      const s = new THREE.SpotLight(0xf2f5ff, RIG_INTENSITY, 45, 0.55, 0.6, 1.6);
      s.position.copy(pos);
      s.target.position.set(-pos.x * 0.25, 0, -pos.z * 0.25);
      if (i === 0) {
        s.castShadow = true;
        s.shadow.mapSize.set(2048, 2048);
        s.shadow.bias = -0.0003;
        s.shadow.normalBias = 0.03;
      }
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 0.6, 12), rigMat);
      lamp.position.copy(pos).setY(17.9);
      root.add(s, s.target, lamp);
      spots.push(s);
    }
    root.add(new THREE.HemisphereLight(0xb9c4d8, 0x1a1d24, 0.7));
    const flashLight = new THREE.PointLight(0xfff2c0, 0, 9, 2);
    root.add(flashLight);
    let flashT = 0;

    const base = new THREE.Color(LED_COLOR);
    const cA = new THREE.Color(CLASH_COLORS[0]);
    const cB = new THREE.Color(CLASH_COLORS[1]);
    const tmp = new THREE.Color();
    return {
      root,
      depth,
      floorHeightAt: heightAt,
      wallRadius: R,
      sparkColors: [0xffffff, 0xffc94a],
      exposure: 0.85,
      fog: null,
      environmentIntensity: 0.6,
      update({ time, dt, clash }) {
        const side = Math.sin(time * 9) > 0 ? cA : cB;
        tmp.copy(base).lerp(side, clash);
        ledMat.color.copy(tmp);
        ledMat.emissive.copy(tmp);
        ledMat.emissiveIntensity = 2.2 + clash * 3;
        spots.forEach((s) => {
          s.angle = 0.55 - clash * 0.2;
          s.intensity = RIG_INTENSITY * (1 + clash * 0.8);
        });
        const flashMat = flashes.material as THREE.PointsMaterial;
        flashMat.opacity = clash;
        flashReshuffle -= dt;
        if (clash > 0.05 && flashReshuffle <= 0 && seats.length > 0) {
          flashReshuffle = 0.08;
          const arr = flashGeo.getAttribute('position') as THREE.BufferAttribute;
          for (let i = 0; i < flashCount; i++) {
            const p = rnd() < 0.3 ? seats[Math.floor(rnd() * seats.length)]! : new THREE.Vector3(0, -50, 0);
            arr.setXYZ(i, p.x, p.y + 0.5, p.z);
          }
          arr.needsUpdate = true;
        }
        flashT = Math.max(0, flashT - dt * 4);
        flashLight.intensity = flashT * 45;
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
