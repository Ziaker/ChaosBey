// Captures screenshots of all nine concepts from the production build.
//
//   npm run build
//   npm run preview -- --port 4173          (in another terminal)
//   node prototypes/bey-visual-concepts/scripts/capture.mjs <outDir> [views] [ids]
//
// views: comma list of top,diagonal,free,side,below,exploded,silhouette-top,silhouette-side
//        (default: diagonal,top). ids: optional comma list, e.g. attack-a,stamina-c.
// Set CHAOSBEY_PW_CHROMIUM_PATH to use a specific Chromium binary.
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [outDir = 'concept-captures', viewArg = 'diagonal,top', idArg] = process.argv.slice(2);
const views = viewArg.split(',');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHAOSBEY_PW_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:4173/ChaosBey/prototypes/bey-visual-concepts/');
await page.waitForFunction(() => window.__beyConceptLab);
await page.evaluate(() => window.__beyConceptLab.setAutoRotate(false));
const ids = idArg ? idArg.split(',') : await page.evaluate(() => window.__beyConceptLab.ids);

for (const id of ids) {
  await page.evaluate((conceptId) => window.__beyConceptLab.select(conceptId), id);
  for (const view of views) {
    const exploded = view === 'exploded';
    const [silhouette, mode] = view.startsWith('silhouette-') ? [true, view.slice('silhouette-'.length)] : [false, exploded ? 'diagonal' : view];
    await page.evaluate(([s, m, e]) => {
      window.__beyConceptLab.setSilhouette(s);
      window.__beyConceptLab.setExploded(e);
      window.__beyConceptLab.view(m);
    }, [silhouette, mode, exploded]);
    await page.waitForTimeout(150);
    await page.waitForFunction(() => window.__beyConceptLab.state().settled, null, { timeout: 60_000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${outDir}/${id}-${view}.png` });
  }
  console.log(`captured ${id}`);
}
console.log(problems.length ? `console problems:\n${problems.join('\n')}` : 'no console errors/warnings');
await browser.close();
