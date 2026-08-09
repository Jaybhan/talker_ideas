/**
 * Drives the real UI in a real browser and screenshots both stages.
 *
 * The microphone can't be exercised headlessly, so this injects turns straight
 * into the transcript and triggers the suggestion request the same way the
 * recognition handler does. Everything downstream of that — SSE parsing,
 * streaming tile render, stage 2, speaking — is the real code path.
 *
 *   node test/ui-check.js            (needs the server running)
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = 'test/screenshots';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 860 } });

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

// Speech synthesis has no audio device in headless; stub it so say() completes.
await page.evaluate(() => {
  window.__spoken = [];
  speechSynthesis.speak = (u) => {
    window.__spoken.push(u.text);
    setTimeout(() => u.dispatchEvent(new Event('end')), 0);
  };
});

// Feed a turn exactly as the recognition handler does, which kicks off the
// real request → SSE → streaming-render path.
await page.evaluate(() =>
  window.talker.hear('Do you want to go out for a walk this afternoon?', 'Mom')
);
await page.waitForSelector('.tile:not(:disabled)', { timeout: 60000 });
await page.waitForTimeout(1200); // let the remaining tiles land

const stage1 = await page.$$eval('.tile .tile-label', (ns) => ns.map((n) => n.textContent));
await page.screenshot({ path: `${OUT}/1-intents.png` });

await page.click('.tile:not(:disabled)');
await page.waitForSelector('.tile-variant', { timeout: 10000 });
const stage2 = await page.$$eval('.tile-variant .variant-text', (ns) =>
  ns.map((n) => n.textContent)
);
await page.screenshot({ path: `${OUT}/2-tones.png` });

await page.click('.tile-variant');
await page.waitForTimeout(400);
const spoken = await page.evaluate(() => window.__spoken);
await page.screenshot({ path: `${OUT}/3-spoken.png` });

// A misheard line must be removable — otherwise it poisons every later turn.
const before = await page.evaluate(() => window.talker.state.turns.length);
await page.hover('.turn-them');
await page.click('.turn-them .turn-drop');
const after = await page.evaluate(() => window.talker.state.turns.length);
if (after !== before - 1) problems.push(`dropping a misheard turn did not update state (${before}→${after})`);

// "Steer it" must actually open — the feature is useless if unreachable.
await page.click('#open-nudge');
const nudgeOpen = await page.evaluate(() => document.getElementById('nudge-dialog').open);
if (!nudgeOpen) problems.push('#open-nudge did not open the steer dialog');
await page.evaluate(() => document.getElementById('nudge-dialog').close());

// Light theme render
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(400); // let colour transitions settle before capture
await page.screenshot({ path: `${OUT}/4-light.png` });

// Narrow / tablet layout, dark
await page.setViewportSize({ width: 430, height: 860 });
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/5-narrow.png` });

// Verify nothing is clipped out of reach at the top of the tile area
const clipped = await page.$eval('.tiles', (n) => n.scrollTop > 0 && n.scrollHeight > n.clientHeight
  ? 'tiles scrolled away from the first option'
  : '');
if (clipped) problems.push(clipped);

await browser.close();

console.log(`\n  stage 1 tiles (${stage1.length}): ${stage1.join(' · ')}`);
console.log(`  stage 2 tones (${stage2.length}): ${stage2.map((s) => `"${s}"`).join(' ')}`);
console.log(`  spoken:        ${spoken.map((s) => `"${s}"`).join(', ') || '(nothing)'}`);
console.log(`  screenshots:   ${OUT}/`);

const failures = [];
if (stage1.length < 4) failures.push(`only ${stage1.length} intent tiles rendered`);
if (stage2.length < 2) failures.push(`only ${stage2.length} tone tiles rendered`);
if (!spoken.length) failures.push('tapping a tone tile spoke nothing');
if (problems.length) failures.push(...problems);

if (failures.length) {
  console.log('\n  FAILURES:');
  for (const f of failures) console.log(`   ✖ ${f}`);
  process.exit(1);
}
console.log('\n  ✔ UI path works end to end\n');
