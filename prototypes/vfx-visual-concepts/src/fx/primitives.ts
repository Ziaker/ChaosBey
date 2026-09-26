// ============================================================
// VFX LAB — EFFECT PRIMITIVES
// Small factories that turn a description into an FxItem for FxLayer.
// Every item owns its material (disposed with it); textures are shared.
// ============================================================

import * as THREE from 'three';
import type { FxItem } from './FxLayer';

const ease = (k: number): number => 1 - Math.pow(1 - k, 3);

export interface SpriteOpts {
  tex: THREE.Texture;
  color: THREE.ColorRepresentation;
  pos: THREE.Vector3;
  size: [number, number];
  life: number;
  opacity?: number;
  additive?: boolean;
  vel?: THREE.Vector3;
  gravity?: number;
  drag?: number;
  spin?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
}

export function spriteFx(o: SpriteOpts): FxItem {
  const mat = new THREE.SpriteMaterial({
    map: o.tex, color: o.color, transparent: true, depthWrite: false, opacity: o.opacity ?? 1,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(o.pos);
  const vel = o.vel?.clone() ?? new THREE.Vector3();
  const base = o.opacity ?? 1;
  return {
    object: sprite,
    life: o.life,
    update(k, dt) {
      vel.y -= (o.gravity ?? 0) * dt;
      vel.multiplyScalar(1 - Math.min(1, (o.drag ?? 0) * dt));
      sprite.position.addScaledVector(vel, dt);
      const s = THREE.MathUtils.lerp(o.size[0], o.size[1], ease(k));
      sprite.scale.set(s, s, 1);
      mat.rotation += (o.spin ?? 0) * dt;
      const fi = o.fadeIn ?? 0;
      mat.opacity = base * (k < fi ? k / fi : 1 - (k - fi) / (1 - fi));
    },
  };
}

export interface FlatOpts {
  tex: THREE.Texture;
  color: THREE.ColorRepresentation;
  pos: THREE.Vector3;
  size: [number, number];
  life: number;
  opacity?: number;
  additive?: boolean;
  rotation?: number;
  /** Fraction of life before fading starts (decals stay, then fade). */
  hold?: number;
}

/** Horizontal textured quad lying on the floor (shockwave rings, decals). */
export function flatFx(o: FlatOpts): FxItem {
  const mat = new THREE.MeshBasicMaterial({
    map: o.tex, color: o.color, transparent: true, depthWrite: false, opacity: o.opacity ?? 1, side: THREE.DoubleSide,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
  mesh.position.copy(o.pos);
  mesh.rotation.y = o.rotation ?? 0;
  const base = o.opacity ?? 1;
  const hold = o.hold ?? 0;
  return {
    object: mesh,
    life: o.life,
    update(k) {
      const s = THREE.MathUtils.lerp(o.size[0], o.size[1], ease(Math.min(1, k * (hold > 0 ? 6 : 1))));
      mesh.scale.set(s, 1, s);
      mat.opacity = base * (k < hold ? 1 : 1 - (k - hold) / (1 - hold));
    },
  };
}

/** Camera-facing flat burst (anime impact star, flash cards). */
export function burstFx(o: { tex: THREE.Texture; color: THREE.ColorRepresentation; pos: THREE.Vector3; size: [number, number]; life: number; rotation?: number; additive?: boolean }): FxItem {
  const mat = new THREE.MeshBasicMaterial({
    map: o.tex, color: o.color, transparent: true, depthWrite: false, depthTest: false,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 10;
  mesh.position.copy(o.pos);
  const holder = new THREE.Group();
  holder.add(mesh);
  mesh.rotation.z = o.rotation ?? 0;
  holder.position.copy(o.pos);
  mesh.position.set(0, 0, 0);
  return {
    object: holder,
    life: o.life,
    billboard: true,
    update(k) {
      const s = THREE.MathUtils.lerp(o.size[0], o.size[1], ease(Math.min(1, k * 2.2)));
      mesh.scale.set(s, s, 1);
      mat.opacity = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75;
    },
  };
}

/** Small physical chip that flies, tumbles and bounces on the bowl floor. */
export function debrisFx(o: { pos: THREE.Vector3; vel: THREE.Vector3; size: number; color: number; metal?: boolean; life: number; floorHeightAt: (r: number) => number }): FxItem {
  const mat = new THREE.MeshStandardMaterial({ color: o.color, metalness: o.metal ? 0.9 : 0.1, roughness: o.metal ? 0.35 : 0.8, transparent: true });
  const mesh = new THREE.Mesh(new THREE.TetrahedronGeometry(o.size, 0), mat);
  mesh.castShadow = true;
  mesh.position.copy(o.pos);
  const vel = o.vel.clone();
  const spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(14);
  return {
    object: mesh,
    life: o.life,
    update(k, dt) {
      vel.y -= 9.8 * dt;
      mesh.position.addScaledVector(vel, dt);
      const floor = o.floorHeightAt(Math.hypot(mesh.position.x, mesh.position.z)) + o.size * 0.5;
      if (mesh.position.y < floor) {
        mesh.position.y = floor;
        vel.y = Math.abs(vel.y) * 0.35;
        vel.x *= 0.55;
        vel.z *= 0.55;
        spin.multiplyScalar(0.6);
      }
      mesh.rotation.x += spin.x * dt;
      mesh.rotation.y += spin.y * dt;
      mesh.rotation.z += spin.z * dt;
      mat.opacity = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
    },
  };
}

/** Horizontal crescent slash around a center, rotating with the spin. */
export function slashArcFx(o: { center: THREE.Vector3; radius: number; width: number; color: THREE.ColorRepresentation; start: number; sweep: number; spin: number; life: number }): FxItem {
  const segments = 48;
  const geo = new THREE.RingGeometry(o.radius - o.width, o.radius, segments, 1, 0, o.sweep).rotateX(-Math.PI / 2);
  // Fade alpha along the arc: tail transparent, head bright (vertex colors as alpha stand-in).
  const colors: number[] = [];
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(-pos.getZ(i), pos.getX(i));
    const t = THREE.MathUtils.clamp((a < 0 ? a + Math.PI * 2 : a) / o.sweep, 0, 1);
    colors.push(t, t, t);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const color = new THREE.Color(o.color);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 1 } },
    vertexShader: 'attribute vec3 color; varying float vT; void main(){ vT = color.r; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vT; void main(){ gl_FragColor = vec4(mix(uColor, vec3(1.0), vT*vT*0.8), vT * uOpacity); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(o.center);
  mesh.rotation.y = o.start;
  return {
    object: mesh,
    life: o.life,
    update(k, dt) {
      mesh.rotation.y += o.spin * dt;
      mat.uniforms.uOpacity!.value = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    },
  };
}

/** Vertical light beam (anime ring-out). */
export function beamFx(o: { pos: THREE.Vector3; dir: THREE.Vector3; color: THREE.ColorRepresentation; length: number; width: number; life: number }): FxItem {
  const geo = new THREE.CylinderGeometry(o.width * 0.35, o.width, o.length, 24, 1, true).translate(0, o.length / 2, 0);
  const mat = new THREE.MeshBasicMaterial({ color: o.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(o.pos);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), o.dir.clone().normalize());
  return {
    object: mesh,
    life: o.life,
    update(k) {
      mesh.scale.set(1 - k * 0.7, Math.min(1, k * 6), 1 - k * 0.7);
      mat.opacity = 1 - k;
    },
  };
}

/** Fading ghost copy of a Bey (afterimage / motion ghost). */
export function ghostFx(object: THREE.Object3D, material: THREE.Material & { opacity: number }, life: number, startOpacity: number): FxItem {
  return {
    object,
    life,
    update(k) {
      material.opacity = startOpacity * (1 - k);
    },
  };
}

export interface WindFunnelOpts {
  /** Funnel apex (at the Bey). */
  origin: THREE.Vector3;
  /** Direction the funnel opens toward (usually opposite the movement). */
  dir: THREE.Vector3;
  length: number;
  mouthRadius: number;
  color: THREE.ColorRepresentation;
  life: number;
  spikes?: number;
  /** Radians of spiral twist along the funnel ("small hurricane"). */
  twist?: number;
  /** Rotation speed of the spikes around the axis (rad/s). */
  spin?: number;
  opacity?: number;
}

/**
 * Anime wind burst: a spiky, twisting funnel of wind blades opening behind
 * a Bey that suddenly advances (dash / dodge), like a small hurricane.
 * Built along +X locally, then rotated onto `dir`.
 */
export function windFunnelFx(o: WindFunnelOpts): FxItem {
  const spikes = o.spikes ?? 14;
  const twist = o.twist ?? 0.9;
  const steps = 12;
  const positions: number[] = [];
  const alphas: number[] = [];
  for (let s = 0; s < spikes; s++) {
    const phi = (s / spikes) * Math.PI * 2 + Math.random() * 0.25;
    const len = o.length * (0.65 + Math.random() * 0.35);
    const w0 = (Math.PI * 2 / spikes) * (0.35 + Math.random() * 0.2);
    const edge = (t: number, side: number): [number, number, number] => {
      const r = 0.25 + (o.mouthRadius - 0.25) * Math.pow(t, 0.75);
      const w = w0 * (1 - t) * Math.min(1, t * 6);
      const a = phi + twist * t + side * w * 0.5;
      return [t * len, Math.cos(a) * r, Math.sin(a) * r];
    };
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const a0 = edge(t0, -1), b0 = edge(t0, 1), a1 = edge(t1, -1), b1 = edge(t1, 1);
      const al = (t: number): number => Math.pow(1 - t, 0.6) * Math.min(1, t * 8);
      positions.push(...a0, ...b0, ...a1, ...b0, ...b1, ...a1);
      alphas.push(al(t0), al(t0), al(t1), al(t0), al(t1), al(t1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(o.color) }, uOpacity: { value: o.opacity ?? 0.9 } },
    vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(mix(uColor, vec3(1.0), vA * 0.6), vA * uOpacity); }',
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const blades = new THREE.Mesh(geo, mat);

  // Faint streaked cone shell behind the blades.
  const shellGeo = new THREE.CylinderGeometry(o.mouthRadius * 0.92, 0.2, o.length * 0.85, 40, 1, true)
    .translate(0, o.length * 0.425, 0)
    .rotateZ(-Math.PI / 2);
  const shellMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(o.color) }, uOpacity: { value: 0.5 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying vec2 vUv;
      void main(){
        float streak = pow(abs(sin(vUv.x * 42.0 + vUv.y * 5.0 - uTime * 30.0)), 10.0);
        float fade = smoothstep(0.0, 0.15, 1.0 - vUv.y) * smoothstep(0.0, 0.2, vUv.y);
        gl_FragColor = vec4(uColor, streak * fade * uOpacity);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);

  const spinner = new THREE.Group();
  spinner.add(blades, shell);
  const holder = new THREE.Group();
  holder.add(spinner);
  holder.position.copy(o.origin);
  holder.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), o.dir.clone().normalize());
  const baseOpacity = o.opacity ?? 0.9;
  return {
    object: holder,
    life: o.life,
    update(k, dt) {
      const grow = ease(Math.min(1, k * 2.2));
      holder.scale.set(0.3 + 0.7 * grow, 0.45 + 0.75 * grow, 0.45 + 0.75 * grow);
      spinner.rotation.x += (o.spin ?? 11) * dt;
      const fade = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
      mat.uniforms.uOpacity!.value = baseOpacity * fade;
      shellMat.uniforms.uOpacity!.value = 0.5 * fade;
      shellMat.uniforms.uTime!.value += dt;
    },
  };
}
