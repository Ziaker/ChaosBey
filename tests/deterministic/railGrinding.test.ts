// Owner, 2026-10-08 (Rail Grinding): rails are entered by jumping toward them, the way there and back is the same route, on a
// rail only charging the attack and jumping are allowed, and a jump leaves the rail early back to the arena. These tests pin that
// behaviour at the RailController level (pure) and, end to end, in a real match world.

import { describe, expect, it } from 'vitest';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { RailController, type RailTickInput } from '../../src/arena/rails/RailController';
import { resolveRail, type RailBlueprint } from '../../src/arena/rails/RailBlueprint';
import { RAIL_TUNING, scaleRailTuning } from '../../src/arena/rails/RailTraversal';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { arenaFloorRadius } from '../../src/arena/colliders/ArenaTuning';
import { BEY_BODY_COLLISION_GROUPS, BEY_RAIL_COLLISION_GROUPS } from '../../src/physics/collision/CollisionGroups';

const DT = 1 / 60;

function actions(held: Action[] = [], pressed: Action[] = []): ControllerActions {
  return { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: { x: 0, z: 0 } };
}

// A straight 20 m rail along +x at height 1 over a flat floor, so the arithmetic is readable.
const BLUEPRINT: RailBlueprint = { id: 'line', label: 'Line', points: [{ u: -0.25, v: 0, heightM: 1 }, { u: 0.25, v: 0, heightM: 1 }] };
const rail = resolveRail(BLUEPRINT, { floor: { id: 'flat', depthM: 0 }, floorRadiusM: 40 });

function input(over: Partial<RailTickInput>): RailTickInput {
  return { actions: actions(), position: { x: -9, y: 1.2, z: 0.5 }, velocity: { x: 6, y: 1, z: 0 }, headingRad: Math.PI / 2, grounded: false, inOwnHop: true, attachBlocked: false, dt: DT, ...over };
}

describe('rail grab: jumping toward a rail', () => {
  it('grabs a rail when a Bey in its own jump is near it and moving toward it', () => {
    const c = new RailController([rail]);
    const out = c.tick(input({ velocity: { x: 3, y: 1, z: -5 } }));
    expect(out.entered).toBe(true);
    expect(c.isOnRail()).toBe(true);
    expect(c.getState().entryReason).toBe('jump');
  });

  it('does not grab on the ground, outside its own jump, when blocked, or when moving away', () => {
    for (const over of [{ grounded: true }, { inOwnHop: false }, { attachBlocked: true }, { velocity: { x: 3, y: 1, z: 6 } }] as Partial<RailTickInput>[]) {
      const c = new RailController([rail]);
      expect(c.tick(input(over)).entered, JSON.stringify(over)).toBe(false);
      expect(c.isOnRail()).toBe(false);
    }
  });

  it('enters only through a gate: the middle of the course is no entrance, and the direction is away from the gate used', () => {
    const middle = new RailController([rail]);
    expect(middle.tick(input({ position: { x: 0, y: 1.2, z: 0.5 }, velocity: { x: 3, y: 1, z: -5 } })).entered).toBe(false);
    const atStart = new RailController([rail]);
    expect(atStart.tick(input({ position: { x: -9.5, y: 1.2, z: 0.5 }, velocity: { x: -3, y: 1, z: -5 } })).entered).toBe(true);
    expect(atStart.getState().direction).toBe(1); // even moving the other way along the line: it is the gate that decides
    const atEnd = new RailController([rail]);
    expect(atEnd.tick(input({ position: { x: 9.5, y: 1.2, z: 0.5 }, velocity: { x: 3, y: 1, z: -5 } })).entered).toBe(true);
    expect(atEnd.getState().direction).toBe(-1);
  });

  it('does not grab a rail that is out of reach', () => {
    const c = new RailController([rail]);
    expect(c.tick(input({ position: { x: -3, y: 4, z: 6 }, velocity: { x: 0, y: 0, z: -6 } })).entered).toBe(false);
  });

  it('with no rails (option off) never grabs anything', () => {
    expect(new RailController([]).tick(input({})).override).toBeNull();
  });
});

