# CLAUDE.md — operating policy for AI agents working on ChaosBey

This file is read by Claude Code (and any equivalent agent) as project
instructions. It governs **process** (git operations, test cadence) — it does
not and cannot override the master design document on any actual game-design,
mechanics, or visual decision.

## 1. Fast Development / Git policy

The agent is **pre-authorized**, without asking the owner first, to:

- create commits
- push
- create branches
- open pull requests
- update pull requests (including editing their description)
- take a pull request out of Draft
- rebase or merge a branch
- **merge a pull request**
- delete a branch that has already been merged
- move on immediately to the next step of a task

Once a change is technically ready (it does what it was asked to do, and the
validation in §2 below is green), **merge it**. Do not stop a turn with
"waiting for your decision", "ready to merge, let me know", or similar — if
the gate in §2 is satisfied, that stop doesn't happen; make the call and keep
going.

### Exceptions — still require asking first

- The tests that are actually relevant to a change are red because of that
  change. (A failure already known to be pre-existing and unrelated — e.g.
  inherited from a base branch that's being intentionally kept separate from
  its own fix — is not this: say so once, per the repo's PR/CI conventions,
  and continue.)
- Anything that would destroy or overwrite the owner's own in-progress work.
- A game-design, mechanics, or visual-presentation call that is explicitly
  marked **ASK FIRST** / not yet decided in the master design document or in
  `docs/design-decisions/`. (Process — committing, pushing, branching, PRing,
  rebasing, merging — is never itself an ASK FIRST design decision, no matter
  how large the underlying change is.)
- Mixing genuinely unrelated work into one change for no reason (e.g. folding
  unrelated gameplay changes into a packaging-only PR, or vice versa) — keep
  commits and PRs small and coherent; this is about scope hygiene, not about
  needing permission for ordinary git operations.

### Commit cadence

Commit frequently, in small, coherent units. There is no requirement to
accumulate a large amount of work before committing.

## 2. Testing policy — fast loop vs. pre-merge vs. full slow suite

Don't run the full slow suite after every small change. Use the right level
for where you are:

**FAST LOOP** (during active iteration on a change):
- Typecheck, if the change touches types.
- The unit/deterministic test(s) directly covering what changed.
- A targeted smoke/feature test only if one already exists for exactly this
  area.
- A production build only when something about the change could plausibly
  affect it (e.g. a build-config or asset-pipeline change).

This is what to run between edits while developing. It should be fast —
seconds to at most a couple of minutes, not the full suite.

**PRE-MERGE** (once, when the change is actually ready to land):
- Full typecheck.
- The full fast suite: `npm test` (`tests/unit` + `tests/deterministic` +
  `tests/replay` — currently well under two minutes total).
- Production build (`npm run build`).
- Any other targeted check the specific change calls for.

**FULL SLOW SUITE** (`npm run test:smoke`, the full Playwright suite — this
is the one that legitimately takes 20-45 minutes serially):
- Run it in CI on every PR/push to `main` (already wired up in
  `.github/workflows/deploy.yml`) — that's what CI is for.
- Run it locally before merge only when the change could plausibly affect
  something it covers (rendering, the player flow, the Debug Lab, Self Test,
  drift/jump feel visible in a real browser) and you want to validate before
  pushing, not after.
- Do **not** re-run it locally just because *some* change touched the repo.
  A trivial doc/comment/isolated-test/config-only change that cannot affect
  what the smoke suite exercises does not need it repeated locally — CI will
  still run it once, as it always does, on the push.
- A failure the smoke suite already confirmed on one commit does not need
  reconfirming on a next commit that could not have touched that code path.

CI running is not a reason to sit idle: while it runs, keep working — start
the next step, prep the next branch, fix something unrelated — and come back
to act on the result. Don't block other work waiting on a CI run you can't
speed up.

## 3. Master design document

The authoritative design specification and AI-agent operating contract is
provided to development agents out-of-band (it is not a file in this
repository). Every meaningful **design** decision traces back to it — on an
actual design question, that document (and the project's own
`docs/design-decisions/`) wins, and anything marked ASK FIRST there stays
ASK FIRST. It has never required re-running the full slow suite after every
micro-change, and it does not require holding ready git operations (commit,
push, PR, rebase, merge) for manual authorization — §1 and §2 above make that
explicit for this repository so it isn't left to interpretation turn to turn.
