// ============================================================
// ARENA B — RIFT CRATER (energy crater under a night sky)
// Deeper basalt crater split by glowing fissures, ringed by jagged rocks
// and a translucent energy barrier. The "Chaos" identity comes through
// light and material, not through hurricane shapes.
// ============================================================

import * as THREE from 'three';
import { ARENA_RADIUS, bowlFloor, canvasTexture, disposeTree, floorCanvas, seededRandom, shadowed, skyDome } from './common';
import type { ArenaConcept, BuiltArena } from './types';

// ---------------- TUNING ----------------
const BOWL_DEPTH = 1.4;               // Deeper crater than A/C (m).
const BARRIER_HEIGHT = 2.2;           // Energy barrier height above the rim (m).
const FISSURE_COLOR = 0x8f6bff;       // Normal fissure glow (violet).
const CLASH_COLOR = 0xff3fb4;         // Fissures + barrier shift to magenta on Clash.
const FISSURE_GLOW = 1.1;             // Base emissive strength of the fissures.
const RIM_ROCKS = 34;
// -----------------------------------------

const heightAt = (r: number): number => BOWL_DEPTH * Math.pow(Math.min(r, ARENA_RADIUS) / ARENA_RADIUS, 1.7);

function paintFloor(): { color: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const { canvas, g, c, px } = floorCanvas();
  const glow = floorCanvas();
  const rnd = seededRandom(7);
  g.fillStyle = '#1c1a22';
  g.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 9000; i++) {
    const v = 22 + rnd() * 28;
    g.fillStyle = `rgba(${v + 4},${v},${v + 10},0.5)`;
    const s = 2 + rnd() * 26;
    g.beginPath(); g.arc(rnd() * canvas.width, rnd() * canvas.height, s, 0, Math.PI * 2); g.fill();
  }
  glow.g.fillStyle = '#000';
  glow.g.fillRect(0, 0, glow.canvas.width, glow.canvas.height);
  // Fissures: jagged random walks from near the center outward.
  const drawCrack = (x: number, y: number, a: number, len: number, width: number, depth: number): void => {
    let px0 = x;
    let py0 = y;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.7;
      const step = 18 + rnd() * 22;
      const px1 = px0 + Math.cos(a) * step;
      const py1 = py0 + Math.sin(a) * step;
      const w = width * (1 - s / len);
      g.strokeStyle = '#0a0810'; g.lineWidth = w * 3 + 2;
      g.beginPath(); g.moveTo(px0, py0); g.lineTo(px1, py1); g.stroke();
      for (const [lw, alpha] of [[w * 6, 0.12], [w * 2.5, 0.35], [w, 1]] as const) {
        glow.g.strokeStyle = `rgba(255,255,255,${alpha})`; glow.g.lineWidth = lw;
        glow.g.beginPath(); glow.g.moveTo(px0, py0); glow.g.lineTo(px1, py1); glow.g.stroke();
      }
      if (depth < 2 && rnd() < 0.08) drawCrack(px1, py1, a + (rnd() - 0.5) * 1.6, len * 0.4, w * 0.7, depth + 1);
      px0 = px1; py0 = py1;
    }
  };
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
    drawCrack(c + Math.cos(a) * px(1.2), c + Math.sin(a) * px(1.2), a, 30, 7, 0);
  }
  // Central glowing seam ring.
  glow.g.strokeStyle = 'rgba(255,255,255,0.8)'; glow.g.lineWidth = px(0.07);
  glow.g.beginPath(); glow.g.arc(c, c, px(1.2), 0, Math.PI * 2); glow.g.stroke();
  return { color: canvasTexture(canvas), glow: canvasTexture(glow.canvas) };
}

function barrierMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(FISSURE_COLOR) }, uBoost: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform float uTime; uniform vec3 uColor; uniform float uBoost; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 1.6);
        float bands = smoothstep(0.85, 1.0, fract(vUv.y * 6.0 - uTime * 0.35));
        float cells = smoothstep(0.93, 1.0, abs(sin(vUv.x * 314.159)));
        float a = fade * (0.14 + 0.35 * bands + 0.12 * cells) * (1.0 + uBoost * 2.0);
        gl_FragColor = vec4(uColor * (1.2 + uBoost), a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

export const RIFT_CRATER: ArenaConcept = {
  id: 'arena-b',
  letter: 'B',
  headline: 'Rift Crater',
  description: 'A deeper basalt crater split by glowing fissures, ringed by jagged rocks and a translucent energy barrier under a night sky.',
  answers: {
    architecture: 'Natural crater, no built structure; floating rock shards around it',
    floor: 'Dark basalt with glowing violet fissures radiating from a central seam',
    boundary: 'Jagged rock rim + translucent animated energy barrier',
    lighting: 'Cold moonlight key, violet glow from the fissures, dark overall',
    background: 'Indigo night sky with stars and slowly drifting rock shards',
    impact: 'Violet-cyan sparks; on Clash the fissures and barrier surge magenta',
  },
  build(): BuiltArena {
    const root = new THREE.Group();
    const R = ARENA_RADIUS;
    const rim = heightAt(R);
    const rnd = seededRandom(3);

    const tex = paintFloor();
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex.color, emissiveMap: tex.glow, emissive: FISSURE_COLOR, emissiveIntensity: FISSURE_GLOW, roughness: 0.92, metalness: 0.05,
    });
    root.add(shadowed(new THREE.Mesh(bowlFloor(R, heightAt), floorMat), false, true));

    // Crater lip: a short sloped band from the floor edge up and outward.
    const lip = shadowed(new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(R, rim), new THREE.Vector2(R + 0.6, rim + 0.5), new THREE.Vector2(R + 2.5, rim + 0.7), new THREE.Vector2(R + 9, rim + 0.2),
    ], 128), new THREE.MeshStandardMaterial({ color: 0x19171e, roughness: 0.95, side: THREE.DoubleSide })), false, true);
    root.add(lip);

    // Jagged rim rocks.
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 0.9, flatShading: true });
    for (let i = 0; i < RIM_ROCKS; i++) {
      const a = (i / RIM_ROCKS) * Math.PI * 2 + rnd() * 0.12;
      const s = 0.6 + rnd() * 1.1;
      const rock = shadowed(new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat));
      const rr = R + 1.1 + rnd() * 1.2;
      rock.position.set(Math.cos(a) * rr, rim + s * 0.35, Math.sin(a) * rr);
      rock.scale.set(1, 0.7 + rnd() * 0.9, 1);
      rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      root.add(rock);
    }

    // Energy barrier.
    const barrierMat = barrierMaterial();
    const barrier = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, BARRIER_HEIGHT, 160, 1, true), barrierMat);
    barrier.position.y = rim + BARRIER_HEIGHT / 2;
    barrier.renderOrder = 2;
    root.add(barrier);
    const barrierBase = new THREE.Mesh(new THREE.TorusGeometry(R + 0.3, 0.05, 8, 160).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: FISSURE_COLOR }));
    barrierBase.position.y = rim + 0.02;
    root.add(barrierBase);

    // Sky: gradient dome, stars, drifting shards.
    root.add(skyDome(0x0a0620, 0x1b1438, 0x040308));
    const starPos: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = rnd();
      const v = 0.05 + rnd() * 0.95;
      const theta = u * Math.PI * 2;
      const phi = Math.acos(v);
      starPos.push(Math.sin(phi) * Math.cos(theta) * 110, Math.cos(phi) * 110, Math.sin(phi) * Math.sin(theta) * 110);
    }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3)),
      new THREE.PointsMaterial({ color: 0xcfd6ff, size: 0.35, sizeAttenuation: true, fog: false }),
    );
    root.add(stars);
    const shards = new THREE.Group();
    for (let i = 0; i < 14; i++) {
      const s = 0.8 + rnd() * 2.2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), rockMat);
      const a = rnd() * Math.PI * 2;
      const d = 24 + rnd() * 18;
      shard.position.set(Math.cos(a) * d, 5 + rnd() * 12, Math.sin(a) * d);
      shard.scale.set(1, 1.6 + rnd(), 1);
      shard.userData.spin = (rnd() - 0.5) * 0.4;
      shards.add(shard);
    }
    root.add(shards);

    // Lights.
    const moon = new THREE.DirectionalLight(0x9fb0ff, 1.3);
    moon.position.set(-14, 22, 10);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.03;
    root.add(moon, new THREE.HemisphereLight(0x3b2f70, 0x07050c, 0.45));
    const glows: THREE.PointLight[] = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const l = new THREE.PointLight(FISSURE_COLOR, 18, 14, 1.8);
      l.position.set(Math.cos(a) * 4, 0.8, Math.sin(a) * 4);
      glows.push(l);
      root.add(l);
    }
    const flashLight = new THREE.PointLight(0xa98bff, 0, 9, 2);
    root.add(flashLight);
    const fog = new THREE.FogExp2(0x0c0918, 0.012);
    let flashT = 0;

    const base = new THREE.Color(FISSURE_COLOR);
    const hot = new THREE.Color(CLASH_COLOR);
    const tmp = new THREE.Color();
    return {
      root,
      floorHeightAt: heightAt,
      wallRadius: R,
      sparkColors: [0xd9ccff, 0x7f5cff],
      exposure: 1.15,
      fog,
      environmentIntensity: 0.3,
      update({ time, dt, clash }) {
        tmp.copy(base).lerp(hot, clash);
        const pulse = 0.85 + 0.15 * Math.sin(time * 1.7);
        floorMat.emissive.copy(tmp);
        floorMat.emissiveIntensity = FISSURE_GLOW * pulse * (1 + clash * 2.2);
        barrierMat.uniforms.uTime!.value = time;
        (barrierMat.uniforms.uColor!.value as THREE.Color).copy(tmp);
        barrierMat.uniforms.uBoost!.value = clash * (0.7 + 0.3 * Math.sin(time * 12));
        (barrierBase.material as THREE.MeshBasicMaterial).color.copy(tmp);
        glows.forEach((l) => { l.color.copy(tmp); l.intensity = 18 * pulse * (1 + clash * 2); });
        shards.children.forEach((s) => { s.rotation.y += s.userData.spin * dt; s.position.y += Math.sin(time * 0.3 + s.position.x) * 0.002; });
        flashT = Math.max(0, flashT - dt * 4);
        flashLight.intensity = flashT * 50;
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
