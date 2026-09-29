// ============================================================
// SETTINGS MODE (M10)
// `?mode=settings`, the Main Menu's SETTINGS entry: the Settings screen as
// a page of its own (plain DOM, no renderer). Changes are saved at once;
// the next match picks them up. Back / Esc return to the Main Menu.
// ============================================================

import { SettingsScreen } from '../frontend/SettingsScreen';
import { GamepadMenuKeys } from '../../input/devices/GamepadMenuKeys';
import { loadPlayerSettings, savePlayerSettings } from '../../config/settings/PlayerSettings';
import { appModeHref } from './appMode';

export interface SettingsModeOptions {
  readonly navigate?: (href: string) => void;
  readonly location?: { readonly pathname: string; readonly search: string };
}

export function startSettingsMode(mount: HTMLElement, options: SettingsModeOptions = {}): void {
  const location = options.location ?? window.location;
  const navigate = options.navigate ?? ((href: string) => window.location.assign(href));
  const pad = new GamepadMenuKeys();
  const screen = new SettingsScreen(mount, {
    settings: loadPlayerSettings(),
    onChange: savePlayerSettings,
    onBack: () => {
      pad.stop();
      screen.close();
      navigate(appModeHref('menu', location));
    },
  });
  pad.start();
}
