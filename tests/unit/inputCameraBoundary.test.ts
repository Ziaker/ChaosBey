// ============================================================
// ARCHITECTURAL BOUNDARY: src/input/ AND THE MOVEMENT CONTROLLER MUST
// NEVER IMPORT FROM src/camera/ (owner decision 2026-09-30, "Fix 6",
// narrowed 2026-10-01 by "Fix 7" — see below)
//
// "Fix 6" made DirectionalController entirely camera-free, including
// diagnostics. "Fix 7" (screenDirection.ts's header) reinstated
// camera-relative mapping as the player default, which needs the camera's
// current yaw on purpose, every tick. What stays true, and what this test
// still enforces: that dependency arrives ONLY as a plain number
// (radians), handed in by a caller-supplied function
// (DirectionalSources.cameraYaw) — never a Camera/CameraRig TYPE, never a
// src/camera/ MODULE import. MatchRunner.ts and DebugLabMode.ts are the
// callers that read MatchSession.getLastCameraOutput().yawDeg and convert
// it to radians; src/input/ itself never imports anything from
// src/camera/ to do that conversion or anything else.
//
// This test reads the actual source files (not a bundler graph) and fails
// if anything under src/input/ or src/bey/movement/ resolves an import to
// a module inside src/camera/. The debug overlay/inspector may also show
// the camera's yaw — they read it from MatchSession.getLastCameraOutput()
// directly, entirely outside this boundary too.
// ============================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CAMERA_DIR = resolve(REPO_ROOT, 'src/camera');
const GUARDED_DIRS = [resolve(REPO_ROOT, 'src/input'), resolve(REPO_ROOT, 'src/bey/movement')];

const IMPORT_PATH_RE = /(?:import|export)(?:[^'"]*?from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...listTsFiles(full));
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

/** Resolves a relative import spec (no extension in source) to a real file under the repo, or null for a package import. */
function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // a package import (e.g. 'three'), never inside src/camera/
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return `${base}.ts`; // best-effort guess if none of the above exist on disk (still resolvable for a path-prefix check)
}

function findCameraImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const offenders: string[] = [];
  for (const match of text.matchAll(IMPORT_PATH_RE)) {
    const spec = match[1] ?? match[2];
    if (!spec) continue;
    const resolved = resolveImport(file, spec);
    if (resolved && (resolved === CAMERA_DIR || resolved.startsWith(CAMERA_DIR + sep))) {
      offenders.push(spec);
    }
  }
  return offenders;
}

describe('architectural boundary: input/movement never import the camera', () => {
  for (const dir of GUARDED_DIRS) {
    const files = listTsFiles(dir);
    it(`${dir.slice(REPO_ROOT.length + 1)}: has files to check (the guard isn't vacuous)`, () => {
      expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
      const relative = file.slice(REPO_ROOT.length + 1);
      it(`${relative} imports nothing from src/camera/`, () => {
        expect(findCameraImports(file)).toEqual([]);
      });
    }
  }
});
