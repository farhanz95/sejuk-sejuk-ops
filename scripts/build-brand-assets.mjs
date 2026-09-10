/**
 * Generates every brand asset from one source: public/logo.svg
 *
 *   public/favicon-16.png · favicon-32.png · favicon-48.png · favicon.ico
 *   public/apple-touch-icon.png   (180×180, what iOS uses for a home-screen icon)
 *   public/icon-192.png · icon-512.png   (PWA / Android, declared in site.webmanifest)
 *   public/og-image.png           (1200×630, the link preview card)
 *
 * Rendering goes through the Chrome already on the machine (puppeteer-core),
 * so the SVG is rasterised by a real browser engine — no extra image toolchain,
 * and the mask/rounded corners come out exactly as the SVG defines them.
 *
 * Run: npm run brand
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));   // …/scripts
const root = path.resolve(here, '..');                       // project root
const out = path.join(root, 'public');
mkdirSync(out, { recursive: true });

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
});

/**
 * Rasterise a logo SVG at an exact pixel size, transparent background.
 * `source` matters: the detailed logo.svg carries barbs and air-flow arcs that
 * vanish (or blur into noise) at 16–32px, so those sizes use logo-small.svg —
 * a single bold six-point star that survives the downscale.
 */
async function renderIcon(size, filename, source = 'logo.svg') {
  const page = await browser.newPage();
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const svg = readFileSync(path.join(out, source), 'utf8');
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:transparent">
       <div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>
     </body></html>`,
    { waitUntil: 'load' },
  );
  await page.screenshot({ path: path.join(out, filename), omitBackground: true, type: 'png' });
  await page.close();
  console.log(`  ${filename} (${size}×${size})`);
}

/** The big link-preview card. */
async function renderOgImage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(root, 'brand', 'og-image.html').replace(/\\/g, '/'), { waitUntil: 'load' });
  // give the browser a moment to lay out the gradients
  await new Promise((r) => setTimeout(r, 350));
  await page.screenshot({ path: path.join(out, 'og-image.png'), type: 'png' });
  await page.close();
  console.log('  og-image.png (1200×630)');
}

/**
 * A real .ico containing PNG payloads (supported since Vista). 16/32/48 are
 * embedded so Windows taskbar, browser tabs and bookmarks all get the right
 * variant instead of a downscaled 32px.
 */
function buildIco(pngs) {
  const entries = pngs.map(({ size, data }) => {
    // ICONDIRENTRY is 16 bytes: wPlanes sits at 4 and wBitCount at 6, so the
    // header must be the full 16 (a 6-byte buffer overflowed on write).
    const header = Buffer.alloc(16);
    header.writeUInt8(size >= 256 ? 0 : size, 0);
    header.writeUInt8(size >= 256 ? 0 : size, 1);
    header.writeUInt8(0, 2);          // palette
    header.writeUInt8(0, 3);          // reserved
    header.writeUInt16LE(1, 4);       // colour planes
    header.writeUInt16LE(32, 6);      // bits per pixel
    header.writeUInt32LE(data.length, 8);
    return { header, data };
  });

  const dir = Buffer.alloc(6 + entries.length * 16);
  dir.writeUInt16LE(0, 0);            // reserved
  dir.writeUInt16LE(1, 2);            // type: icon
  dir.writeUInt16LE(entries.length, 4);

  let offset = dir.length;
  const blobs = [];
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    e.header.copy(dir, at);
    dir.writeUInt32LE(offset, at + 12);
    offset += e.data.length;
    blobs.push(e.data);
  });
  return Buffer.concat([dir, ...blobs]);
}

console.log('brand assets → public/');
const iconSizes = [
  [16, 'favicon-16.png', 'logo-small.svg'],
  [32, 'favicon-32.png', 'logo-small.svg'],
  [48, 'favicon-48.png', 'logo-small.svg'],
  [180, 'apple-touch-icon.png', 'logo.svg'],
  [192, 'icon-192.png', 'logo.svg'],
  [512, 'icon-512.png', 'logo.svg'],
];
for (const [size, file, source] of iconSizes) await renderIcon(size, file, source);

const ico = buildIco(['favicon-16.png', 'favicon-32.png', 'favicon-48.png'].map((f) => ({
  size: Number(f.match(/\d+/)[0]),
  data: readFileSync(path.join(out, f)),
})));
writeFileSync(path.join(out, 'favicon.ico'), ico);
console.log(`  favicon.ico (${ico.length} bytes, 16+32+48 embedded)`);

await renderOgImage();
await browser.close();
console.log('done');
