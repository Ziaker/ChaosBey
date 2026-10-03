// ============================================================
// FLOOR SCARS — owner, 2026-10-02 (Lote 7, item 7: "destruição do cenário")
// A Heavy hit or a hard landing after a hit/launch leaves a persistent mark
// on the floor: the VFX lab's own crack decal (crackMark, which the lab
// shows for 3 s) held for FLOOR_SCAR_LIFE_S and then faded, at most
// FLOOR_SCAR_MAX_COUNT at once (the oldest fades early), plus a few debris
// chips. Presentation only: colliders and the floor are never touched. The
// arena lab (prototypes/arena-visual-concepts) defines only wall flashes and
// spark colours per arena — no floor damage — so this is the minimum
// faithful to the VFX lab; per-arena scar looks (Foundry scorch, Rift
// fissure, Stadium scuff) are not prototyped and are listed as open.
// ============================================================

import * as THREE from 'three';
import { debrisFx, flatFx } from './fx/primitives';
import type { FxLayer, LiveFxItem } from './fx/FxLayer';
import { crackMark } from './fx/textures';
import { FLOOR_SCAR_HOLD, FLOOR_SCAR_LIFE_S, FLOOR_SCAR_MAX_COUNT } from './intensityTiers';

export class FloorScars {
  private readonly live: LiveFxItem[] = [];
  /** Scars ever made (observability). */
  made = 0;

  constructor(
    private readonly layer: FxLayer,
    private readonly floorHeightAt: (r: number) => number,
  ) {}

  /** A scar at `at` (world XZ; the floor height is the floor's), sized by magnitude m (0..1). */
  scar(at: THREE.Vector3, m: number): void {
    // Drop the ones already gone; past the cap, the oldest starts its fade now.
    for (let i = this.live.length - 1; i >= 0; i--) if (this.live[i]!.age >= this.live[i]!.life) this.live.splice(i, 1);
    while (this.live.length >= FLOOR_SCAR_MAX_COUNT) {
      const oldest = this.live.shift()!;
      oldest.age = Math.max(oldest.age, oldest.life * FLOOR_SCAR_HOLD);
    }
    const floorY = this.floorHeightAt(Math.hypot(at.x, at.z));
    const size = 1.2 + 1.6 * m;
    const item = flatFx({
      tex: crackMark(),
      color: 0x000000,
      pos: new THREE.Vector3(at.x, floorY + 0.015, at.z),
      conform: { floorHeightAt: this.floorHeightAt, lift: 0.015 },
      size: [size, size],
      life: FLOOR_SCAR_LIFE_S,
      opacity: 0.7,
      hold: FLOOR_SCAR_HOLD,
      rotation: Math.random() * 6,
    });
    this.layer.add(item);
    this.live.push(item as LiveFxItem);
    this.made++;
    const chips = 4 + Math.round(4 * m);
    for (let i = 0; i < chips; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 2 + 3 * m * Math.random();
      this.layer.add(debrisFx({ pos: new THREE.Vector3(at.x, floorY + 0.15, at.z), vel: new THREE.Vector3(Math.cos(a) * v, 2.5 + 2 * Math.random(), Math.sin(a) * v), size: 0.06 + 0.06 * Math.random(), color: 0x6b6b6b, life: 1.4, floorHeightAt: this.floorHeightAt }));
    }
  }

  /** Scars on the floor right now (observability / tests). */
  count(): number {
    return this.live.filter((s) => s.age < s.life).length;
  }
}
