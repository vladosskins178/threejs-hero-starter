// Render the poster images (assets/poster.webp + assets/poster.png) from the
// real scene, so the fallback matches the first 3D frame exactly.
//
//   npm install --no-save playwright && npx playwright install chromium
//   node tools/make_poster.mjs [size]
//
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const size = Number(process.argv[2] ?? 960);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary' };

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

// CHROME_PATH points at an already installed Chromium; HEADED=1 runs a visible
// browser (use it under xvfb-run on servers where headless WebGL is off).
const browser = await chromium.launch({ headless: !process.env.HEADED, executablePath: process.env.CHROME_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  page.on('console', (m) => console.log('[page]', m.text()));
  // Reduced motion freezes the idle animation, so the poster shows the exact
  // pose of the first 3D frame.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${base}index.html`);
  const images = await page.evaluate(async (size) => {
    document.body.innerHTML = '';
    const box = document.createElement('div');
    box.dataset.model = 'assets/crystal.glb';
    box.style.cssText = `width:${size}px;height:${size}px`;
    document.body.appendChild(box);
    const { mountHero } = await import('./src/hero.js');
    const hero = await mountHero(box, { debug: false });
    if (!hero) throw new Error('3D did not start (no WebGL?)');
    while (box.dataset.state !== 'ready') await new Promise((r) => setTimeout(r, 50));
    hero.renderer.setPixelRatio(1);
    hero.renderer.setSize(size, size, false);
    hero.renderer.render(hero.scene, hero.camera);
    const canvas = hero.renderer.domElement;
    return { webp: canvas.toDataURL('image/webp', 0.86), png: canvas.toDataURL('image/png') };
  }, size);

  for (const [ext, url] of Object.entries(images)) {
    const file = join(root, 'assets', `poster.${ext}`);
    await writeFile(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
  server.close();
}
