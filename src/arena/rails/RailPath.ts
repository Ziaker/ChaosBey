// ============================================================
// RAIL PATH — the sampled route of one rail (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §4.1/§5: a rail is a gameplay route, described by data, that can be sampled
// for a position and a tangent at any progress and asked for the progress nearest a point. Pure geometry: no physics, no
// rendering, no tuning. A polyline in world space, parameterised by arc length (metres), open or closed.
// ============================================================

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RailSample {
  /** Progress along the route (m): clamped to [0, length] on an open rail, wrapped on a closed one. */
  readonly progressM: number;
  readonly position: Point3;
  /** Unit tangent in the direction of increasing progress. */
  readonly tangent: Point3;
}

export interface RailProjection {
  readonly progressM: number;
  readonly position: Point3;
  /** 3D distance from the query point to the rail. */
  readonly distanceM: number;
}

const EPS = 1e-9;

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: Point3): number => Math.hypot(a.x, a.y, a.z);

export class RailPath {
  readonly points: readonly Point3[];
  readonly closed: boolean;
  readonly lengthM: number;
  /** Cumulative arc length at each point (the last one is lengthM; a closed rail has its closing segment included). */
  private readonly cumulative: readonly number[];
  private readonly segmentCount: number;

  /**
   * @param points at least two, no two consecutive equal (a closed rail also joins the last point back to the first)
   */
  constructor(points: readonly Point3[], closed = false) {
    if (points.length < 2) throw new Error('RailPath needs at least two points');
    if (closed && points.length < 3) throw new Error('A closed RailPath needs at least three points');
    this.points = points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    this.closed = closed;
    const cumulative = [0];
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = this.points[i]!;
      const b = this.points[(i + 1) % points.length]!;
      const segment = len(sub(b, a));
      if (segment < EPS) throw new Error(`RailPath: points ${i} and ${(i + 1) % points.length} coincide`);
      cumulative.push(cumulative[cumulative.length - 1]! + segment);
    }
    this.cumulative = cumulative;
    this.segmentCount = count;
    this.lengthM = cumulative[cumulative.length - 1]!;
  }

  private segmentAt(progressM: number): number {
    // Binary search over the cumulative lengths: the segment i with cumulative[i] <= progress <= cumulative[i + 1].
    let lo = 0;
    let hi = this.segmentCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.cumulative[mid]! <= progressM) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private normalise(progressM: number): number {
    if (this.closed) return ((progressM % this.lengthM) + this.lengthM) % this.lengthM;
    return Math.min(this.lengthM, Math.max(0, progressM));
  }

  /** Position and unit tangent at a progress (clamped on an open rail, wrapped on a closed one). */
  sampleAt(progressM: number): RailSample {
    const progress = this.normalise(progressM);
    const i = this.segmentAt(progress);
    const a = this.points[i]!;
    const b = this.points[(i + 1) % this.points.length]!;
    const segmentLength = this.cumulative[i + 1]! - this.cumulative[i]!;
    const t = (progress - this.cumulative[i]!) / segmentLength;
    return {
      progressM: progress,
      position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
      tangent: { x: (b.x - a.x) / segmentLength, y: (b.y - a.y) / segmentLength, z: (b.z - a.z) / segmentLength },
    };
  }

  /** The point of the rail nearest to `point` (3D), with its progress and distance. Ties keep the lowest progress. */
  project(point: Point3): RailProjection {
    let best: RailProjection | null = null;
    for (let i = 0; i < this.segmentCount; i++) {
      const a = this.points[i]!;
      const b = this.points[(i + 1) % this.points.length]!;
      const ab = sub(b, a);
      const segmentLength = this.cumulative[i + 1]! - this.cumulative[i]!;
      const t = Math.min(1, Math.max(0, dot(sub(point, a), ab) / (segmentLength * segmentLength)));
      const position = { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
      const distanceM = len(sub(point, position));
      if (best === null || distanceM < best.distanceM - EPS) best = { progressM: this.cumulative[i]! + t * segmentLength, position, distanceM };
    }
    return best!;
  }
}
