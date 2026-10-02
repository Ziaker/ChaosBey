# Camera follows the bigger arena (0.14.1)

Follow-up to the arena scale pass (0.12.0, [`arena-scale-pass.md`](arena-scale-pass.md)), which left the in-game camera untouched and reported it as tuned for 12 m.

## Problem
`CameraRig` kept the eye within `containRadiusM: 10.5` of the arena centre and `CameraDirector` watched ring-outs from `RINGOUT_WATCH_RADIUS_M = 9`. On the 36 m stage a fight near the rim was framed from an eye pulled back to 10.5 m from the centre, i.e. far from the action, and the ring-out camera started anticipating at 9 m, long before the edge.

## Change (no behaviour change except these two radii)
- `CAMERA_CONTAIN_RADIUS_M = ARENA_FLOOR_RADIUS - 1.5` (34.5 m; was 10.5 on the 12 m arena: the same 1.5 m margin inside the wall).
- `CAMERA_RINGOUT_WATCH_RADIUS_M = RINGOUT_RADIUS_M - 3.9` (33 m; was 9 m on the 12.9 m ring-out radius), passed to the director through a new optional `DirectorOptions.ringOutWatchRadiusM`. The Camera Lab keeps its own 9 m default.
- Presets A/B/C, their distances/heights, FOV, orbit, rescue, Clash and Finisher behaviour, controls and input semantics: unchanged.
- Tests: `cameraRig.test.ts` rescaled (rim positions are now at 34.5 m) plus three new tests: the radii follow the arena constants; a fight at r = 30 m is followed from within the rig's max distance instead of from mid-arena; an airborne Bey at 20 m is not a ring-out candidate, at 34 m it is.

Screenshots: `camera-arena-scale/` (`02-near-rim.png`: player 33 m from the centre, both Beys in frame).

## Not changed / still open
Rounds are longer on the 36 m stage and AI-vs-AI ring-outs are rare (see the arena scale pass report); that is a gameplay decision, not a camera one.
