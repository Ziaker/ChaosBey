// ============================================================
// ARCHITECTURAL GUARD: GAMEPLAY → CAMERA DEPENDENCY IS FORBIDDEN
// (owner requirement, 2026-10-01: "A CÂMERA NUNCA MOVE O BEY")
//
//   Camera is downstream presentation. It may observe gameplay; it may
//   never mutate or causally influence gameplay.
//
// The previous version of this test only rejected `import`s from
// src/camera/ and explicitly allowed the camera's yaw to reach input as a
// plain number through a callback. That left the camera in the causal
// chain of the Bey's movement while the test reported "protected". A
// number from the camera is still camera data. This guard therefore checks
// the DATA FLOW surface, not just imports:
//
//  1. Gameplay layers (input, movement/Bey, physics, combat, AI, drift,
//     dodge, arena, replay, rng, self-test, automation, simulation) must
//     not import anything from src/camera/ — and must not mention the
//     camera at all in code (comments stripped). No `cameraYaw` callbacks,
//     no `camera*` parameters, no camera types.
//  2. The camera may only import its own files plus two read-only pieces of
//     gameplay vocabulary (the ImpactEvent type and the AttackState enum).
//     It cannot import a Bey, a controller, the physics world or
//     MovementController, so it has nothing to mutate.
//  3. Camera OUTPUT (MatchSession.getLastCameraOutput / SessionCameraOutput)
//     may be read only by presentation/debug code: MatchSession's own
//     renderFrame() and the debug overlay/inspector. Not by MatchRunner,
//     not by DebugLabMode, not by any controller.
//  4. Inside MatchSession, the camera rig and its output are touched only
//     by the camera/render members, and the camera tick writes nothing but
//     `lastCameraOutput`.
//
// Debug/telemetry may READ the camera for display; they may never hand the
// value back to the simulation (rule 3's allowlist is exactly those files).
// The runtime proof that this holds is
// tests/deterministic/cameraGameplaySeparation.test.ts.
// ============================================================

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(REPO_ROOT, 'src');
const CAMERA_DIR = resolve(SRC, 'camera');

/** Everything that must stay causally upstream of the camera. */
const GAMEPLAY_DIRS = ['input', 'bey', 'physics', 'combat', 'ai', 'drift', 'dodge', 'arena', 'replay', 'rng', 'self-test', 'automation', 'app/simulation'].map((d) => resolve(SRC, d));

/** What src/camera/ may import from outside itself (read-only gameplay vocabulary). */
const CAMERA_ALLOWED_EXTERNAL_IMPORTS = [resolve(SRC, 'app/simulation/impact/ImpactEvents.ts'), resolve(SRC, 'combat/attacks/AttackController.ts')];

/** Files allowed to read the camera's OUTPUT, for presentation/display only. */
const CAMERA_OUTPUT_READERS = [
  resolve(SRC, 'app/session/MatchSession.ts'),
  resolve(SRC, 'debug/overlay/buildOverlayState.ts'),
  resolve(SRC, 'debug/inspectors/buildInspection.ts'),
];
const CAMERA_OUTPUT_IDENTIFIERS = new Set(['getLastCameraOutput', 'lastCameraOutput', 'SessionCameraOutput']);

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (extname(full) === '.ts') out.push(full);
  }
  return out;
}

// Parsed with rolldown's parser (TypeScript 7 ships no JS compiler API). The
// AST is ESTree-shaped; comments are not nodes, so they are ignored.
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

interface Source {
  readonly file: string;
  readonly text: string;
  readonly ast: AstNode;
}

function parse(file: string): Source {
  const text = readFileSync(file, 'utf8');
  return { file, text, ast: parseAst(text, { lang: 'ts' }) as unknown as AstNode };
}

function lineOf(source: Source, offset: number): number {
  return source.text.slice(0, offset).split('\n').length;
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string';
}

/** Depth-first walk; `visit` gets each node and its ancestor chain (root first). */
function walk(node: AstNode, visit: (node: AstNode, ancestors: readonly AstNode[]) => void, ancestors: readonly AstNode[] = []): void {
  visit(node, ancestors);
  const next = [...ancestors, node];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) walk(child, visit, next);
    } else if (isNode(value)) {
      walk(value, visit, next);
    }
  }
}

