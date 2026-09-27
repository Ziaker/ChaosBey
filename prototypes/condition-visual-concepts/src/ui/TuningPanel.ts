// ============================================================
// STAMINA & STABILITY LAB — TUNING PANEL
// Sliders for every TUNING value, grouped (shared physics, A, B, C).
// Changes apply live. The draft is kept in this browser (localStorage).
// "Salvar como final" writes the values AND the chosen direction(s) to the
// artifact's shared store (`db` capability, document `config/final`) so
// Claude can read the owner's decision back and record it. Outside the
// claude.ai viewer (local dev) saving falls back to copying the JSON.
// Same pattern as the VFX Language Lab's panel.
// ============================================================

import { APPROVED, GROUP_TITLES, TUNING, TUNING_SPEC, applyTuning, resetTuning, type Tuning, type TuningGroup } from '../tuning';
import type { LanguageId } from '../languages/types';

const DRAFT_KEY = 'chaosbey.conditionlab.tuning.draft.v1';
const FINAL_DOC = 'config/final';

export interface SavedChoice {
  layers: Record<LanguageId, boolean>;
  mix: boolean;
}

// Minimal shapes of the claude.ai runtime used here (see the artifact capability docs).
interface DocSnap { exists: boolean; data(): Record<string, unknown> | undefined }
interface DocRef { get(): Promise<DocSnap>; set(data: Record<string, unknown>): Promise<void> }
interface Db { doc(path: string): DocRef }
interface ClaudeRuntime { use(name: string): Promise<unknown> }

const readDraft = (): Partial<Tuning> | null => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Tuning>) : null;
  } catch {
    return null;
  }
};
const writeDraft = (): void => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(TUNING));
  } catch {
    /* storage unavailable: the draft just isn't remembered */
  }
};

export class TuningPanel {
  private readonly inputs = new Map<keyof Tuning, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement }>();
  private readonly groups = new Map<TuningGroup, HTMLDetailsElement>();
  private db: Db | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly status: HTMLElement,
    private readonly getChoice: () => SavedChoice,
    private readonly onRestoreChoice: (choice: SavedChoice) => void,
  ) {
    const draft = readDraft();
    if (draft) applyTuning(draft);
    this.build();
    this.sync();
    void this.connectStore();
  }

  private build(): void {
    for (const spec of TUNING_SPEC) {
      let details = this.groups.get(spec.group);
      if (!details) {
        details = document.createElement('details');
        details.className = `tune-group group-${spec.group}`;
        details.dataset.group = spec.group;
        const summary = document.createElement('summary');
        summary.textContent = GROUP_TITLES[spec.group];
        const body = document.createElement('div');
        body.className = 'tune-body';
        details.append(summary, body);
        this.root.append(details);
        this.groups.set(spec.group, details);
      }
      const body = details.querySelector('.tune-body')!;
      const row = document.createElement('div');
      row.className = 'tune-row';
      const id = `tune-${spec.key}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = spec.label;
      const input = document.createElement('input');
      input.type = 'range';
      input.id = id;
      input.min = String(spec.min);
      input.max = String(spec.max);
      input.step = String(spec.step);
      const out = document.createElement('output');
      out.htmlFor = id;
      input.addEventListener('input', () => {
        TUNING[spec.key] = Number(input.value);
        this.paint(spec.key);
        writeDraft();
      });
      row.append(label, input, out);
      body.append(row);
      this.inputs.set(spec.key, { input, out, row });
    }
  }

  /** Open the groups for the shown direction(s); keep the shared physics group as the user left it. */
  focusGroups(layers: Record<LanguageId, boolean>): void {
    for (const id of ['A', 'B', 'C'] as const) {
      const d = this.groups.get(id);
      if (d) d.open = layers[id];
    }
  }

  private paint(key: keyof Tuning): void {
    const el = this.inputs.get(key);
    if (!el) return;
    const v = TUNING[key];
    el.out.textContent = Number.isInteger(v) ? String(v) : v.toFixed(2);
    el.row.classList.toggle('changed', Math.abs(v - APPROVED[key]) > 1e-6);
  }

  sync(): void {
    for (const [key, el] of this.inputs) {
      el.input.value = String(TUNING[key]);
      this.paint(key);
    }
  }

  reset(): void {
    resetTuning();
    writeDraft();
    this.sync();
    this.setStatus('De volta à configuração aprovada.');
  }

  private payload(): Record<string, unknown> {
    return { values: { ...TUNING }, choice: this.getChoice() };
  }

  async copy(): Promise<void> {
    const text = JSON.stringify(this.payload(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('Valores copiados. Cole no chat se quiser.');
    } catch {
      this.setStatus('O navegador bloqueou a cópia. Use "Salvar como final".');
    }
  }

  async saveFinal(): Promise<void> {
    if (!this.db) {
      await this.copy();
      return;
    }
    this.setStatus('Salvando…');
    try {
      await this.db.doc(FINAL_DOC).set({ ...this.payload(), savedAt: new Date().toISOString(), version: 1 });
      this.setStatus(`Salvo como final às ${new Date().toLocaleTimeString()}. Avise o Claude no chat.`);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'erro';
      this.setStatus(code === 'not_granted' || code === 'invalid_argument'
        ? 'Esta visualização não pode salvar. Abra como dono da página ou use "Copiar valores".'
        : `Não consegui salvar (${code}). Tente de novo ou use "Copiar valores".`);
    }
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private async connectStore(): Promise<void> {
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (!claude?.use) {
      this.setStatus('Modo local: "Salvar como final" copia os valores.');
      return;
    }
    const db = (await claude.use('db')) as Db | null;
    if (!db) {
      this.setStatus('Salvar não está disponível nesta visualização. "Copiar valores" funciona.');
      return;
    }
    this.db = db;
    try {
      const snap = await db.doc(FINAL_DOC).get();
      const data = snap.exists ? snap.data() : undefined;
      const saved = data?.values as Partial<Tuning> | undefined;
      if (saved && !readDraft()) {
        applyTuning(saved);
        this.sync();
        const choice = data?.choice as SavedChoice | undefined;
        if (choice?.layers) this.onRestoreChoice(choice);
      }
      const at = data ? String(data.savedAt ?? '') : '';
      this.setStatus(at ? `Configuração final salva em ${new Date(at).toLocaleString()}.` : 'Nenhuma configuração final salva ainda.');
    } catch {
      this.setStatus('Não consegui ler a configuração salva. Ajustar e salvar continuam funcionando.');
    }
  }
}
