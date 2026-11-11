import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
await mkdir('.demo-build', { recursive: true });
await mkdir('docs/images', { recursive: true });
const result = await build({ entryPoints: ['scripts/demo.mjs'], bundle: true, format: 'esm', write: false, alias: { obsidian: resolve('scripts/demo-obsidian.mjs') } });
const shell = await readFile('scripts/demo.html', 'utf8');
const css = await readFile('styles.css', 'utf8');
await writeFile('.demo-build/demo.html', shell.replace('</html>', `<style>${css}</style><script type="module">${result.outputFiles[0].text}</script></html>`));
let executablePath = process.env.CHROME_PATH;
if (!executablePath && process.platform === 'darwin') {
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  try { await access(chrome); executablePath = chrome; } catch { /* Use Playwright's installed browser. */ }
}
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(resolve('.demo-build/demo.html')).href);
  await page.waitForFunction(() => window.demo?.ready);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.ps-project.is-selected .ps-project-name').textContent(), 'Brand refresh');
  assert.equal(await page.locator('.ps-tree-row').count(), 8);
  await page.screenshot({ path: 'docs/images/projects-dark.png' });
  await page.locator('.ps-project-select[title="Studio"]').click();
  assert.equal(await page.locator('.ps-tree-row.is-boundary .ps-file-name').textContent(), 'Brand refresh');
  assert.equal(await page.locator('.ps-tree-row').count(), 4);
  await page.evaluate(() => {
    document.body.classList.add('light');
    document.querySelector('#headline').textContent = 'Big picture. Smaller projects.';
    document.querySelector('#lede').textContent = 'Nested projects get their own space, with a shortcut in the parent tree.';
    document.querySelector('#tab').textContent = 'Studio index';
    document.querySelector('#note').innerHTML = '<div class="breadcrumb">Studio / Studio index</div><h2>A home for everything in motion.</h2><div class="tags"><span>#studio</span><span>#overview</span></div><p>The studio holds the whole picture. Each project keeps its own notes, research, and decisions together.</p><h3>Inside the studio</h3><div class="todo"><span class="check">↗</span>Brand refresh — a project of its own<br><span class="check">▸</span>Website — a regular folder in this project<br><span class="check">◇</span>Weekly planning — shared studio notes</div><div class="callout">Open Brand refresh from the tree to switch projects. Remove it from Projects to bring its files back into the Studio tree.</div>';
    document.querySelector('#caption').textContent = 'Nested project boundaries · Parent shortcuts · Light and dark themes';
  });
  await page.screenshot({ path: 'docs/images/nested-light.png' });
  await page.locator('.ps-tree-row.is-boundary').click();
  assert.equal(await page.locator('.ps-project.is-selected .ps-project-name').textContent(), 'Brand refresh');
  assert.equal(await page.locator('.ps-tree-row').count(), 8);
  await page.getByRole('searchbox', { name: 'Filter projects' }).fill('garden');
  assert.equal(await page.locator('.ps-project-select').count(), 2);
  assert.deepEqual(errors, []);
  console.log('Created two screenshots from fictional data; project switching, nested boundaries, expansion restoration, and filtering verified.');
} finally { await browser.close(); }
