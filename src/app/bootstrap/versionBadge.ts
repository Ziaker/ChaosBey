// ============================================================
// VERSION BADGE
// The game's version and the commit it was built from, in a small corner
// label on every screen (owner request), so a playtest can always tell
// which build the browser is actually running (GitHub Pages caches the
// page for a few minutes).
// ============================================================

/** e.g. "v0.11.0 · 8d51f79" (the hash is null when the build had no git checkout). */
export function formatVersionLabel(version: string, commitHash: string | null): string {
  return commitHash ? `v${version} · ${commitHash}` : `v${version}`;
}

export function showVersionBadge(): void {
  if (document.querySelector('[data-testid="app-version"]')) return;
  const badge = document.createElement('div');
  badge.dataset['testid'] = 'app-version';
  badge.textContent = formatVersionLabel(__APP_BUILD_VERSION__, __APP_COMMIT_HASH__);
  badge.title = 'ChaosBey version · build commit';
  Object.assign(badge.style, {
    position: 'fixed',
    right: '8px',
    bottom: '6px',
    zIndex: '2000',
    pointerEvents: 'none',
    font: '11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: 'rgba(230, 236, 245, 0.55)',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.append(badge);
}
