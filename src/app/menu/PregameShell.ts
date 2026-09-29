// ============================================================
// PREGAME SHELL — M10 LANE A HANDOFF
// Lane A establishes the real Main Menu -> Character Select -> Pregame
// route and carries the chosen Bey. Lane B owns the simulator controls
// that fill this screen; this shell intentionally exposes the selected
// identity and the next setup categories without inventing gameplay rules.
// ============================================================

import { CHARACTER_SELECT_OPTIONS, selectedBeyId } from './CharacterSelect';
import { appModeHref } from '../modes/appMode';

export interface PregameShellOptions {
  readonly navigate?: (href: string) => void;
  readonly location?: { readonly pathname: string; readonly search: string };
}

export function startPregameShell(mount: HTMLElement, options: PregameShellOptions = {}): void {
  injectStyle();
  const location = options.location ?? window.location;
  const navigate = options.navigate ?? ((href: string) => window.location.assign(href));
  const id = selectedBeyId(location.search);
  const selected = CHARACTER_SELECT_OPTIONS.find((option) => option.definition.id === id)!;

  const root = document.createElement('main');
  root.className = 'pregame-shell';
  root.setAttribute('data-testid', 'pregame-shell');
  root.innerHTML = `
    <div class="pregame-shell__eyebrow">PRE-MATCH // STEP 2</div>
    <h1>SIMULATOR SETUP</h1>
    <section class="pregame-shell__locked" data-testid="pregame-player-bey">
      <span>PLAYER BEY</span>
      <strong>${selected.role}</strong>
      <small>${selected.tagline}</small>
    </section>
    <p>Player selection is locked into the URL. Opponent AI, rules and arena setup attach here next without changing combat semantics.</p>
    <div class="pregame-shell__roadmap" aria-label="Pregame setup categories">
      <span>01 PLAYER ✓</span><span>02 OPPONENT / AI</span><span>03 BATTLE RULES</span><span>04 ARENA</span>
    </div>
  `;

  const actions = document.createElement('div');
  actions.className = 'pregame-shell__actions';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = '← CHANGE BEY';
  back.setAttribute('data-testid', 'pregame-back');
  back.addEventListener('click', () => navigate(appModeHref('character-select', location)));
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.textContent = 'MAIN MENU';
  menu.setAttribute('data-testid', 'pregame-menu');
  menu.addEventListener('click', () => navigate(appModeHref('menu', location)));
  actions.append(back, menu);
  root.append(actions);
  mount.append(root);
  back.focus();
}

function injectStyle(): void {
  if (document.querySelector('#chaosbey-pregame-shell-style')) return;
  const style = document.createElement('style');
  style.id = 'chaosbey-pregame-shell-style';
  style.textContent = `
    .pregame-shell { pointer-events:auto; position:fixed; inset:0; box-sizing:border-box; padding:clamp(28px,6vw,80px); background:radial-gradient(circle at 78% 20%,#17233b 0,#090d16 38%,#05070d 72%); color:#edf3ff; font:14px/1.5 ui-monospace,Menlo,Consolas,monospace; }
    .pregame-shell__eyebrow { color:#6f9cff; letter-spacing:.18em; font-size:11px; font-weight:700; }
    .pregame-shell h1 { margin:8px 0 28px; font-size:clamp(30px,5vw,56px); letter-spacing:.07em; }
    .pregame-shell__locked { display:grid; width:min(520px,90vw); grid-template-columns:120px 1fr; gap:4px 18px; padding:18px; border:1px solid #48649a; border-left:4px solid #86aaff; background:rgba(15,22,37,.82); }
    .pregame-shell__locked span { grid-row:1/3; align-self:center; color:#71809a; font-size:10px; letter-spacing:.12em; }
    .pregame-shell__locked strong { font-size:24px; letter-spacing:.08em; text-transform:uppercase; }
    .pregame-shell__locked small { color:#9ebeff; }
    .pregame-shell p { color:#9eabc1; max-width:650px; margin:22px 0; }
    .pregame-shell__roadmap { display:flex; flex-wrap:wrap; gap:8px; max-width:800px; }
    .pregame-shell__roadmap span { padding:8px 10px; border:1px solid #2b354b; color:#7f8da6; background:#0c111d; font-size:11px; }
    .pregame-shell__roadmap span:first-child { color:#bcd1ff; border-color:#5579c2; }
    .pregame-shell__actions { display:flex; gap:10px; margin-top:36px; }
    .pregame-shell__actions button { font:inherit; color:#d8e4ff; background:#151d2d; border:1px solid #405173; padding:10px 15px; cursor:pointer; }
    .pregame-shell__actions button:hover,.pregame-shell__actions button:focus-visible { outline:2px solid #8eaff0; outline-offset:2px; }
  `;
  document.head.append(style);
}