function nodesOf(source: Source): { node: AstNode; ancestors: readonly AstNode[] }[] {
  const out: { node: AstNode; ancestors: readonly AstNode[] }[] = [];
  walk(source.ast, (node, ancestors) => out.push({ node, ancestors }));
  return out;
}

function rel(file: string): string {
  return file.slice(REPO_ROOT.length + 1);
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // a package import
  const base = resolve(dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return `${base}.ts`;
}

function importSpecs(source: Source): string[] {
  const specs: string[] = [];
  for (const { node } of nodesOf(source)) {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
      const spec = node.source;
      if (isNode(spec) && typeof spec.value === 'string') specs.push(spec.value);
    }
  }
  return specs;
}

/** Every identifier name and string literal in code (comments are not nodes, so they are ignored). */
function codeWords(source: Source): { text: string; line: number }[] {
  const words: { text: string; line: number }[] = [];
  for (const { node } of nodesOf(source)) {
    if (node.type === 'Identifier' && typeof node.name === 'string') words.push({ text: node.name, line: lineOf(source, node.start) });
    else if (node.type === 'Literal' && typeof node.value === 'string') words.push({ text: node.value, line: lineOf(source, node.start) });
    else if (node.type === 'PrivateIdentifier' && typeof node.name === 'string') words.push({ text: node.name, line: lineOf(source, node.start) });
  }
  return words;
}

function insideDir(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir + sep);
}

describe('guard 1: gameplay layers never depend on the camera', () => {
  for (const dir of GAMEPLAY_DIRS) {
    const files = listTsFiles(dir);
    it(`${rel(dir)}: has files (the guard is not vacuous)`, () => {
      expect(files.length).toBeGreaterThan(0);
    });
    for (const file of files) {
      it(`${rel(file)}: no import from src/camera/ and no camera identifier in code`, () => {
        const source = parse(file);
        const cameraImports = importSpecs(source).filter((spec) => {
          const resolved = resolveImport(file, spec);
          return resolved !== null && insideDir(resolved, CAMERA_DIR);
        });
        expect(cameraImports, 'imports from src/camera/').toEqual([]);
        const mentions = codeWords(source).filter((w) => /camera/i.test(w.text));
        expect(mentions, 'camera identifiers/strings in gameplay code (a number from the camera is still camera data)').toEqual([]);
      });
    }
  }

  it('the player control chain has no camera-shaped seam: DirectionalSources / createPlayerControl expose no camera parameter', () => {
    for (const file of [resolve(SRC, 'input/directional/DirectionalController.ts'), resolve(SRC, 'input/directional/createPlayerControl.ts'), resolve(SRC, 'input/directional/ControlReference.ts')]) {
      expect(codeWords(parse(file)).filter((w) => /camera|yaw.*from|gesture/i.test(w.text) && !/^yawRad$|referenceYawRad/.test(w.text))).toEqual([]);
    }
  });
});