describe('on a rail', () => {
  function grabbed(over: Partial<RailTickInput> = {}): RailController {
    const c = new RailController([rail], { jumpExitLiftMps: 3 });
    expect(c.tick(input({ velocity: { x: 6, y: 1, z: -4 }, ...over })).entered).toBe(true);
    return c;
  }

  it('accelerates along the route toward the target speed, never past the maximum', () => {
    const c = grabbed();
    let last = c.getState().speedMps;
    expect(last).toBeGreaterThanOrEqual(RAIL_TUNING.startSpeedMps);
    for (let i = 0; i < 40; i++) {
      c.tick(input({ position: { x: -3 + i * 0.3, y: 1, z: 0 }, velocity: { x: 10, y: 0, z: 0 } }));
      if (!c.isOnRail()) break;
      expect(c.getState().speedMps).toBeGreaterThanOrEqual(last - 1e-9);
      expect(c.getState().speedMps).toBeLessThanOrEqual(RAIL_TUNING.maxSpeedMps);
      last = c.getState().speedMps;
    }
  });

  it('only allows charging the attack and jumping: Dodge and Jump/Drift are stripped from the actions', () => {
    const c = grabbed();
    const out = c.tick(input({ actions: actions([Action.Attack, Action.Dodge], [Action.Dodge]), velocity: { x: 10, y: 0, z: 0 } }));
    expect(out.actions.held.has(Action.Dodge)).toBe(false);
    expect(out.actions.pressedThisFrame.has(Action.Dodge)).toBe(false);
    expect(out.actions.held.has(Action.Attack)).toBe(true);
  });

  it('a Jump press leaves the rail early back to the arena, along the route, with a small lift', () => {
    const c = grabbed();
    c.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    const speed = c.getState().speedMps;
    const out = c.tick(input({ actions: actions([Action.JumpDrift], [Action.JumpDrift]), velocity: { x: 10, y: 0, z: 0 } }));
    expect(out.exitReason).toBe('voluntary');
    expect(c.isOnRail()).toBe(false);
    expect(out.launch).not.toBeNull();
    expect(out.launch!.y).toBeCloseTo(3, 6);
    expect(Math.hypot(out.launch!.x, out.launch!.z)).toBeCloseTo(speed * RAIL_TUNING.exitSpeedCarry, 6);
  });

  it('a Jump press OUTSIDE the arena turns the Bey round: it comes back along the same route to the gate it entered by, and leaves there', () => {
    const smallArena = { ...rail, arenaRadiusM: 5 }; // only |x| < 5 of the line is "inside the wall"
    const c = new RailController([smallArena], { jumpExitLiftMps: 3 });
    c.tick(input({ velocity: { x: 6, y: 1, z: -4 } })); // grabs at the start gate (x = -10 → -9)
    const jump = actions([Action.JumpDrift], [Action.JumpDrift]);
    for (let i = 0; i < 600 && c.getState().progressM < 12; i++) c.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    expect(c.getState().progressM).toBeGreaterThan(12); // x > 2? progress 12 = x +2: still inside; ride further out
    for (let i = 0; i < 600 && c.getState().progressM < 16; i++) c.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    expect(c.getRoute()!.insideArena).toBe(false);
    const turned = c.tick(input({ actions: jump, velocity: { x: 10, y: 0, z: 0 } }));
    expect(turned.exitReason).toBeNull(); // it did not leave
    expect(turned.launch).toBeNull();
    expect(c.isOnRail()).toBe(true);
    expect(c.getState().direction).toBe(-1);
    expect(c.getRoute()!.returning).toBe(true);
    // A second press while coming back does nothing.
    c.tick(input({ actions: jump, velocity: { x: -10, y: 0, z: 0 } }));
    expect(c.getState().direction).toBe(-1);
    let out = turned;
    for (let i = 0; i < 1200 && c.isOnRail(); i++) out = c.tick(input({ velocity: { x: -10, y: 0, z: 0 } }));
    expect(out.exitReason).toBe('end');
    expect(out.launch!.x).toBeLessThan(0); // leaving at the gate it entered by, heading back into the arena
    expect(c.getState().progressM).toBe(0);
  });

  it('the Rail speed scales every speed of the ride', () => {
    const slow = new RailController([rail]);
    const fast = new RailController([rail], { tuning: scaleRailTuning(RAIL_TUNING, 2) });
    slow.tick(input({ velocity: { x: 0, y: 0, z: -2 } }));
    fast.tick(input({ velocity: { x: 0, y: 0, z: -2 } }));
    expect(fast.getState().speedMps).toBeCloseTo(slow.getState().speedMps * 2, 6);
    for (let i = 0; i < 20; i++) {
      slow.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
      fast.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    }
    expect(fast.getState().speedMps).toBeGreaterThan(slow.getState().speedMps * 1.5);
    expect(scaleRailTuning(RAIL_TUNING, 1)).toBe(RAIL_TUNING);
  });

  it('leaves at the end of an open rail with the route\'s tangent velocity', () => {
    const c = grabbed();
    let out = c.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    for (let i = 0; i < 600 && c.isOnRail(); i++) out = c.tick(input({ velocity: { x: 10, y: 0, z: 0 } }));
    expect(out.exitReason).toBe('end');
    expect(out.launch).not.toBeNull();
  });

  it('an interruption (a hit) takes the Bey off and starts the re-grab cooldown', () => {
    const c = grabbed();
    c.interrupt('hit');
    expect(c.isOnRail()).toBe(false);
    expect(c.getState().exitReason).toBe('hit');
    // Right after leaving, the same jump cannot re-grab until the cooldown passes.
    expect(c.tick(input({ velocity: { x: 3, y: 1, z: -5 } })).entered).toBe(false);
  });

  it('the way back is the same route: either gate is an entrance, and the Bey travels the course away from it', () => {
    const forward = new RailController([rail]);
    const back = new RailController([rail]);
    forward.tick(input({ position: { x: -9.5, y: 1.2, z: 0.5 }, velocity: { x: 4, y: 0, z: -5 } }));
    back.tick(input({ position: { x: 9.5, y: 1.2, z: 0.5 }, velocity: { x: -4, y: 0, z: -5 } }));
    expect(forward.getState().railId).toBe(back.getState().railId);
    expect(forward.getState().direction).toBe(1);
    expect(back.getState().direction).toBe(-1);
  });
});

