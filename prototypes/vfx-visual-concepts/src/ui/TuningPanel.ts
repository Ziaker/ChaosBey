// ============================================================
// VFX LAB — TUNING PANEL
// Sliders for every TUNING value, grouped. Changes apply live (next
// effect). The draft is kept in this browser (localStorage). "Save as
// final" writes the values to the artifact's shared store (`db`
// capability, document `config/final`) so Claude can read the owner's
// final configuration back and move it into the game. Outside the
// claude.ai viewer (local dev) the save button falls back to "copy".
// ============================================================

import { APPROVED, TUNING, TUNING_SPEC, applyTuning, resetTuning, type Tuning } from '../tuning';

const DRAFT_KEY = 'chaosbey.vfxlab.tuning.draft.v1';
const FINAL_DOC = 'config/final';

// Minimal shapes of the claude.ai runtime used here (see artifact capability docs).
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
    /* storage unavailable: draft just isn't remembered */
  }
};

export class TuningPanel {
  private readonly inputs = new Map<keyof Tuning, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement }>();
  private db: Db | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly status: HTMLElement,
    private readonly onChange: () => void,
  ) {
    const draft = readDraft();
    if (draft) applyTuning(draft);
    this.build();
    this.sync();
    void this.connectStore();
  }

  private build(): void {
    const groups = new Map<string, HTMLElement>();
    for (const spec of TUNING_SPEC) {
      let body = groups.get(spec.group);
      if (!body) {
        const details = document.createElement('details');
        details.className = 'tune-group';
        if (spec.group.startsWith('Wind')) details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = spec.group;
        body = document.createElement('div');
        body.className = 'tune-body';
        details.append(summary, body);
        this.root.append(details);
        groups.set(spec.group, body);
      }
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
      input.addEventListener('change', () => this.onChange());
      row.append(label, input, out);
      body.append(row);
      this.inputs.set(spec.key, { input, out, row });
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
    this.setStatus('Back to the approved values.');
    this.onChange();
  }

  async copy(): Promise<void> {
    const text = JSON.stringify(TUNING, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.setStatus('Values copied. Paste them in the chat if you want.');
    } catch {
      this.setStatus('Copy was blocked by the browser. Use "Save as final" instead.');
    }
  }

  async saveFinal(): Promise<void> {
    if (!this.db) {
      await this.copy();
      return;
    }
    this.setStatus('Saving…');
    try {
      await this.db.doc(FINAL_DOC).set({ values: { ...TUNING }, savedAt: new Date().toISOString(), version: 1 });
      this.setStatus(`Saved as final at ${new Date().toLocaleTimeString()}. Tell Claude it's done.`);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'error';
      this.setStatus(code === 'not_granted' || code === 'permission_denied'
        ? 'This view can\'t save. Open the page as its owner, or use "Copy values".'
        : `Couldn't save (${code}). Try again, or use "Copy values".`);
    }
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private async connectStore(): Promise<void> {
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (!claude?.use) {
      this.setStatus('Local mode: "Save as final" copies the values instead.');
      return;
    }
    const db = (await claude.use('db')) as Db | null;
    if (!db) {
      this.setStatus('Saving isn\'t available in this view. "Copy values" still works.');
      return;
    }
    this.db = db;
    try {
      const snap = await db.doc(FINAL_DOC).get();
      const saved = snap.exists ? (snap.data()?.values as Partial<Tuning> | undefined) : undefined;
      if (saved && !readDraft()) {
        applyTuning(saved);
        this.sync();
        this.onChange();
      }
      const at = snap.exists ? String(snap.data()?.savedAt ?? '') : '';
      this.setStatus(at ? `Final config saved ${new Date(at).toLocaleString()}.` : 'No final config saved yet.');
    } catch {
      this.setStatus('Couldn\'t read the saved config. Adjusting and saving still work.');
    }
  }
}
