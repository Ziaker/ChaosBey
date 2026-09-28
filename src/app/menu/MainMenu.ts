// ============================================================
// MAIN MENU (GDD sections 1.2, 56)
// The page the plain game URL opens. Player entries sit at the top level;
// the developer tools (DEBUG LAB, SELF TEST) live in a separate
// "Developer / Debug" section, per the owner's decision (option C), so
// they are never mixed with the normal player flow.
//
// Every entry boots its mode through the existing `?mode=` route (the
// same URL a direct link uses), so no mode has a second bootstrap, and
// the browser Back button returns to this menu.
//
// Visuals: provisional. The menu's final visual treatment is still behind
// the owner's visual approval gate (GDD 1.6, 171.10;
// VISUAL_APPROVALS_MASTER.md 11.1). This reuses the existing developer-UI
// styling and is not a visual direction.
// ============================================================

import { appModeHref, type AppMode } from '../modes/appMode';

export interface MainMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly mode: AppMode;
}

export interface MainMenuModel {
  /** Top level: the normal player flow only. */
  readonly player: readonly MainMenuEntry[];
  /** Label of the button that opens the developer section. */
  readonly developerSectionLabel: string;
  /** Inside the Developer / Debug section only. */
  readonly developer: readonly MainMenuEntry[];
}

/**
 * GDD 56 lists PLAY, SELF TEST, DEBUG LAB and SETTINGS. SETTINGS has no
 * screen yet (Milestone 10), so it is not shown rather than shown dead.
 */
export const MAIN_MENU: MainMenuModel = {
  player: [{ id: 'play', label: 'PLAY', mode: 'play' }],
  developerSectionLabel: 'Developer / Debug',
  developer: [
    { id: 'debug-lab', label: 'DEBUG LAB', mode: 'debug-lab' },
    { id: 'self-test', label: 'SELF TEST', mode: 'self-test' },
  ],
};

export interface MainMenuOptions {
  /** Defaults to loading the URL in this tab. */
  readonly navigate?: (href: string) => void;
  readonly location?: { readonly pathname: string; readonly search: string };
}

export function startMainMenu(mount: HTMLElement, options: MainMenuOptions = {}): void {
  const location = options.location ?? window.location;
  const navigate = options.navigate ?? ((href: string) => window.location.assign(href));
  injectStyle();

  const root = element('div', 'main-menu');
  root.setAttribute('data-testid', 'main-menu');
  const title = element('h1', 'main-menu__title');
  title.textContent = 'CHAOSBEY';

  const entryButton = (entry: MainMenuEntry): HTMLButtonElement => {
    const button = element('button', 'main-menu__entry');
    button.type = 'button';
    button.textContent = entry.label;
    button.setAttribute('data-testid', `main-menu-${entry.id}`);
    button.addEventListener('click', () => navigate(appModeHref(entry.mode, location)));
    return button;
  };

  const top = element('nav', 'main-menu__list');
  top.setAttribute('aria-label', 'Main menu');
  top.setAttribute('data-testid', 'main-menu-top');
  for (const entry of MAIN_MENU.player) top.append(entryButton(entry));

  const developerToggle = element('button', 'main-menu__entry main-menu__entry--section');
  developerToggle.type = 'button';
  developerToggle.textContent = MAIN_MENU.developerSectionLabel;
  developerToggle.setAttribute('data-testid', 'main-menu-developer');
  developerToggle.setAttribute('aria-expanded', 'false');
  developerToggle.setAttribute('aria-controls', 'main-menu-developer-section');
  top.append(developerToggle);

  const developer = element('section', 'main-menu__list main-menu__list--developer');
  developer.id = 'main-menu-developer-section';
  developer.setAttribute('aria-label', MAIN_MENU.developerSectionLabel);
  developer.setAttribute('data-testid', 'main-menu-developer-section');
  developer.hidden = true;
  const heading = element('h2', 'main-menu__section-title');
  heading.textContent = MAIN_MENU.developerSectionLabel;
  developer.append(heading);
  const developerButtons = MAIN_MENU.developer.map(entryButton);
  developer.append(...developerButtons);
  const back = element('button', 'main-menu__entry main-menu__entry--back');
  back.type = 'button';
  back.textContent = 'Back';
  back.setAttribute('data-testid', 'main-menu-back');
  developer.append(back);

  const showDeveloper = (open: boolean): void => {
    top.hidden = open;
    developer.hidden = !open;
    developerToggle.setAttribute('aria-expanded', String(open));
    (open ? developerButtons[0] : developerToggle)?.focus();
  };
  developerToggle.addEventListener('click', () => showDeveloper(true));
  back.addEventListener('click', () => showDeveloper(false));
  developer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      showDeveloper(false);
    }
  });

  root.append(title, top, developer);
  mount.append(root);
  top.querySelector('button')?.focus();
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function injectStyle(): void {
  const style = document.createElement('style');
  // Same palette and type as the existing developer panels (Debug Lab,
  // Self Test); provisional until the menu's visual approval.
  style.textContent = `
    .main-menu { pointer-events: auto; position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #05050a; font: 14px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #d8e0f0; }
    .main-menu__title { margin: 0 0 8px; font-size: 28px; letter-spacing: 0.2em; font-weight: 600; }
    .main-menu__list { display: flex; flex-direction: column; gap: 8px; min-width: 240px; }
    .main-menu__list[hidden] { display: none; }
    .main-menu__section-title { margin: 0 0 4px; font-size: 12px; font-weight: normal; color: #8a96b8; text-transform: uppercase; letter-spacing: 0.1em; text-align: center; }
    .main-menu__entry { font: inherit; color: #e6ecff; background: #1a2033; border: 1px solid #45507a; padding: 8px 16px; cursor: pointer; }
    .main-menu__entry:hover, .main-menu__entry:focus-visible { background: #26304d; outline: 1px solid #8a96b8; }
    .main-menu__entry--section { margin-top: 24px; font-size: 12px; color: #8a96b8; background: transparent; border-style: dashed; }
    .main-menu__entry--back { margin-top: 8px; font-size: 12px; background: transparent; }
  `;
  document.head.append(style);
}
