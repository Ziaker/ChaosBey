import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// Standing owner rule (CLAUDE.md §4): every change bumps the version and
// updates the README. This catches the version numbers drifting apart; that
// the number moved at all is checked in review (PR template).

const read = (path: string): string => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('version is kept in sync (CLAUDE.md §4)', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string };
  const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, { version?: string }> };

  it('package.json is a plain x.y.z version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('package-lock.json carries the same version (top level and root package)', () => {
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']!.version).toBe(pkg.version);
  });

  it('the README Version line and its example badge show it', () => {
    const readme = read('README.md');
    expect(readme).toContain(`**Version:** ${pkg.version} (\`package.json\`)`);
    expect(readme).toContain(`\`v${pkg.version} · `);
  });

  it('the README has a Latest changes entry for it', () => {
    expect(read('README.md')).toMatch(new RegExp(`## Latest changes[\\s\\S]*?\\*\\*${pkg.version.replace(/\./g, '\\.')} `));
  });
});
