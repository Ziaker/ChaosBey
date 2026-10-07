// The slow half of the browser smoke suite (polish idea 9, owner 2026-10-07).
// The full suite is serial and takes 20+ minutes on CI, which made every PR wait that long for a signal. Pull requests now
// run the FAST set (`npm run test:smoke:fast`: everything except the files below: 43 tests, about 5 minutes locally); pushes to main, the nightly
// run and a manual run still run ALL of it (`npm run test:smoke`). A spec goes here when it plays whole rounds, runs several
// matches back to back, or renders a prototype lab on software WebGL — the things that cost minutes, not seconds.
// tests/unit/smokeSplit.test.ts keeps this list honest (every entry is a real spec file).

export const SLOW_SPECS: readonly string[] = [
  // whole rounds / several matches
  'matchFlow.spec.ts',
  'repeatedMatchStability.spec.ts',
  'playerFlow.spec.ts',
  'hudAndRounds.spec.ts',
  'resultAutoContinue.spec.ts',
  'browserDeterminism.spec.ts',
  'selfTest.spec.ts',
  // prototype labs on software WebGL
  'vfxVisualConcepts.spec.ts',
  'cameraConcepts.spec.ts',
  'beyMotionConcepts.spec.ts',
  'beyVisualConcepts.spec.ts',
  'arenaVisualConcepts.spec.ts',
  'conditionVisualConcepts.spec.ts',
];
