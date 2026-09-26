// ============================================================
// BEY VISUAL CONCEPTS — UI (picker, info card, view toolbar, keys)
// Plain DOM; everything is generated from CONCEPTS so adding/removing a
// concept only touches conceptDefinitions.ts.
//
// Keys: 1–9 select · T top · D diagonal · F free · S side · B below
//       R auto-rotate · K silhouette
// ============================================================

import type { ConceptMeasurements } from '../model/assembleConcept';
import type { ConceptArchetype, ConceptDefinition } from '../model/types';
import type { ViewMode } from '../viewer/ConceptViewer';

export interface ConceptLabUiHandlers {
  select(id: string): void;
  view(mode: ViewMode): void;
  toggleAutoRotate(): void;
  toggleSilhouette(): void;
}

const ARCHETYPE_ORDER: readonly ConceptArchetype[] = ['attack', 'defense', 'stamina'];

const VIEW_BUTTONS: ReadonlyArray<{ mode: ViewMode; label: string; key: string }> = [
  { mode: 'top', label: 'Top', key: 'T' },
  { mode: 'diagonal', label: 'Diagonal', key: 'D' },
  { mode: 'free', label: 'Free', key: 'F' },
  { mode: 'side', label: 'Side', key: 'S' },
  { mode: 'below', label: 'Below', key: 'B' },
];

export class ConceptLabUi {
  private readonly conceptButtons = new Map<string, HTMLButtonElement>();
  private readonly viewButtons = new Map<ViewMode, HTMLButtonElement>();
  private readonly rotateButton: HTMLButtonElement;
  private readonly silhouetteButton: HTMLButtonElement;

  constructor(
    private readonly concepts: readonly ConceptDefinition[],
    private readonly handlers: ConceptLabUiHandlers,
    private readonly picker: HTMLElement,
    private readonly info: HTMLElement,
    toolbar: HTMLElement,
  ) {
    this.buildPicker();

    const views = document.createElement('div');
    views.className = 'toolbar-group';
    for (const v of VIEW_BUTTONS) {
      const b = this.toolbarButton(`${v.label}`, v.key, () => handlers.view(v.mode));
      this.viewButtons.set(v.mode, b);
      views.append(b);
    }
    const toggles = document.createElement('div');
    toggles.className = 'toolbar-group';
    this.rotateButton = this.toolbarButton('Auto rotate', 'R', () => handlers.toggleAutoRotate());
    this.silhouetteButton = this.toolbarButton('Silhouette', 'K', () => handlers.toggleSilhouette());
    toggles.append(this.rotateButton, this.silhouetteButton);
    toolbar.append(views, toggles);

    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  showConcept(concept: ConceptDefinition, m: ConceptMeasurements): void {
    this.conceptButtons.forEach((b, id) => b.setAttribute('aria-pressed', String(id === concept.id)));
    document.documentElement.dataset.archetype = concept.archetype;
    const fmt = (n: number): string => n.toFixed(2);
    this.info.innerHTML = '';
    const kicker = el('div', 'info-kicker', `${concept.archetype.toUpperCase()} — CONCEPT ${concept.letter}`);
    const title = el('h2', 'info-title', concept.headline);
    const desc = el('p', 'info-desc', concept.description);
    const chips = el('ul', 'info-chips');
    concept.traits.forEach((t) => chips.append(el('li', '', t)));
    const dims = el('dl', 'info-dims');
    const tipShare = Math.round((m.tipLength / m.height) * 100);
    for (const [k, v] of [
      ['Ø', fmt(m.diameter)],
      ['Height', fmt(m.height)],
      ['Tip', `${fmt(m.tipLength)} (${tipShare}%)`],
      ['Under ring', fmt(m.underbodyLength)],
    ] as const) {
      dims.append(el('dt', '', k), el('dd', '', v));
    }
    this.info.append(kicker, title, desc, chips, dims);
  }

  setViewMode(mode: ViewMode): void {
    this.viewButtons.forEach((b, m) => b.setAttribute('aria-pressed', String(m === mode)));
  }

  setAutoRotate(on: boolean): void {
    this.rotateButton.setAttribute('aria-pressed', String(on));
  }

  setSilhouette(on: boolean): void {
    this.silhouetteButton.setAttribute('aria-pressed', String(on));
  }

  private buildPicker(): void {
    let index = 0;
    for (const archetype of ARCHETYPE_ORDER) {
      const section = el('section', `picker-group archetype-${archetype}`);
      section.append(el('h3', 'picker-heading', archetype.toUpperCase()));
      const row = el('div', 'picker-row');
      for (const concept of this.concepts.filter((c) => c.archetype === archetype)) {
        index += 1;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'concept-button';
        b.dataset.conceptId = concept.id;
        b.setAttribute('aria-pressed', 'false');
        b.title = `${archetype} ${concept.letter} — ${concept.headline} (key ${index})`;
        b.append(el('span', 'concept-letter', concept.letter), el('span', 'concept-key', String(index)));
        b.addEventListener('click', () => this.handlers.select(concept.id));
        this.conceptButtons.set(concept.id, b);
        row.append(b);
      }
      section.append(row);
      this.picker.append(section);
    }
  }

  private toolbarButton(label: string, key: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool-button';
    b.setAttribute('aria-pressed', 'false');
    b.append(el('span', 'tool-label', label), el('kbd', 'tool-key', key));
    b.addEventListener('click', onClick);
    return b;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const digit = Number.parseInt(e.key, 10);
    if (digit >= 1 && digit <= this.concepts.length) {
      this.handlers.select(this.concepts[digit - 1]!.id);
      return;
    }
    switch (e.key.toLowerCase()) {
      case 't': this.handlers.view('top'); break;
      case 'd': this.handlers.view('diagonal'); break;
      case 'f': this.handlers.view('free'); break;
      case 's': this.handlers.view('side'); break;
      case 'b': this.handlers.view('below'); break;
      case 'r': this.handlers.toggleAutoRotate(); break;
      case 'k': this.handlers.toggleSilhouette(); break;
      default: return;
    }
    e.preventDefault();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
