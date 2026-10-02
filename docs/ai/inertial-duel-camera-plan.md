# Inertial Duel Camera — implementation lane

Status: IN PROGRESS. This branch integrates the camera/gameplay causal separation (#81), the 36 m arena camera scale correction (#88), then replaces axis-follow yaw authority with composition-driven inertial yaw.

Hard invariant: camera is downstream presentation. It may observe gameplay; it may never mutate or causally influence gameplay. The `screen` control scheme remains the sole explicit opt-in input exception already documented by #81.

Implementation order:
1. establish #81 + #88 baseline;
2. record current framing/spatial-stability metrics;
3. add screen-space safe/hard composition windows and debug metrics without behaviour change;
4. introduce persistent combat azimuth;
5. make yaw correction a last-resort response to composition error instead of continuously following player→opponent axis;
6. re-integrate HighSpeed, CloseCombat, KnockbackFollow, Clash, RingOut and Finisher;
7. tune A/B/C personalities without changing the architectural rule;
8. validate arena 3x, bowls, crossings, wall ricochets, high speed, knockback, CI and full smoke.

No main merge without explicit owner authorization.
