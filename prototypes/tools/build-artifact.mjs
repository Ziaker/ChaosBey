// Packs one prototype page into a single self-contained HTML file that can
// be published as a claude.ai Artifact (viewable in any browser, no local
// setup). Three.js is NOT bundled: it loads from jsdelivr through an import
// map, pinned to the exact version in package.json.
//
//   node prototypes/tools/build-artifact.mjs <prototypeDir> <outFile>
//   e.g. node prototypes/tools/build-artifact.mjs prototypes/bey-visual-concepts dist-artifacts/bey-lab.html
//
// The artifact host wraps the file in its own <html>/<head>/<body>, so the
// output keeps only <title>, <style>, the body markup and the scripts.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';

const [pageDir, outFile] = process.argv.slice(2);
if (!pageDir || !outFile) {
  console.error('usage: node prototypes/tools/build-artifact.mjs <prototypeDir> <outFile>');
  process.exit(1);
}

const root = resolve(import.meta.dirname, '../..');
const threeVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')).dependencies.three;
const html = readFileSync(join(root, pageDir, 'index.html'), 'utf-8');
const entry = /<script type="module" src="([^"]+)"><\/script>/.exec(html)?.[1];
if (!entry) throw new Error(`no module entry script in ${pageDir}/index.html`);

const tmp = join(root, 'node_modules/.cache/artifact-build');
rmSync(tmp, { recursive: true, force: true });
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  build: {
    outDir: tmp,
    emptyOutDir: true,
    minify: true,
    target: 'es2022',
    lib: { entry: join(root, pageDir, entry), formats: ['es'], fileName: () => 'bundle.js' },
    rolldownOptions: { external: [/^three($|\/)/] },
  },
});
const bundle = readFileSync(join(tmp, 'bundle.js'), 'utf-8').replaceAll('</script', '<\\/script');

const pick = (re) => re.exec(html)?.[1] ?? '';
const title = pick(/<title>([\s\S]*?)<\/title>/);
const style = pick(/<style>([\s\S]*?)<\/style>/);
const body = pick(/<body>([\s\S]*?)<\/body>/).replace(/<script[\s\S]*?<\/script>/g, '').trim();
const cdn = `https://cdn.jsdelivr.net/npm/three@${threeVersion}`;

const out = `<title>${title}</title>
<style>${style}</style>
${body}
<script type="importmap">${JSON.stringify({ imports: { three: `${cdn}/build/three.module.js`, 'three/examples/jsm/': `${cdn}/examples/jsm/` } })}</script>
<script type="module">${bundle}</script>
`;
mkdirSync(dirname(resolve(root, outFile)), { recursive: true });
writeFileSync(resolve(root, outFile), out);
console.log(`wrote ${outFile} (${(out.length / 1024).toFixed(0)} kB, three@${threeVersion} from jsdelivr)`);
