// ============================================================
// CAMERA LAB — PARAMETER PANEL
// One slider per CameraParams value for the ACTIVE preset (A, B or C):
// live value, documented range (tooltip + README), a ↺ button per slider
// to return that value to the preset's original, and whole-preset reset.
// Edits apply immediately (the director reads its params every tick).
//
// Saving is deliberately simple: edits are remembered in this browser
// (localStorage, per preset), and "Salvar configurações" also writes all
// three presets to the artifact's shared store (`db`, document
// `config/camera`) so Claude can read the owner's values back.
// ============================================================

import { PARAM_GROUPS, PARAM_SPEC, PRESETS, applyParams, type CameraParams, type PresetId } from '../director/CameraParams';

const DRAFT_KEY = 'chaosbey.cameralab.params.v1';
const SAVE_DOC = 'config/camera';

interface DocRef { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(data: Record<string, unknown>): Promise<void> }
interface Db { doc(path: string): DocRef }
interface ClaudeRuntime { use(name: string): Promise<unknown> }

const fmt = (v: number, step: number): string => (step >= 1 ? String(Math.round(v)) : step >= 0.1 ? v.toFixed(1) : step >= 0.01 ? v.toFixed(2) : v.toFixed(3));

export class ParamPanel {
  private active: PresetId = 'A';
  private readonly rows = new Map<keyof CameraParams, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement; spec: (typeof PARAM_SPEC)[number] }>();
  private db: Db | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly status: HTMLElement,
    private readonly live: Record<PresetId, CameraParams>,
    private readonly getActive: () => PresetId,
  ) {
    this.loadDraft();
    this.build();
    this.showPreset(getActive());
    void this.connectStore();
  }

  private build(): void {
    const bodies = new Map<string, HTMLElement>();
    PARAM_GROUPS.forEach((g, i) => {
      const d = document.createElement('details');
      d.className = 'tune-group';
      d.open = i < 3;
      const s = document.createElement('summary');
      s.textContent = g;
      const body = document.createElement('div');
      body.className = 'tune-body';
      d.append(s, body);
      this.root.append(d);
      bodies.set(g, body);
    });
    for (const spec of PARAM_SPEC) {
      const row = document.createElement('div');
      row.className = 'tune-row';
      row.title = `${spec.doc} Faixa: ${spec.min}–${spec.max}.`;
      const id = `param-${spec.key}`;
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
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'mini';
      reset.textContent = '↺';
      reset.title = 'Voltar este valor ao do preset';
      reset.setAttribute('aria-label', `Voltar ${spec.label} ao valor do preset`);
      input.addEventListener('input', () => {
        this.live[this.active][spec.key] = Number(input.value);
        this.paint(spec.key);
        this.saveDraft();
      });
      reset.addEventListener('click', () => {
        this.live[this.active][spec.key] = PRESETS[this.active][spec.key];
        this.sync();
        this.saveDraft();
      });
      const range = document.createElement('small');
      range.className = 'range';
      range.textContent = `${spec.min}–${spec.max}`;
      row.append(label, input, out, reset, range);
      bodies.get(spec.group)!.append(row);
      this.rows.set(spec.key, { input, out, row, spec });
    }
  }

  showPreset(id: PresetId): void {
    this.active = id;
    this.root.dataset.preset = id;
    this.sync();
  }

  private paint(key: keyof CameraParams): void {
    const r = this.rows.get(key);
    if (!r) return;
    const v = this.live[this.active][key];
    r.out.textContent = fmt(v, r.spec.step);
    r.row.classList.toggle('changed', Math.abs(v - PRESETS[this.active][key]) > 1e-9);
  }

  sync(): void {
    for (const [key, r] of this.rows) {
      r.input.value = String(this.live[this.active][key]);
      this.paint(key);
    }
  }

  resetPreset(): void {
    Object.assign(this.live[this.active], PRESETS[this.active]);
    this.sync();
    this.saveDraft();
    this.setStatus(`Preset ${this.active} de volta aos valores originais.`);
  }

  private payload(): Record<string, unknown> {
    return { active: this.getActive(), presets: { A: { ...this.live.A }, B: { ...this.live.B }, C: { ...this.live.C } } };
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.payload(), null, 2));
      this.setStatus('JSON dos três presets copiado.');
    } catch {
      this.setStatus('O navegador bloqueou a cópia. Use "Salvar configurações".');
    }
  }

  async save(): Promise<void> {
    this.saveDraft();
    if (!this.db) {
      this.setStatus('Salvo neste navegador. (Fora do claude.ai não há onde mais salvar; use "Copiar JSON".)');
      return;
    }
    try {
      await this.db.doc(SAVE_DOC).set({ ...this.payload(), savedAt: new Date().toISOString(), version: 1 });
      this.setStatus(`Salvo às ${new Date().toLocaleTimeString()}. Avise o Claude no chat.`);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'erro';
      this.setStatus(`Salvo neste navegador, mas não no artifact (${code}). "Copiar JSON" também funciona.`);
    }
  }

  private setStatus(t: string): void {
    this.status.textContent = t;
  }

  private saveDraft(): void {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(this.payload()));
    } catch {
      /* storage unavailable: edits live only in this tab */
    }
  }

  private loadDraft(): void {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { presets?: Partial<Record<PresetId, Record<string, unknown>>> };
      for (const id of ['A', 'B', 'C'] as const) if (data.presets?.[id]) applyParams(this.live[id], data.presets[id]!);
    } catch {
      /* ignore a broken draft */
    }
  }

  private async connectStore(): Promise<void> {
    const claude = (window as unknown as { claude?: ClaudeRuntime }).claude;
    if (!claude?.use) {
      this.setStatus('Modo local: as edições ficam neste navegador.');
      return;
    }
    const db = (await claude.use('db')) as Db | null;
    if (!db) {
      this.setStatus('Salvar no artifact não está disponível nesta visualização; as edições ficam neste navegador.');
      return;
    }
    this.db = db;
    this.setStatus('Pronto. "Salvar configurações" grava os três presets para o Claude ler.');
  }
}