describe('guard 2: the camera can observe gameplay but has nothing to mutate', () => {
  const files = listTsFiles(CAMERA_DIR);
  it('src/camera/ has files', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${rel(file)}: imports only camera files or the two allowlisted read-only gameplay modules`, () => {
      const offenders = importSpecs(parse(file)).flatMap((spec) => {
        const resolved = resolveImport(file, spec);
        if (resolved === null) return spec === 'three' ? [] : [`package import "${spec}"`];
        if (insideDir(resolved, CAMERA_DIR)) return [];
        return CAMERA_ALLOWED_EXTERNAL_IMPORTS.includes(resolved) ? [] : [spec];
      });
      expect(offenders).toEqual([]);
    });
  }
});

describe('guard 3: camera OUTPUT is read only by presentation/debug code', () => {
  const allSrc = listTsFiles(SRC).filter((f) => !insideDir(f, CAMERA_DIR));
  for (const file of allSrc) {
    const readers = codeWords(parse(file)).filter((w) => CAMERA_OUTPUT_IDENTIFIERS.has(w.text));
    if (readers.length === 0) continue;
    it(`${rel(file)} reads camera output (${readers.length}×) and is on the presentation/debug allowlist`, () => {
      expect(CAMERA_OUTPUT_READERS, `${rel(file)} reads the camera's output but is not presentation/debug code`).toContain(file);
    });
  }
  it('MatchRunner (the real PLAY flow) and DebugLabMode never read camera output', () => {
    for (const file of [resolve(SRC, 'app/frontend/MatchRunner.ts'), resolve(SRC, 'debug/lab/DebugLabMode.ts')]) {
      expect(codeWords(parse(file)).filter((w) => CAMERA_OUTPUT_IDENTIFIERS.has(w.text))).toEqual([]);
    }
  });
  it('every allowlisted reader actually reads it (the allowlist is not stale)', () => {
    for (const file of CAMERA_OUTPUT_READERS) expect(codeWords(parse(file)).some((w) => CAMERA_OUTPUT_IDENTIFIERS.has(w.text)), rel(file)).toBe(true);
  });
});

describe('guard 4: inside MatchSession the camera rig/output are touched only by camera/render members', () => {
  const source = parse(resolve(SRC, 'app/session/MatchSession.ts'));
  const ALLOWED_MEMBERS = new Set(['constructor', 'setCameraPreset', 'getCameraPreset', 'getLastCameraOutput', 'tickCameraAndVfx', 'renderFrame']);
  const GUARDED = new Set(['cameraRig', 'lastCameraOutput', 'initialCameraPreset']);

  function memberName(node: AstNode): string | null {
    const key = node.key;
    return isNode(key) && typeof key.name === 'string' ? key.name : null;
  }

  function enclosingMember(ancestors: readonly AstNode[]): string {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const n = ancestors[i]!;
      if (n.type === 'MethodDefinition') return n.kind === 'constructor' ? 'constructor' : (memberName(n) ?? '<anonymous>');
      if (n.type === 'PropertyDefinition') return `property:${memberName(n)}`;
    }
    return '<module>';
  }

  it('cameraRig / lastCameraOutput appear only in the camera/render members (and their own field declarations)', () => {
    const offenders: string[] = [];
    for (const { node, ancestors } of nodesOf(source)) {
      if (node.type !== 'Identifier' || typeof node.name !== 'string' || !GUARDED.has(node.name)) continue;
      if (ancestors.some((a) => a.type === 'TSInterfaceDeclaration' || a.type === 'TSTypeAliasDeclaration')) continue; // the options type declares `cameraRig`; it reads nothing
      const member = enclosingMember(ancestors);
      if (!ALLOWED_MEMBERS.has(member) && member !== `property:${node.name}`) offenders.push(`${node.name} in ${member} (line ${lineOf(source, node.start)})`);
    }
    expect(offenders).toEqual([]);
  });

  it('tickCameraAndVfx: after the camera is consulted, the only thing assigned is `this.lastCameraOutput`', () => {
    const method = nodesOf(source).find(({ node }) => node.type === 'MethodDefinition' && memberName(node) === 'tickCameraAndVfx')?.node;
    expect(method, 'tickCameraAndVfx exists').toBeDefined();
    const fn = method!.value as AstNode;
    const statements = ((fn.body as AstNode).body as AstNode[]).slice();
    const guardIndex = statements.findIndex((st) => st.type === 'IfStatement' && source.text.slice(st.start, st.end).replace(/\s/g, '').startsWith('if(!this.cameraRig)'));
    expect(guardIndex, 'the `if (!this.cameraRig) return;` guard exists').toBeGreaterThan(-1);
    const assigned: string[] = [];
    for (const statement of statements.slice(guardIndex + 1)) {
      walk(statement, (node) => {
        if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
          const target = (node.left ?? node.argument) as AstNode;
          assigned.push(source.text.slice(target.start, target.end));
        }
      });
    }
    expect(assigned).toEqual(['this.lastCameraOutput']);
  });
});
