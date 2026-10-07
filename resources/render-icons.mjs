// Renders the Bloomora logo SVGs into the PNG sizes Android and the web app need.
// Usage: node resources/render-icons.mjs  (needs Playwright's Chromium)
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const res = path.join(root, 'android-native/res');
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const jobs = [];
for (const [density, scale] of Object.entries(densities)) {
  jobs.push(['icon.svg', `mipmap-${density}/ic_launcher.png`, 48 * scale]);
  jobs.push(['icon-foreground.svg', `mipmap-${density}/ic_launcher_foreground.png`, 108 * scale]);
  jobs.push(['icon-monochrome.svg', `mipmap-${density}/ic_launcher_monochrome.png`, 108 * scale]);
  jobs.push(['notification.svg', `drawable-${density}/ic_stat_bloomora.png`, 24 * scale]);
}
const webJobs = [
  ['icon.svg', 'public/icon-192.png', 192],
  ['icon.svg', 'public/icon-512.png', 512],
  ['icon.svg', 'public/apple-touch-icon.png', 180],
];

const executablePath = process.env.CHROME_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
async function render(svgFile, outFile, size) {
  const svg = fs.readFileSync(path.join(root, 'resources', svgFile), 'utf8').replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await page.screenshot({ path: outFile, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
for (const [svg, out, size] of jobs) await render(svg, path.join(res, out), size);
for (const [svg, out, size] of webJobs) await render(svg, path.join(root, out), size);
fs.copyFileSync(path.join(root, 'resources/icon.svg'), path.join(root, 'public/favicon.svg'));
await browser.close();
console.log(`Rendered ${jobs.length + webJobs.length} icons.`);
