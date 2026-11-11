import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const mockPath = resolve('tests/obsidian-mock.cjs');
const { TFolder, TFile } = require(mockPath);
let ProjectsPlugin: any;
const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
before(async () => {
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, ResizeObserver: class { observe() {} disconnect() {} } });
  const proto = dom.window.HTMLElement.prototype as any;
  proto.empty = function () { this.replaceChildren(); };
  proto.addClass = function (name: string) { this.classList.add(name); };
  proto.setText = function (text: string) { this.textContent = text; };
  Object.defineProperty(proto, 'win', { get() { return dom.window; } });
  proto.createEl = function (tag: string, options: any = {}) {
    const el = document.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text) el.textContent = options.text;
    for (const key of ['type', 'value', 'placeholder']) if (options[key]) el.setAttribute(key, options[key]);
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
    this.append(el); return el;
  };
  proto.createDiv = function (options: any) { return this.createEl('div', options); };
  proto.createSpan = function (options: any) { return this.createEl('span', options); };
  await build({ entryPoints: ['src/main.ts'], outfile: '.test-build/main.cjs', bundle: true, format: 'cjs', platform: 'node', plugins: [{ name: 'mock-obsidian', setup(build) { build.onResolve({ filter: /^obsidian$/ }, () => ({ path: mockPath, external: true })); } }] });
  ProjectsPlugin = require('../.test-build/main.cjs').default;
});
after(() => dom.window.close());
function emitter() {
  const callbacks = new Map<string, Function[]>();
  return { callbacks, on(name: string, fn: Function) { callbacks.set(name, [...callbacks.get(name) ?? [], fn]); return { name, fn }; }, trigger(name: string, ...args: any[]) { callbacks.get(name)?.forEach(fn => fn(...args)); } };
}
async function fixture(extraFiles = 0) {
  const root = new TFolder('');
  const folders = [new TFolder('Courses'), new TFolder('Courses/COS330'), new TFolder('Courses/COS330/psets'), new TFolder('Empty')];
  const files = [new TFile('Courses/overview.md'), new TFile('Courses/COS330/note.md'), new TFile('Courses/COS330/psets/a.md')];
  for (let i = 0; i < extraFiles; i++) files.push(new TFile(`Courses/file-${i}.md`));
  const nodes = new Map([root, ...folders, ...files].map(f => [f.path, f]));
  for (const file of [...folders, ...files]) { file.parent = nodes.get(file.path.split('/').slice(0, -1).join('/')); file.parent.children.push(file); }
  const leaves: any[] = [];
  const app: any = {
    saved: { projects: [
      { id: 'courses', name: 'Courses', path: 'Courses', pinned: false },
      { id: 'cos', name: 'COS330', path: 'Courses/COS330', pinned: true },
      { id: 'empty', name: 'Empty', path: 'Empty', pinned: false },
    ], selectedId: 'courses' },
    factories: {}, active: null, opened: [],
    vault: { ...emitter(), getRoot: () => root, getName: () => 'Test vault', getAbstractFileByPath: (path: string) => nodes.get(path), getAllLoadedFiles: () => [...nodes.values()] },
    workspace: { ...emitter(), onLayoutReady() {}, getLeavesOfType: () => leaves, getActiveFile: () => app.active, async revealLeaf() {}, getLeftLeaf() {
      const leaf: any = { app, async setViewState(state: any) { leaf.view = app.factories[state.type](leaf); leaves.push(leaf); await leaf.view.onOpen(); } }; return leaf;
    }, getLeaf: (mode: any) => ({ async openFile(file: any) { app.active = file; app.opened.push({ path: file.path, mode }); app.workspace.trigger('file-open', file); } }) },
  };
  const plugin = new ProjectsPlugin(app);
  await plugin.onload();
  const view = await plugin.openView();
  return { app, plugin, view, nodes, async close() { await view.onClose(); plugin.onunload(); await plugin.flush(); } };
}
test('project selection, filtering, pin ordering, and nested-project navigation work through DOM events', async () => {
  const f = await fixture();
  try {
    const content = f.view.contentEl as HTMLElement;
    assert.equal(content.querySelectorAll('.ps-tree-row').length, 2);
    assert.equal(content.querySelector('.ps-tree-row.is-boundary .ps-file-name')?.textContent, 'COS330');
    (content.querySelector('.ps-tree-row.is-boundary') as HTMLElement).click();
    assert.equal(f.plugin.settings.selectedId, 'cos');
    assert.match(content.querySelector('.ps-tree-heading')!.textContent!, /COS330/);
    const input = content.querySelector('input')!;
    input.value = 'overview-missing'; input.dispatchEvent(new dom.window.Event('input'));
    assert.match(content.querySelector('.ps-projects')!.textContent!, /No matching projects/);
    assert.equal(f.plugin.settings.selectedId, 'cos');
    input.value = 'courses cos'; input.dispatchEvent(new dom.window.Event('input'));
    assert.equal(content.querySelectorAll('.ps-project-select').length, 2);
    const note = Array.from(content.querySelectorAll<HTMLElement>('.ps-tree-row')).find(el => el.textContent?.includes('note.md'))!;
    note.dispatchEvent(new dom.window.MouseEvent('click', { ctrlKey: true }));
    assert.deepEqual(f.app.opened, [{ path: 'Courses/COS330/note.md', mode: 'tab' }]);
  } finally { await f.close(); }
});
test('reveal selects the owning project, expands ancestors, and restores expansion after switching', async () => {
  const f = await fixture();
  try {
    f.app.active = f.nodes.get('Courses/COS330/psets/a.md');
    await f.plugin.revealActive();
    assert.equal(f.plugin.settings.selectedId, 'cos');
    assert.deepEqual(f.plugin.settings.expanded.cos, ['Courses/COS330/psets']);
    assert.match(f.view.contentEl.querySelector('.ps-tree-row.is-active').textContent, /a.md/);
    f.plugin.select('courses'); f.plugin.select('cos');
    assert.match(f.view.contentEl.querySelector('.ps-tree-row.is-active').textContent, /a.md/);
    await f.plugin.flush(); assert.equal(f.app.saved.selectedId, 'cos');
  } finally { await f.close(); }
});
test('large trees window DOM rows and keyboard navigation reaches the last file', async () => {
  const f = await fixture(10000);
  try {
    const content = f.view.contentEl as HTMLElement;
    assert.ok(content.querySelectorAll('.ps-tree-row').length < 40);
    const tree = content.querySelector<HTMLElement>('[role=tree]')!;
    tree.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End' }));
    assert.ok(tree.scrollTop > 290000);
    assert.ok(content.querySelectorAll('.ps-tree-row').length < 40);
    assert.match(document.getElementById(tree.getAttribute('aria-activedescendant')!)!.textContent!, /overview.md/);
    tree.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(f.app.opened[0].path, 'Courses/overview.md');
    assert.equal(f.app.vault.callbacks.has('modify'), false);
    assert.equal(f.app.vault.callbacks.has('read'), false);
  } finally { await f.close(); }
});
test('missing and empty projects clear stale rows and preserve helpful states', async () => {
  const f = await fixture();
  try {
    f.plugin.select('empty');
    assert.equal(f.view.contentEl.querySelectorAll('.ps-tree-row').length, 0);
    assert.match(f.view.contentEl.querySelector('.ps-tree').textContent, /empty/);
    f.view.renderTreeWindow();
    assert.match(f.view.contentEl.querySelector('.ps-tree').textContent, /empty/);
    f.nodes.delete('Empty'); f.plugin.refresh();
    assert.match(f.view.contentEl.querySelector('.ps-tree').textContent, /missing/);
    assert.equal(f.plugin.settings.selectedId, 'empty');
  } finally { await f.close(); }
});
test('folder rename events update project roots and saved expansion without reading note content', async () => {
  const f = await fixture();
  try {
    f.plugin.settings.expanded.cos = ['Courses/COS330/psets'];
    f.app.vault.trigger('rename', { path: 'Courses/CS330' }, 'Courses/COS330');
    assert.equal(f.plugin.settings.projects.find((p: any) => p.id === 'cos').path, 'Courses/CS330');
    assert.deepEqual(f.plugin.settings.expanded.cos, ['Courses/CS330/psets']);
  } finally { await f.close(); }
});
