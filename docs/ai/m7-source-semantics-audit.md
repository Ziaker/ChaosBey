# M7 — Source-semantics audit of what the AI reads

Every value the AI perceives is read in `AIController.extractRawState()` (or,
for the Clash, directly from `ClashController`) **before** that tick's
`tickMatch()` runs. So each value describes the state left by the previous
tick, which is the same state the gameplay systems read at the start of this
tick. This table checks, for each input:

- where it really comes from;
- what it means over time;
- whether it is current state or a remembered or cached value;
- how the AI reads it;
- whether anything was wrong.

The check is against the code on `main@47a6deb` plus M7 Part 2b.

| Input | 1. Getter / origin | 2. Temporal semantics | 3. Current or cached? | 4. How the AI interprets it | 5. Discrepancy found |
|---|---|---|---|---|---|
| **Attack state** | `AttackController.getState()` | State machine value after the previous tick's `attack.tick()`: Neutral → Buffering → ChargingDash/CircularActive → DashActive → recovery. | Current. | Own state: commitment lock (`ENGAGED_ATTACK_STATES`), "already attacking", press gating. Opponent state: `hasImminentHitbox`, punish window (recovery states), counter read (ChargingDash/DashActive). The edge + threat rule uses only the **live-hitbox** states (CircularActive, DashActive). | None in the getter. `hasImminentHitbox` deliberately also counts Buffering/ChargingDash as a telegraph, not a live hitbox. Part 2b keeps edge recovery ahead of a telegraph and lets only a live hitbox preempt it. |
| **Dash charge** | `AttackController.getChargeFraction()` = `clamp01((chargeTimerS - MIN) / (MAX - MIN))` | `chargeTimerS` only resets when a **new** charge starts. After a Dash ends, the getter keeps returning the last Dash's charge on purpose, for HUD and debug. | **History** outside a live Dash. | `perceiveCombatant` reports it only in `LIVE_DASH_CHARGE_STATES` (ChargingDash, DashActive) and 0 otherwise (the canonical M7 Part 2a fix). | **Yes, fixed by M7 Part 2a:** reading the stale value made every AI Dash once per match. Part 2b keeps the canonical fix. The re-arm check in `aiBatchSelfTest` now fires only when the AI wants another Dash, and it catches this bug when it is reintroduced. |
| **Attack Energy** | `AttackEnergySystem.resource.fraction` | Drained while Attack is held and charging; regenerates after a delay. Updated in `attackEnergy.tick()` after `attack.tick()`. | Current. | `AttackDash` needs more than 0.25 of the energy to be a candidate. ActionSelection holds Attack while energy is above 0. | None. |
| **Dodge state** | `DodgeController.getState()` | Idle → Dodging (fixed active time, i-frames only while grounded) → Cooldown (fixed time) → Idle. Timers advance even while airborne. | Current. | Idle: a dodge can be chosen. Dodging: stay grounded, never hop (i-frames). Cooldown: fall back to a hop (not near the edge), a sidestep or a retreat. | None in the getter. **AI-side bug fixed in 2b:** Dodge used to be pressed without checking ground or Stamina and then held. An ignored press swallowed the whole dodge, and a retry without the Stamina check became spam. |
| **Dodge affordability / cooldown** | `stamina.resource.value >= DODGE_STAMINA_COST`, the same comparison `DodgeController.tick()` makes. Cooldown = `DodgeState.Cooldown`. | Stamina is read at the same point `tickMatch` passes it to `dodge.tick()`: nothing drains Stamina between the AI's sample and that call. | Current. | `canAffordDodge` gates DodgeThreat (IntentSelection) and the press (ActionSelection). The reason text says "unaffordable (not enough Stamina)". The AI does not read the remaining cooldown time, only the state. | None. The AI never reads the cooldown timer, the same as a player without a HUD timer. |
| **AirRecover** | `DodgeController.isAirRecoveryAvailable()` (public getter) = armed flag **and** already airborne on the previous tick | Armed by `registerLaunch()` on a knockback or launch: immediately if already airborne, otherwise on the next takeoff within `LAUNCH_PENDING_WINDOW_S`. Cleared by the recovery press. The raw flag is **not cleared on landing**; it is overwritten inside the next takeoff tick. | Current, one-shot, for the current airborne period. | Used as `!grounded && airRecoveryAvailable`. Highest-priority intent. A launch interrupts commitments and pending late reactions, then waits a full reaction delay from the moment the window is seen (so a window shorter than the reaction delay is lost — characterized in `aiAirRecoveryTiming.test.ts`, a design point for the owner). Presses once, never holds. | **Yes, fixed in M7 Part 2b final:** the getter returned the raw flag, and ANDing it with airborne was not enough — on the first airborne tick of a later plain hop after an unused launch it read true, the AI took it for a new launch (reset its reaction timer, dropped a pending late reaction), yet a press on that tick recovers nothing. In AI-vs-AI play 18 of 87 windows were such phantoms. The getter now also requires `!wasGrounded`; regression in `aiAirRecoveryPhantom.test.ts`. Not privileged: an airborne press without the window is a free no-op. |
| **Drift / jump state** | `DriftController.getState()` | Idle → Hopping → Drifting → Recovering. Hopping becomes Drifting only if JumpDrift and steering are still held on landing. | Current. | The commitment lock keeps UseJumpDrift through the hop. The evasive hop requires Idle, grounded and edge risk below 0.3. | None. |
| **Stamina** | `StaminaSystem.resource.fraction` | Drained by movement (`stamina.tick(speed)` after physics), by dodge costs and by hits. | Current. | Own Stamina: self-vulnerability and dodge affordability. Opponent Stamina: `fatigueExploitation` opportunity (below 0.5). | None. |
| **Stability / Broken** | `StabilitySystem.resource.fraction`, `StabilitySystem.isBroken` | Damaged by hits. Broken is recoverable: after a longer delay without hits, Stability climbs back to a floor and Broken clears. | Current. | Opponent: opportunity. Own: self-vulnerability. | None. Broken is a state, not a latched flag: it clears exactly when the system clears it. |
| **Clash state / cooldown** | `ClashController.getState()`, `getCooldownRemainingS()` | Idle → Active (simulation frozen, mash counted) → Cooldown → Idle. `ClashOrchestration` starts a Clash only when both sides' hits connect within the Clash window **while Idle**; on Cooldown the same pair resolves as a weakened trade. | Current. | **Active:** the controller skips perception and decisions and only mashes through ControllerActions. **Idle:** `clashWillingness` (IntentSelection, ported from PR #15) scales the attack candidates when the opponent has a live/imminent hitbox — aggression leans in, caution away, and a Stamina edge leans in via ClashFormula's own `computeStaminaFactor` on both visible Stamina bars. **Cooldown:** willingness is 1 (no Clash to accept). | None. The previously open gap (GDD 42/63: create/accept Clash opportunities) is closed by the port. The remaining cooldown time is not read, only the state. |
| **Heading** | `MovementController.getHeadingRad()` | Live. Updated in `movement.applyPreStep()` (or by a Dash override), so at sample time it is the previous tick's final heading. | Current. | Steering errors, Dash release alignment, and the dodge-key mapping (the 8 key combinations, using the same forward and right axes as `DodgeController.applyBurst`). | None. The mapping uses the same `fromYaw` and `perpendicular` conventions as `applyBurst`, and a unit test checks all 8 directions. |
| **Velocity** | `RigidBody.linvel()` (x, z) | Velocity after the previous physics step, collisions included. `MovementController` sets it before the step, except during its post-impact cooldown. | Current (physics). | Speed, closing speed, the opponent's predicted position (prediction strength), **own momentum-projected edge risk** (0.5 s), and the evasion side choice (opposite the attacker's sideways drift). | None. The momentum projection is new in 2b and uses only public position and velocity. |
| **Position** | `RigidBody.translation()` (x, z) | After the previous physics step. | Current. | Distance (always observed, never predicted), edge risk, direction to the center, blocked-recovery detection. | None. **Kept separate:** `opponent.positionXZ` is the observed position; the aim point and the prediction live in `WorldState.targeting` (next rows). |
| **Predicted opponent position** | `WorldState.targeting.predictedOpponentXZ` = `AiPerception.predictPositionXZ(opponent, horizon)` = observed position + observed velocity × horizon | Linear extrapolation from this tick's public position and velocity; recomputed every tick. | Current (derived, no memory). | Only feeds the aim point (never range checks). **Null when prediction is off** (difficulty `predictionStrength` 0, or no `PredictionConfig`). | None. Before the port it was not exposed at all; the debug "target" was the observed position. A stationary opponent gives predicted = observed because it isn't moving, not as a relabel (unit-tested). |
| **Prediction horizon / strength** | `AIController`'s `PREDICTION_HORIZON_S` (0.35 s) and `AiDifficultyProfile.predictionStrength`, passed to `buildWorldState` as `PredictionConfig` | Constant per AI (difficulty data). | Current. | Reported as-is in `targeting` when prediction is in use; both 0 when it is off. | None. |
| **Aim position** | `WorldState.aimPositionXZ` = `targeting.aimPositionXZ` = observed pulled toward predicted by strength | Recomputed every tick. | Current (derived). | Where `directionToOpponent` points: steering, Dash release alignment. Equals the observed position when prediction is off. | None. Kept under #16's name; it is the same value in both places (tested by identity). |
| **Grounded** | `isGrounded(physics, collider)` (contact manifold) | Computed at sample time. `tickMatch` recomputes it at the same physics state before `drift.tick()` and `dodge.tick()`. | Current. | Dodge and hop gating, AirRecover. | None. The AI's value equals the one the systems use that tick. |
| **Hitbox / threat flags** | Derived: `hasImminentHitbox = ENGAGED_ATTACK_STATES.has(attackState)`. Threat = in range (≤ 6.5 m) × imminent. | Follows the attack state. | Current (derived). | Threat override (at or above 0.35). The edge + threat rule additionally requires a live hitbox (Active states). | By design, the threat includes telegraph states (Buffering, ChargingDash). The hitbox itself (`AttackController`'s internal hitbox) is **not** read, only the state a spectator sees. |

## Freeze semantics (hitstop)

`main.ts` skips `tickMatch()` while frozen and samples every controller with
`simulationFrozen: true`. The AI then returns
`ActionSelector.repeatFrozenActions()` before reading anything. During the
freeze:

- held buttons are repeated;
- nothing new is pressed;
- the reaction timer, the late-reaction clock and the intent stand still;
- no RNG is consumed.

`tests/deterministic/aiHitstopFreeze.test.ts` checks this at three points: mid
Dash charge, during a pending late reaction, and in a counter stance. After the
freeze, the whole action sequence is identical, tick for tick, to a control run
without the freeze.

**Minor finding:** during a freeze, `repeatFrozenActions` reports hold
durations one tick past the last real sample, because it reads the tick counter
that `commit()` already advanced. The value then stays constant. It is harmless:
`tickMatch` does not run while frozen, and the first real tick afterwards
matches the control run. This is documented in the test and left unchanged.
