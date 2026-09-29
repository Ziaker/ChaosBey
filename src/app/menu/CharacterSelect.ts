// ============================================================
// CHARACTER SELECT — M10 LANE A
// Player-facing selection for the three existing Bey definitions. The UI
// only chooses identity; gameplay values remain owned by BeyDefinition.
// Selection is carried in the URL so Back/refresh/direct links stay
// reproducible and GitHub Pages needs no extra routing infrastructure.
// ============================================================

import * as THREE from 'three';
import type { AppRenderer } from '../bootstrap/createRenderer';
import { ALL_BEY_ARCHETYPES } from '../../bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../bey/archetype/BeyDefinition';
import { appModeHref } from '../modes/appMode';

export interface CharacterSelectOption {
  readonly definition: BeyDefinition;
  readonly role: 'Attack' | 'Defense' | 'Stamina';
  readonly tagline: string;
  readonly description: string;
}

export const CHARACTER_SELECT_OPTIONS: readonly CharacterSelectOption[] = ALL_BEY_ARCHETYPES.map((definition) => {
  if (definition.id === 'attack-prototype') {
    return { definition, role: 'Attack', tagline: 'Pressure / speed / impact', description: 'Fast acceleration and stronger offensive reach. Lower defense makes bad trades dangerous.' };
  }
  if (definition.id === 'defense-prototype') {
    return { definition, role: 'Defense', tagline: 'Grip / mass / control', description: 'Heavy, stable and difficult to launch. Gives up speed and reach for arena control.' };
  }
  return { definition, role: 'Stamina', tagline: 'Endurance / balance / recovery', description: 'Balanced handling with the strongest stamina rating for longer, steadier rounds.' };
});

export function selectedBeyId(search: string): string {
  const requested = new URLSearchParams(search).get('playerBey');
  return CHARACTER_SELECT_OPTIONS.some((option) => option.definition.id === requested) ? requested! : CHARACTER_SELECT_OPTIONS[0]!.definition.id;
}

export function pregameHref(definitionId: string, current: { readonly pathname: string; readonly search: string }): string {
  const base = appModeHref('pregame', current);
  const [pathname, query = ''] = base.split('?');
  const params = new URLSearchParams(query);
  params.set('playerBey', definitionId);
  return `${pathname}?${params.toString()}`;
}

export interface CharacterSelectOptions {
  readonly navigate?: (href: string) => void;
  readonly location?: { readonly pathname: string; readonly search: string };
}