describe('rails in a real match', () => {
  function pressing(pressed: Action[], held: Action[], move: { x: number; z: number }): CombatController {
    const a: ControllerActions = { held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: move };
    return { sampleActions: () => a };
  }

  async function build(railsEnabled: boolean) {
    const world = await SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, aiMashSource: new NullAiMashSource(), matchConfigOverrides: { railsEnabled } as never });
    const b = world.first;
    // Run-up toward the east rail's first gate (x = 0.88 of the floor radius = 31.7 m), the opponent parked still on the far side.
    b.body.setTranslation({ x: 26, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(b.arenaFloor, 26, 0), z: 0 }, true);
    b.body.setLinvel({ x: 8, y: 0, z: 0 }, true);
    return world;
  }

  function park(world: Awaited<ReturnType<typeof build>>): void {
    world.second.body.setTranslation({ x: 0, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(world.second.arenaFloor, 0, -33), z: -33 }, true);
    world.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  it('a Bey that jumps toward the east rail with the option on grabs it, rides it, and a second jump returns it to the arena', async () => {
    const world = await build(true);
    try {
      const idle = new IdleController();
      let grabbedAt = -1;
      for (let t = 0; t < 240 && grabbedAt < 0; t++) {
        park(world);
        world.step({ first: pressing(t === 0 ? [Action.JumpDrift] : [], [Action.JumpDrift], { x: 1, z: 0 }), second: idle });
        if (world.first.rail.isOnRail()) grabbedAt = t;
      }
      expect(grabbedAt).toBeGreaterThanOrEqual(0);
      expect(world.first.rail.getState().railId).toBe('rail-east');
      const speedAtGrab = world.first.rail.getState().speedMps;
      for (let t = 0; t < 8; t++) {
        park(world);
        world.step({ first: pressing([], [], { x: 0, z: 0 }), second: idle });
      }
      expect(world.first.rail.isOnRail()).toBe(true);
      expect(world.first.rail.getState().speedMps).toBeGreaterThan(speedAtGrab);
      expect(world.first.rail.getRoute()!.insideArena).toBe(true); // still between the gate and the wall: a jump leaves for the arena
      // A jump press leaves it early.
      park(world);
      world.step({ first: pressing([Action.JumpDrift], [Action.JumpDrift], { x: 0, z: 0 }), second: idle });
      expect(world.first.rail.isOnRail()).toBe(false);
      expect(world.first.rail.getState().exitReason).toBe('voluntary');
    } finally {
      world.dispose();
    }
  });

  async function grabEastGate(world: Awaited<ReturnType<typeof build>>, idle: IdleController): Promise<void> {
    for (let t = 0; t < 240 && !world.first.rail.isOnRail(); t++) {
      park(world);
      world.step({ first: pressing(t === 0 ? [Action.JumpDrift] : [], [Action.JumpDrift], { x: 1, z: 0 }), second: idle });
    }
    expect(world.first.rail.isOnRail()).toBe(true);
  }

  it('the whole course: out over the wall and back in, the arena\'s colliders off on the way, never a ring-out', async () => {
    const world = await build(true);
    try {
      const idle = new IdleController();
      await grabEastGate(world, idle);
      const R = arenaFloorRadius();
      let maxRadius = 0;
      let offTicks = 0;
      for (let t = 0; t < 1200 && world.first.rail.isOnRail(); t++) {
        park(world);
        world.step({ first: pressing([], [], { x: 0, z: 0 }), second: idle });
        const p = world.first.body.translation();
        maxRadius = Math.max(maxRadius, Math.hypot(p.x, p.z));
        if (world.first.rail.isOnRail()) {
          expect(world.first.collider.collisionGroups()).toBe(BEY_RAIL_COLLISION_GROUPS);
          offTicks++;
        }
        expect(world.roundState.isOver).toBe(false);
      }
      expect(maxRadius).toBeGreaterThan(R * 1.3); // it really went round the OUTSIDE of the arena
      expect(offTicks).toBeGreaterThan(200);
      expect(world.first.rail.isOnRail()).toBe(false);
      expect(world.first.rail.getState().exitReason).toBe('end');
      expect(world.first.collider.collisionGroups()).toBe(BEY_BODY_COLLISION_GROUPS); // back in the arena's collision
      const p = world.first.body.translation();
      expect(Math.hypot(p.x, p.z)).toBeLessThan(R); // and back inside the wall
      // The ring-out delay (1.5 s) has long passed over the ride: had it counted, the round would be over.
      for (let t = 0; t < 30; t++) {
        park(world);
        world.step({ first: pressing([], [], { x: 0, z: 0 }), second: idle });
      }
      expect(world.roundState.isOver).toBe(false);
    } finally {
      world.dispose();
    }
  });

  it('a Jump outside the arena brings the Bey back along the same route to the gate it entered by', async () => {
    const world = await build(true);
    try {
      const idle = new IdleController();
      await grabEastGate(world, idle);
      const R = arenaFloorRadius();
      for (let t = 0; t < 1200 && Math.hypot(world.first.body.translation().x, world.first.body.translation().z) < R * 1.25; t++) {
        park(world);
        world.step({ first: pressing([], [], { x: 0, z: 0 }), second: idle });
      }
      expect(world.first.rail.getRoute()!.insideArena).toBe(false);
      park(world);
      world.step({ first: pressing([Action.JumpDrift], [Action.JumpDrift], { x: 0, z: 0 }), second: idle });
      expect(world.first.rail.isOnRail()).toBe(true); // it did not fall into the void
      expect(world.first.rail.getRoute()!.returning).toBe(true);
      for (let t = 0; t < 1500 && world.first.rail.isOnRail(); t++) {
        park(world);
        world.step({ first: pressing([], [], { x: 0, z: 0 }), second: idle });
      }
      expect(world.first.rail.isOnRail()).toBe(false);
      expect(world.first.rail.getState().exitReason).toBe('end');
      const p = world.first.body.translation();
      expect(Math.hypot(p.x, p.z)).toBeLessThan(R);
      expect(p.x).toBeGreaterThan(R * 0.7); // at the east gate it came in by (x ≈ 0.88 R)
      expect(world.roundState.isOver).toBe(false);
    } finally {
      world.dispose();
    }
  });

  it('with the option off the same jump grabs nothing', async () => {
    const world = await build(false);
    try {
      const idle = new IdleController();
      for (let t = 0; t < 240; t++) {
        park(world);
        world.step({ first: pressing(t === 0 ? [Action.JumpDrift] : [], [Action.JumpDrift], { x: 1, z: 0 }), second: idle });
        expect(world.first.rail.isOnRail()).toBe(false);
      }
    } finally {
      world.dispose();
    }
  });
});

