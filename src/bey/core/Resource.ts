// ============================================================
// RESOURCE — SHARED BOUNDED NUMERIC RESOURCE
// Stamina, Stability and Attack Energy are structurally the same shape (a
// clamped 0..max value with consumption/recovery) even though their
// gameplay meaning is different (GDD section 31: avoid duplicating the
// same *effect* across stats — this is not that, it's just the shared
// numeric container each one is built from, same justification as Vec2).
// ============================================================

export class Resource {
  private current: number;

  constructor(readonly max: number, initial: number = max) {
    this.current = clamp(initial, 0, max);
  }

  get value(): number {
    return this.current;
  }

  /** 0..1 */
  get fraction(): number {
    return this.max > 0 ? this.current / this.max : 0;
  }

  get isEmpty(): boolean {
    return this.current <= 0;
  }

  get isFull(): boolean {
    return this.current >= this.max;
  }

  set(value: number): void {
    this.current = clamp(value, 0, this.max);
  }

  add(amount: number): void {
    this.set(this.current + amount);
  }

  subtract(amount: number): void {
    this.set(this.current - amount);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
