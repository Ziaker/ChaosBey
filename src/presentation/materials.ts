// ============================================================
// MATERIAL AND PALETTE REGISTRY
// One predictable place where future visual systems (Bey parts, condition
// layers, VFX) obtain materials and palettes by key, instead of scattering
// `new MeshStandardMaterial(...)` calls. Not a theme engine: it holds
// factories and plain colour tables, creates a material on first use, hands
// the same instance back afterwards, and disposes what it created.
//
// It ships empty. The approved materials and palettes are registered by the
// integrations that own them (each with its source document); nothing is
// invented here, and the current placeholder meshes keep building their own.
// ============================================================

import type * as THREE from 'three';

export interface MaterialSpec {
  readonly factory: () => THREE.Material;
  /** Free tags (e.g. 'emissive', 'translucent', 'metal') for querying a family of materials. */
  readonly tags?: readonly string[];
}

export class PresentationMaterialRegistry {
  private readonly specs = new Map<string, MaterialSpec>();
  private readonly created = new Map<string, THREE.Material>();
  private readonly palettes = new Map<string, Readonly<Record<string, number>>>();

  register(key: string, spec: MaterialSpec): void {
    if (this.specs.has(key)) throw new Error(`PresentationMaterialRegistry.register("${key}"): already registered.`);
    this.specs.set(key, spec);
  }

  has(key: string): boolean {
    return this.specs.has(key);
  }

  /** The material for `key`, created on first use and shared afterwards. */
  get(key: string): THREE.Material {
    const existing = this.created.get(key);
    if (existing) return existing;
    const spec = this.specs.get(key);
    if (!spec) throw new Error(`PresentationMaterialRegistry.get("${key}"): not registered.`);
    const material = spec.factory();
    this.created.set(key, material);
    return material;
  }

  keysWithTag(tag: string): readonly string[] {
    return [...this.specs.entries()].filter(([, spec]) => spec.tags?.includes(tag)).map(([key]) => key);
  }

  registerPalette(name: string, colorsHex: Readonly<Record<string, number>>): void {
    if (this.palettes.has(name)) throw new Error(`PresentationMaterialRegistry.registerPalette("${name}"): already registered.`);
    this.palettes.set(name, Object.freeze({ ...colorsHex }));
  }

  palette(name: string): Readonly<Record<string, number>> {
    const palette = this.palettes.get(name);
    if (!palette) throw new Error(`PresentationMaterialRegistry.palette("${name}"): not registered.`);
    return palette;
  }

  /** How many materials have actually been created (observability). */
  createdCount(): number {
    return this.created.size;
  }

  /** Disposes every created material and forgets them; registered specs stay, so a later get() recreates. */
  disposeCreated(): void {
    for (const material of this.created.values()) material.dispose();
    this.created.clear();
  }
}
