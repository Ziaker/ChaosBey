import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { formatVersionLabel } from '../../src/app/bootstrap/versionBadge';

describe('version badge', () => {
  it('shows the version and the build commit', () => {
    expect(formatVersionLabel('0.11.0', '8d51f79')).toBe('v0.11.0 · 8d51f79');
    expect(formatVersionLabel('0.11.0', null)).toBe('v0.11.0');
  });

  it('the game version is set (not the 0.0.0 placeholder)', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as { version: string };
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).not.toBe('0.0.0');
  });
});
