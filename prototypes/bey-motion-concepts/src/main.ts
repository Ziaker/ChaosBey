// ============================================================
// BEY MOTION LAB — ENTRY POINT
// Standalone prototype page, isolated from the game: it imports nothing
// from src/ (game values it mirrors are copied in tuning.ts; game
// behavior it shows comes from exported replay data) and changes no
// gameplay, physics, collider or stat. Two sections:
// - Motion physics: presets A/B/C + live parameters + reproducible
//   scenarios + game replays + debug (physicsSection.ts);
// - Spin readability: the nine concepts spinning at game speed, seen from
//   the game's camera, with the 60 fps aliasing readout (spinSection.ts).
// ============================================================

import { physics, physicsHook, physicsKey, render as renderPhysics, startPhysics } from './physicsSection';
import { spinHook, viewer as spinViewer } from './spinSection';

type Tab = 'physics' | 'spin';

function setTab(tab: Tab): void {
  document.documentElement.dataset.tab = tab;
  physics.active = tab === 'physics';
  spinViewer.active = tab === 'spin';
  document.querySelectorAll<HTMLButtonElement>('#tab-bar button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
  // The newly shown canvas was hidden: size it now.
  requestAnimationFrame(() => {
    physics.resize();
    spinViewer.resize();
  });
}

document.querySelectorAll<HTMLButtonElement>('#tab-bar button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab as Tab)));

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (document.documentElement.dataset.tab !== 'physics') return;
  if (physicsKey(e)) e.preventDefault();
});

setTab(new URLSearchParams(location.search).get('tab') === 'spin' ? 'spin' : 'physics');
startPhysics();
renderPhysics();

// Automation hook for screenshot/smoke scripts (not a gameplay API).
Object.assign(window, {
  __beyMotionLab: {
    tab: (t: Tab) => setTab(t),
    currentTab: () => document.documentElement.dataset.tab,
    physics: physicsHook,
    spin: spinHook,
  },
});
