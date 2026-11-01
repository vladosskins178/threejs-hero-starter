// Browser smoke test: the page must load without script errors and the hero
// must end in a valid state ("ready" with WebGL, "fallback" without).
//   npm install --no-save playwright && npx playwright install chromium
//   node test/smoke.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const file = path.endsWith('/') ? join(path, 'index.html') : path;
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const scenarios = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  { name: 'reduced motion', viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' },
];

const browser = await chromium.launch({
  headless: !process.env.HEADED,
  executablePath: process.env.CHROME_PATH || undefined,
  // Software WebGL, so the 3D path is exercised on machines without a GPU.
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = false;
try {
  for (const s of scenarios) {
    const page = await browser.newPage(s);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => ['error', 'warning'].includes(m.type()) && errors.push(`console ${m.type()}: ${m.text()}`));
    page.on('requestfailed', (r) => errors.push(`request failed: ${r.url()}`));
    page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(base);
    await page.waitForFunction(
      () => ['ready', 'fallback'].includes(document.querySelector('.hero-3d')?.dataset.state),
      null,
      { timeout: 30000 },
    );
    const state = await page.$eval('.hero-3d', (el) => `${el.dataset.state}/${el.dataset.tier}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (overflow) errors.push('horizontal overflow');
    console.log(`${errors.length ? 'FAIL' : 'ok  '} ${s.name}: hero ${state}`);
    for (const e of errors) console.log(`     ${e}`);
    failed ||= errors.length > 0;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