describe('a Bey on a rail is out of the arena (owner, 2026-10-08)', () => {
  it('takes no hit and no body contact from the other Bey, and the other Bey is unharmed too', async () => {
    const world = await SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, aiMashSource: new NullAiMashSource(), matchConfigOverrides: { railsEnabled: true } as never });
    try {
      const a = world.first;
      a.body.setTranslation({ x: 26, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(a.arenaFloor, 26, 0), z: 0 }, true);
      a.body.setLinvel({ x: 8, y: 0, z: 0 }, true);
      const idle = new IdleController();
      const press = (pressed: Action[], held: Action[], move: { x: number; z: number }): CombatController => ({ sampleActions: () => ({ held: new Set(held), pressedThisFrame: new Set(pressed), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0, moveIntent: move }) });
      // Park the opponent where the rail is, right under the route, while the first Bey rides over it.
      let onRailTicks = 0;
      const stabilityBefore = world.second.stability.resource.value;
      for (let t = 0; t < 120; t++) {
        // Until the first Bey is on the rail the opponent waits far away; then it stands right under the rider, every tick.
        const rider = a.body.translation();
        const together = a.rail.isOnRail() && Math.hypot(rider.x, rider.z) < 34; // while the ride is inside the wall (the opponent never leaves the arena)
        const p = together ? rider : { x: 0, y: 0, z: -33 };
        world.second.body.setTranslation({ x: p.x, y: together ? rider.y : BEY_SPAWN_HEIGHT_M + floorHeightAt(world.second.arenaFloor, p.x, p.z), z: p.z }, true);
        world.second.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        world.step({ first: press(t === 0 ? [Action.JumpDrift] : [], a.rail.isOnRail() ? [Action.Attack] : [Action.JumpDrift], { x: 1, z: 0 }), second: idle });
        if (a.rail.isOnRail()) {
          onRailTicks++;
          expect(a.rail.isIntangible()).toBe(true);
        }
      }
      expect(onRailTicks).toBeGreaterThan(20);
      // The opponent standing under the rail was never hit, pushed or damaged.
      expect(world.second.stability.resource.value).toBe(stabilityBefore);
      expect(world.second.movement.isKnockbackPlaying()).toBe(false);
    } finally {
      world.dispose();
    }
  });

  it('the intangibility outlasts the rail only while the two bodies still overlap, and is capped', () => {
    const c = new RailController([rail]);
    expect(c.tick(input({ velocity: { x: 3, y: 1, z: -5 } })).entered).toBe(true);
    c.updateIntangibility(true, DT);
    expect(c.isIntangible()).toBe(true);
    c.interrupt('hit');
    c.updateIntangibility(true, DT);
    expect(c.isIntangible()).toBe(true); // still overlapping the other Bey
    c.updateIntangibility(false, DT);
    expect(c.isIntangible()).toBe(false); // clear of it
    const d = new RailController([rail]);
    d.tick(input({ velocity: { x: 3, y: 1, z: -5 } }));
    d.updateIntangibility(true, DT);
    d.interrupt('voluntary');
    for (let i = 0; i < 70; i++) d.updateIntangibility(true, DT);
    expect(d.isIntangible()).toBe(false); // the cap (1 s) ended it though still overlapping
  });
});
