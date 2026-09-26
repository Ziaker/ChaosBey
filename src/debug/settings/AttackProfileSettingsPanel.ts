// ============================================================
// ATTACK PROFILE SETTINGS PANEL (MILESTONE 6, DebugLab-style/dev tuning overlay)
// Owner requirement (PR #8 review, [OWNER REQUIRED — RESOLVED] /
// [CHATGPT REVIEW]): the per-archetype BeyAttackProfile values (hitbox
// reach / Dash speed) must be editable from the game's settings rather
// than locked in implementation code.
//
// This is deliberately a DebugLab-style/dev tuning overlay, in the spirit
// of GameState.DebugLab (GDD section 9, already reserves that state for
// exactly this kind of dev-facing tool with no screen built yet) — but it
// is NOT wired to that GameState: it mounts unconditionally at bootstrap
// (F4 to toggle) and doesn't participate in any state transition. It is
// also NOT the real Milestone 10 PregameSetup screen MatchConfig.ts's own
// comment defers real pre-match UI to, and NOT a final visual design (no
// material/color/layout decision here; GDD section 96/97's visual
// approval gate is still pending). Bare functional DOM controls only,
// styled like the existing DebugOverlay.
//
// Edits persist to localStorage (AttackProfileStorage.ts) and take effect
// the same way MatchConfig's pre-match override does: resolved once at the
// next match/Bey creation, not hot-swapped into a live AttackController —
// so "Apply" and "Reset to defaults" both reload the page.
// ============================================================

import type { BeyAttackProfile } from '../../bey/archetype/BeyAttackProfile';
import {
  resolveAttackProfileSettings,
  type AttackProfileArchetypeKey,
  type AttackProfileSettingsOverrides,
  type BeyAttackProfileSettings,
} from '../../config/attack-profile/AttackProfileSettings';
import { clearAttackProfileOverrides, loadAttackProfileOverrides, saveAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';

const ARCHETYPE_KEYS: readonly AttackProfileArchetypeKey[] = ['attack', 'defense', 'stamina'];
const ARCHETYPE_LABELS: Record<AttackProfileArchetypeKey, string> = { attack: 'Attack', defense: 'Defense', stamina: 'Stamina' };

const FIELD_KEYS: readonly (keyof BeyAttackProfile)[] = ['circularHitboxRadiusM', 'dashHitboxRadiusM', 'dashMinSpeedMps', 'dashMaxSpeedMps'];
const FIELD_LABELS: Record<keyof BeyAttackProfile, string> = {
  circularHitboxRadiusM: 'Circular hitbox radius (m)',
  dashHitboxRadiusM: 'Dash hitbox radius (m)',
  dashMinSpeedMps: 'Dash min speed (m/s)',
  dashMaxSpeedMps: 'Dash max speed (m/s)',
};

/** Reloading is how a resolved pre-match config (this panel included — see MatchConfig.ts's own precedent) takes effect; isolated so tests can stub it instead of reloading a real page. */
export interface AttackProfileSettingsPanelHost {
  reload(): void;
}

export class AttackProfileSettingsPanel {
  private readonly root: HTMLElement;
  private readonly host: AttackProfileSettingsPanelHost;
  private visible = false;
  private overrides: AttackProfileSettingsOverrides;

  constructor(mountPoint: HTMLElement, host: AttackProfileSettingsPanelHost = { reload: () => window.location.reload() }) {
    this.host = host;
    this.overrides = { ...(loadAttackProfileOverrides() ?? {}) };
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed',
      'top:0',
      'right:0',
      'margin:0',
      'padding:8px 12px',
      'font:12px/1.5 ui-monospace, "SF Mono", Consolas, monospace',
      'color:#8fffb0',
      'background:rgba(0,0,0,0.75)',
      'max-height:100vh',
      'overflow:auto',
    ].join(';');
    mountPoint.appendChild(this.root);
    this.render();
    this.applyVisibility();
  }

  toggle(): void {
    this.visible = !this.visible;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  private currentSettings(): BeyAttackProfileSettings {
    return resolveAttackProfileSettings(this.overrides);
  }

  private render(): void {
    this.root.innerHTML = '';
    const settings = this.currentSettings();

    const title = document.createElement('div');
    title.textContent = 'Attack Profile Settings (F4 to toggle) — dev tool, not final UI. Applies on next match (reload).';
    title.style.cssText = 'margin-bottom:6px;font-weight:bold';
    this.root.appendChild(title);

    for (const archetypeKey of ARCHETYPE_KEYS) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:6px';
      const heading = document.createElement('div');
      heading.textContent = ARCHETYPE_LABELS[archetypeKey];
      heading.style.cssText = 'text-decoration:underline';
      section.appendChild(heading);

      for (const fieldKey of FIELD_KEYS) {
        const row = document.createElement('label');
        row.style.cssText = 'display:block';
        row.textContent = `${FIELD_LABELS[fieldKey]}: `;
        const input = document.createElement('input');
        input.type = 'number';
        input.step = '0.01';
        input.value = String(settings[archetypeKey][fieldKey]);
        input.addEventListener('change', () => this.handleFieldChange(archetypeKey, fieldKey, input.value));
        row.appendChild(input);
        section.appendChild(row);
      }
      this.root.appendChild(section);
    }

    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset to defaults';
    resetButton.addEventListener('click', () => this.handleReset());
    this.root.appendChild(resetButton);
  }

  private handleFieldChange(archetypeKey: AttackProfileArchetypeKey, fieldKey: keyof BeyAttackProfile, rawValue: string): void {
    const parsed = Number(rawValue);
    const nextArchetypeOverride = { ...this.overrides[archetypeKey], [fieldKey]: parsed };
    this.overrides = { ...this.overrides, [archetypeKey]: nextArchetypeOverride };
    saveAttackProfileOverrides(this.overrides);
    this.host.reload();
  }

  private handleReset(): void {
    clearAttackProfileOverrides();
    this.overrides = {};
    this.host.reload();
  }
}