export function startCharacterSelectMode(appRenderer: AppRenderer, mount: HTMLElement, options: CharacterSelectOptions = {}): void {
  injectStyle();
  const location = options.location ?? window.location;
  const navigate = options.navigate ?? ((href: string) => window.location.assign(href));

  appRenderer.scene.background = new THREE.Color(0x05070d);
  appRenderer.camera.position.set(0, 1.25, 3.45);
  appRenderer.camera.lookAt(0, 0.08, 0);

  const hemisphere = new THREE.HemisphereLight(0xb9d9ff, 0x080b12, 2.2);
  const key = new THREE.DirectionalLight(0xffffff, 4.2);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0x4f8cff, 2.6);
  rim.position.set(-4, 2, -3);
  appRenderer.scene.add(hemisphere, key, rim);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.15, 0.08, 64),
    new THREE.MeshStandardMaterial({ color: 0x101522, metalness: 0.75, roughness: 0.34 }),
  );
  platform.position.y = -0.3;
  appRenderer.scene.add(platform);

  const previewRoot = new THREE.Group();
  previewRoot.position.y = 0.05;
  previewRoot.rotation.x = -0.08;
  appRenderer.scene.add(previewRoot);

  const visuals = new Map(
    CHARACTER_SELECT_OPTIONS.map((option) => {
      const visual = option.definition.appearance.createVisual();
      visual.group.scale.setScalar(1.75);
      return [option.definition.id, visual] as const;
    }),
  );

  const root = element('main', 'character-select');
  root.setAttribute('data-testid', 'character-select');
  root.tabIndex = -1;

  const eyebrow = element('div', 'character-select__eyebrow');
  eyebrow.textContent = 'PRE-MATCH // STEP 1';
  const heading = element('h1', 'character-select__title');
  heading.textContent = 'CHOOSE YOUR BEY';
  const sub = element('p', 'character-select__sub');
  sub.textContent = 'Three real gameplay definitions. Choose by role, ratings and handling identity.';

  const cards = element('div', 'character-select__cards');
  cards.setAttribute('role', 'group');
  cards.setAttribute('aria-label', 'Bey choices');
  const cardButtons: HTMLButtonElement[] = [];

  for (const [index, option] of CHARACTER_SELECT_OPTIONS.entries()) {
    const button = element('button', 'character-select__card');
    button.type = 'button';
    button.setAttribute('data-testid', `character-select-${option.role.toLowerCase()}`);
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="character-select__card-index">0${index + 1}</span><strong>${option.role}</strong><span>${option.tagline}</span>`;
    cardButtons.push(button);
    cards.append(button);
  }

  const details = element('section', 'character-select__details');
  details.setAttribute('aria-live', 'polite');
  const role = element('div', 'character-select__role');
  role.setAttribute('data-testid', 'character-select-role');
  const tagline = element('div', 'character-select__tagline');
  const description = element('p', 'character-select__description');
  const stats = element('div', 'character-select__stats');
  stats.setAttribute('data-testid', 'character-select-stats');
  details.append(role, tagline, description, stats);

  const actions = element('div', 'character-select__actions');
  const back = element('button', 'character-select__secondary');
  back.type = 'button';
  back.textContent = '← MAIN MENU';
  back.setAttribute('data-testid', 'character-select-back');
  const continueButton = element('button', 'character-select__continue');
  continueButton.type = 'button';
  continueButton.textContent = 'LOCK IN →';
  continueButton.setAttribute('data-testid', 'character-select-continue');
  actions.append(back, continueButton);

  root.append(eyebrow, heading, sub, cards, details, actions);
  mount.append(root);

  let selectedIndex = Math.max(0, CHARACTER_SELECT_OPTIONS.findIndex((option) => option.definition.id === selectedBeyId(location.search)));
  let selectedVisual = visuals.get(CHARACTER_SELECT_OPTIONS[selectedIndex]!.definition.id)!;

  const renderStats = (definition: BeyDefinition): void => {
    stats.replaceChildren(
      statRow('ATTACK', definition.ratings.attack),
      statRow('DEFENSE', definition.ratings.defense),
      statRow('STAMINA', definition.ratings.stamina),
    );
  };

  const select = (index: number, focus = false): void => {
    selectedIndex = (index + CHARACTER_SELECT_OPTIONS.length) % CHARACTER_SELECT_OPTIONS.length;
    const option = CHARACTER_SELECT_OPTIONS[selectedIndex]!;
    selectedVisual = visuals.get(option.definition.id)!;
    previewRoot.clear();
    previewRoot.add(selectedVisual.group);
    cardButtons.forEach((button, i) => {
      const active = i === selectedIndex;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    });
    role.textContent = option.role.toUpperCase();
    tagline.textContent = option.tagline;
    description.textContent = option.description;
    renderStats(option.definition);
    if (focus) cardButtons[selectedIndex]?.focus();
  };

  cardButtons.forEach((button, index) => button.addEventListener('click', () => select(index)));
  back.addEventListener('click', () => navigate(appModeHref('menu', location)));
  continueButton.addEventListener('click', () => navigate(pregameHref(CHARACTER_SELECT_OPTIONS[selectedIndex]!.definition.id, location)));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      select(selectedIndex - 1, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      select(selectedIndex + 1, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      navigate(appModeHref('menu', location));
    }
  });
  select(selectedIndex);
  cardButtons[selectedIndex]?.focus();

  let animationFrame = 0;
  let previous = performance.now();
  const animate = (now: number): void => {
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    selectedVisual.spinGroup.rotation.y += dt * 2.8;
    previewRoot.rotation.y += dt * 0.16;
    appRenderer.render();
    animationFrame = requestAnimationFrame(animate);
  };
  animationFrame = requestAnimationFrame(animate);

  window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationFrame);
    appRenderer.dispose();
  }, { once: true });
}

function statRow(label: string, value: number): HTMLElement {
  const row = element('div', 'character-select__stat');
  const name = element('span', 'character-select__stat-name');
  name.textContent = label;
  const meter = element('span', 'character-select__meter');
  const fill = element('span', 'character-select__meter-fill');
  fill.style.width = `${Math.max(0, Math.min(10, value)) * 10}%`;
  meter.append(fill);
  const number = element('strong', 'character-select__stat-value');
  number.textContent = `${value}/10`;
  row.append(name, meter, number);
  return row;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function injectStyle(): void {
  if (document.querySelector('#chaosbey-character-select-style')) return;
  const style = document.createElement('style');
  style.id = 'chaosbey-character-select-style';
  style.textContent = `
    .character-select { pointer-events: none; position: fixed; inset: 0; color: #edf3ff; font: 13px/1.45 ui-monospace, Menlo, Consolas, monospace; padding: clamp(24px, 4vw, 56px); box-sizing: border-box; display: grid; grid-template-columns: minmax(320px, 440px) 1fr; grid-template-rows: auto auto 1fr auto; column-gap: 36px; background: linear-gradient(90deg, rgba(5,7,13,.97) 0%, rgba(5,7,13,.9) 35%, rgba(5,7,13,.12) 62%, rgba(5,7,13,0) 100%); }
    .character-select > * { pointer-events: auto; grid-column: 1; }
    .character-select__eyebrow { color: #6f9cff; letter-spacing: .18em; font-size: 11px; font-weight: 700; }
    .character-select__title { margin: 7px 0 4px; font-size: clamp(28px, 4vw, 46px); line-height: 1; letter-spacing: .06em; }
    .character-select__sub { color: #98a7c1; margin: 4px 0 20px; max-width: 420px; }
    .character-select__cards { display: grid; gap: 8px; align-content: start; }
    .character-select__card { display: grid; grid-template-columns: 34px 86px 1fr; align-items: center; gap: 8px; text-align: left; font: inherit; color: #aab7cc; padding: 12px 14px; background: rgba(16,21,34,.86); border: 1px solid #303b55; cursor: pointer; transition: border-color .12s, background .12s, transform .12s; }
    .character-select__card strong { color: #eef4ff; font-size: 14px; text-transform: uppercase; letter-spacing: .08em; }
    .character-select__card-index { color: #53627f; font-size: 10px; }
    .character-select__card:hover, .character-select__card:focus-visible { outline: none; border-color: #7899e9; transform: translateX(2px); }
    .character-select__card.is-selected { border-color: #6f9cff; background: linear-gradient(90deg, rgba(51,78,137,.72), rgba(16,21,34,.92)); box-shadow: inset 3px 0 #8ab0ff; }
    .character-select__details { align-self: end; margin-top: 18px; padding: 16px; border-left: 2px solid #506fae; background: rgba(8,11,19,.72); }
    .character-select__role { font-size: 22px; font-weight: 800; letter-spacing: .1em; }
    .character-select__tagline { color: #9ebeff; margin-top: 2px; }
    .character-select__description { color: #aeb9cb; margin: 8px 0 14px; }
    .character-select__stats { display: grid; gap: 7px; }
    .character-select__stat { display: grid; grid-template-columns: 72px 1fr 46px; gap: 9px; align-items: center; }
    .character-select__stat-name { color: #7f8da6; font-size: 10px; letter-spacing: .08em; }
    .character-select__meter { height: 6px; background: #1c2536; overflow: hidden; }
    .character-select__meter-fill { display: block; height: 100%; background: linear-gradient(90deg, #547bd5, #98b8ff); }
    .character-select__stat-value { font-size: 11px; text-align: right; }
    .character-select__actions { display: flex; gap: 10px; margin-top: 18px; }
    .character-select__actions button { font: inherit; padding: 11px 16px; cursor: pointer; letter-spacing: .06em; }
    .character-select__secondary { color: #9caac0; border: 1px solid #35415a; background: rgba(10,14,24,.82); }
    .character-select__continue { color: #07101d; border: 1px solid #a9c5ff; background: #8eb2ff; font-weight: 800; flex: 1; }
    .character-select__actions button:hover, .character-select__actions button:focus-visible { outline: 2px solid #d5e2ff; outline-offset: 2px; }
    @media (max-width: 760px) { .character-select { grid-template-columns: 1fr; background: rgba(5,7,13,.86); overflow: auto; } .character-select__details { margin-top: 12px; } }
  `;
  document.head.append(style);
}
