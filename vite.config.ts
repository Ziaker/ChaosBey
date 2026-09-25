import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// ChaosBey is deployed to GitHub Pages under the repository subpath
// (https://<owner>.github.io/ChaosBey/), never the domain root. `base` must
// stay in sync with the repository name so built asset URLs resolve
// correctly, including the WASM binary loaded by @dimforge/rapier3d-compat.
const GITHUB_PAGES_BASE = '/ChaosBey/';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).version as string;

function readCommitHash(): string | null {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return null;
  }
}

export default defineConfig(({ command, isPreview }) => ({
  // `vite preview` resolves with command 'serve' but isPreview true — it must
  // use the GitHub Pages base too, since it serves the already-built dist
  // whose asset URLs were baked in under that base.
  base: command === 'build' || isPreview ? GITHUB_PAGES_BASE : '/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  // Rapier ships a WASM binary that must not be pre-bundled by esbuild.
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
  define: {
    // Telemetry/bug reports record build version + commit (GDD section 72/116).
    __APP_BUILD_VERSION__: JSON.stringify(packageVersion),
    __APP_COMMIT_HASH__: JSON.stringify(readCommitHash()),
  },
}));
