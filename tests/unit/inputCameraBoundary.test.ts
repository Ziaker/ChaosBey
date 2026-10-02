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
//  2. The camera may only import its own files plus a deliberately tiny
//     set of read-only gameplay vocabulary/tuning modules. It cannot import
//     a Bey, controller, physics world or MovementController, so it has
//     nothing to mutate. Arena/ring-out tuning are allowed only because the
//     36 m presentation scale derives containment/anticipation from the
//     canonical arena constants instead of duplicating magic numbers.
//  3. Camera OUTPUT (MatchSession.getLastCameraOutput / SessionCameraOutput)
//     may be read only by presentation/debug code: MatchSession's own
//     renderFrame()/cameraSnapshot() and the debug overlay/inspector. Not by
//     MatchRunner, not by DebugLabMode, not by any controller.
//     ONE owner-approved exception: app/frontend/controlReferences.ts, which
//     implements the opt-in 'screen' control scheme (read once per gesture;
//     never the default). It is allowlisted by name and by this comment so
//     the exception is visible and cannot spread.
//  4. Inside MatchSession, the camera rig and its output are touched only
//     by camera/render/presentation-projection members, and the camera tick
//     writes nothing but `lastCameraOutput`. Type-only interface property
//     declarations describe dependency injection but are not runtime reads.
//
// Debug/telemetry may READ the camera for display; presentation may project
// it into read-only presentation state; neither may hand the value back to
// the simulation (rule 3's allowlist is exactly those files).
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

/**
 * What src/camera/ may import from outside itself. These modules expose
 * read-only vocabulary/constants only; none gives the camera a gameplay
 * object it could mutate.
 */
const CAMERA_ALLOWED_EXTERNAL_IMPORTS = [
  resolve(SRC, 'app/simulation/impact/ImpactEvents.ts'),
  resolve(SRC, 'combat/attacks/AttackController.ts'),
  resolve(SRC, 'arena/colliders/ArenaTuning.ts'),
  resolve(SRC, 'arena/ringout/RingOutTuning.ts'),
];

/** Files allowed to read the camera's OUTPUT, for presentation/display only. */
const CAMERA_OUTPUT_READERS = [
  resolve(SRC, 'app/session/MatchSession.ts'),
  resolve(SRC, 'debug/overlay/buildOverlayState.ts'),
  resolve(SRC, 'debug/inspectors/buildInspection.ts'),
  resolve(SRC, 'app/frontend/controlReferences.ts'), // OPT-IN 'screen' scheme only — explicit owner exception, 2026-10-01
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
      expect(codeWords(parse(file)).filter((w) => /camera/i.test(w.text))).toEqual([]);
    }
  });
});

describe('guard 2: the camera can observe gameplay but has nothing to mutate', () => {
  const files = listTsFiles(CAMERA_DIR);
  it('src/camera/ has files', () => {
    expect(files.length).toBeGreaterThan(0);
  });
  for (const file of files) {
    it(`${rel(file)}: imports only camera files or explicitly allowlisted read-only gameplay modules`, () => {
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
  it('the camera-reading exception is confined to the "screen" scheme: the other three schemes in controlReferences.ts never touch the camera', () => {
    const text = readFileSync(resolve(SRC, 'app/frontend/controlReferences.ts'), 'utf8');
    const lines = text.split('\n');
    const readAt = lines.map((l, i) => (/getLastCameraOutput/.test(l) ? i : -1)).filter((i) => i >= 0);
    expect(readAt.length).toBe(1);
    const screenCase = lines.findIndex((l) => /case 'screen':/.test(l));
    expect(screenCase).toBeGreaterThan(-1);
    expect(readAt[0]).toBeGreaterThan(screenCase);
    expect(lines.slice(screenCase + 1).some((l) => /^\s*case '/.test(l)), "'screen' must be the last case, so nothing else falls under it").toBe(false);
  });
  it('every allowlisted reader actually reads it (the allowlist is not stale)', () => {
    for (const file of CAMERA_OUTPUT_READERS) expect(codeWords(parse(file)).some((w) => CAMERA_OUTPUT_IDENTIFIERS.has(w.text)), rel(file)).toBe(true);
  });
});

describe('guard 4: inside MatchSession the camera rig/output are touched only by camera/render/presentation-projection members', () => {
  const source = parse(resolve(SRC, 'app/session/MatchSession.ts'));
  const ALLOWED_MEMBERS = new Set(['constructor', 'setCameraPreset', 'getCameraPreset', 'getLastCameraOutput', 'tickCameraAndVfx', 'renderFrame', 'cameraSnapshot']);
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

  /** A property signature inside an interface/type is declaration-only: it cannot read or mutate runtime state. */
  function isTypeOnlyProperty(ancestors: readonly AstNode[]): boolean {
    return ancestors.some((n) => n.type === 'TSPropertySignature');
  }

  it('cameraRig / lastCameraOutput appear only in the camera/render/presentation-projection members (plus type-only injection declarations and their own fields)', () => {
    const offenders: string[] = [];
    for (const { node, ancestors } of nodesOf(source)) {
      if (node.type !== 'Identifier' || typeof node.name !== 'string' || !GUARDED.has(node.name)) continue;
      if (isTypeOnlyProperty(ancestors)) continue;
      const member = enclosingMember(ancestors);
      if (member === `property:${node.name}` || ALLOWED_MEMBERS.has(member)) continue;
      offenders.push(`${node.name}@${lineOf(source, node.start)} in ${member}`);
    }
    expect(offenders).toEqual([]);
  });

  it('tickCameraAndVfx: after the camera is consulted, the only thing assigned is `this.lastCameraOutput`', () => {
    const members = nodesOf(source).filter(({ node }) => node.type === 'MethodDefinition' && memberName(node) === 'tickCameraAndVfx');
    expect(members).toHaveLength(1);
    const method = members[0]!.node;
    const assignments: string[] = [];
    walk(method, (node) => {
      if (node.type !== 'AssignmentExpression') return;
      const left = node.left;
      if (!isNode(left)) return;
      const text = source.text.slice(left.start, left.end);
      if (/this\./.test(text)) assignments.push(`${text}@${lineOf(source, left.start)}`);
    });
    const cameraAssignment = assignments.findIndex((a) => a.startsWith('this.lastCameraOutput@'));
    expect(cameraAssignment).toBeGreaterThan(-1);
    // There may be presentation assignments before the camera tick (ringOutIsFirst etc.);
    // after lastCameraOutput is written, no gameplay-owned state may be assigned.
    expect(assignments.slice(cameraAssignment + 1)).toEqual([]);
  });
});
