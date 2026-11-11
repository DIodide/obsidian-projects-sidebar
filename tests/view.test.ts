import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const mockPath = resolve('tests/obsidian-mock.cjs');
const { TFolder, TFile, Notice } = require(mockPath);
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
    factories: {}, active: null, opened: [], mutations: [], confirmDeletion: true,
    vault: { ...emitter(), adapter: { exists: async (path: string) => nodes.has(path) }, getRoot: () => root, getName: () => 'Test vault', getAbstractFileByPath: (path: string) => nodes.get(path), getAllLoadedFiles: () => [...nodes.values()] },
    workspace: { ...emitter(), onLayoutReady() {}, getLeavesOfType: () => leaves, getActiveFile: () => app.active, async revealLeaf() {}, getLeftLeaf() {
      const leaf: any = { app, async setViewState(state: any) { leaf.view = app.factories[state.type](leaf); leaves.push(leaf); await leaf.view.onOpen(); } }; return leaf;
    }, getLeaf: (mode: any) => ({ async openFile(file: any) { app.active = file; app.opened.push({ path: file.path, mode }); app.workspace.trigger('file-open', file); } }) },
  };
  const attach = (file: any) => {
    assert.ok(!nodes.has(file.path), `Cannot overwrite ${file.path}`);
    file.parent = nodes.get(file.path.split('/').slice(0, -1).join('/'));
    assert.ok(file.parent instanceof TFolder);
    file.parent.children.push(file); nodes.set(file.path, file);
    return file;
  };
  const descendants = (file: any): any[] => [file, ...(file instanceof TFolder ? file.children.flatMap(descendants) : [])];
  app.vault.copy = async (source: any, path: string) => {
    app.mutations.push(['copy', source.path, path]);
    const clone = (file: any, target: string): any => {
      const copy = attach(file instanceof TFolder ? new TFolder(target) : new TFile(target));
      if (file instanceof TFolder) for (const child of [...file.children]) clone(child, `${target}/${child.name}`);
      else copy.data = file.data?.slice();
      return copy;
    };
    const result = clone(source, path); app.vault.trigger('create', result); return result;
  };
  app.fileManager = {
    async renameFile(file: any, path: string) {
      app.mutations.push(['move', file.path, path]);
      assert.ok(!nodes.has(path));
      const oldPath = file.path;
      const subtree = descendants(file);
      file.parent.children = file.parent.children.filter((f: any) => f !== file);
      for (const child of subtree) nodes.delete(child.path);
      for (const child of subtree) {
        child.path = path + child.path.slice(oldPath.length); child.name = child.path.split('/').at(-1);
        nodes.set(child.path, child);
      }
      file.parent = nodes.get(path.split('/').slice(0, -1).join('/')); file.parent.children.push(file);
      app.vault.trigger('rename', file, oldPath);
    },
    async promptForDeletion(file: any) {
      app.mutations.push(['confirm', file.path]);
      if (!app.confirmDeletion) return false;
      await app.fileManager.trashFile(file); return true;
    },
    async trashFile(file: any) {
      app.mutations.push(['trash', file.path]);
      file.parent.children = file.parent.children.filter((f: any) => f !== file);
      for (const child of descendants(file)) nodes.delete(child.path);
      app.vault.trigger('delete', file);
    },
  };
  const plugin = new ProjectsPlugin(app);
  await plugin.onload();
  const view = await plugin.openView();
  return { app, plugin, view, nodes, clipboard: transferData(), async close() { await view.onClose(); plugin.onunload(); await plugin.flush(); } };
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

function shortcut(f: any, key: string, options: KeyboardEventInit = {}) {
  const event = new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...options });
  const tree = f.view.contentEl.querySelector('[role=tree]');
  tree.dispatchEvent(event);
  if (!event.defaultPrevented && ['c', 'v'].includes(key)) clipboardEvent(f, key === 'c' ? 'copy' : 'paste', tree);
  return event;
}
async function settled(f: any) {
  for (let n = 0; n < 30 && f.plugin.operations.busy; n++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.plugin.operations.busy, false, 'file operation completed');
}
function dragEvent(target: HTMLElement, type: string, transfer: any) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event); return event;
}
function transferData() {
  const data = new Map<string, string>();
  return { types: [] as string[], effectAllowed: '', dropEffect: '', setData(type: string, value: string) { data.set(type, value); this.types = [...data.keys()]; }, getData(type: string) { return data.get(type) ?? ''; } };
}
function treeRow(f: any, path: string): HTMLElement {
  const row = [...f.view.contentEl.querySelectorAll('.ps-tree-row')].find((el: any) => el.dataset.path === path);
  assert.ok(row, `Visible row for ${path}`); return row;
}

test('Ctrl+C/V duplicates a note with unique names and keeps the original clipboard source', async () => {
  const f = await fixture();
  try {
    const original = f.nodes.get('Courses/overview.md'); original.data = new Uint8Array([0, 255, 42]);
    f.view.focusPath(original.path);
    shortcut(f, 'c');
    assert.equal(f.clipboard.getData('text/plain'), original.path);
    shortcut(f, 'v'); await settled(f);
    shortcut(f, 'v'); await settled(f);
    assert.deepEqual(f.nodes.get('Courses/overview 1.md').data, original.data);
    assert.deepEqual(f.nodes.get('Courses/overview 2.md').data, original.data);
    assert.equal(f.plugin.operations.copied, original);
    assert.equal(f.nodes.get(original.path), original);
    assert.equal(f.app.mutations.filter((m: any) => m[0] === 'copy').length, 2);
  } finally { await f.close(); }
});

test('Cmd+C/V duplicates a selected folder beside itself, including nested contents', async () => {
  const f = await fixture();
  try {
    f.view.focusPath('Courses/COS330');
    shortcut(f, 'c', { ctrlKey: false, metaKey: true });
    shortcut(f, 'v', { ctrlKey: false, metaKey: true }); await settled(f);
    assert.ok(f.nodes.has('Courses/COS330 1/psets/a.md'));
    assert.ok(f.nodes.has('Courses/COS330 1/note.md'));
    assert.ok(f.nodes.has('Courses/COS330/psets/a.md'));
    assert.equal(f.plugin.settings.projects.length, 3, 'copy does not register duplicate projects');
  } finally { await f.close(); }
});

test('paste targets the selected folder, an empty project, project buttons, and blank tree space', async () => {
  const f = await fixture();
  try {
    f.view.focusPath('Courses/overview.md'); shortcut(f, 'c');
    f.plugin.select('cos'); f.view.focusPath('Courses/COS330/psets');
    shortcut(f, 'v'); await settled(f);
    assert.ok(f.nodes.has('Courses/COS330/psets/overview.md'));
    f.plugin.select('empty'); shortcut(f, 'v'); await settled(f);
    assert.ok(f.nodes.has('Empty/overview.md'));
    const projectButton = f.view.contentEl.querySelector('.ps-project-select[title="Courses"]');
    clipboardEvent(f, 'paste', projectButton);
    await settled(f); assert.ok(f.nodes.has('Courses/overview 1.md'));
    f.plugin.select('cos'); f.view.focusPath('Courses/COS330/psets');
    f.view.contentEl.querySelector('.ps-tree-canvas').click();
    shortcut(f, 'v'); await settled(f);
    assert.ok(f.nodes.has('Courses/COS330/overview.md'), 'blank space pastes into project root');
  } finally { await f.close(); }
});

test('Ctrl+D respects cancellation, trashes the selected folder, and ignores held-key repeats', async () => {
  const f = await fixture();
  try {
    f.view.focusPath('Courses/COS330'); shortcut(f, 'c');
    f.app.confirmDeletion = false;
    shortcut(f, 'd'); await settled(f);
    assert.ok(f.nodes.has('Courses/COS330/psets/a.md'));
    assert.equal(f.app.mutations.some((m: any) => m[0] === 'trash'), false);
    f.app.confirmDeletion = true;
    shortcut(f, 'd', { repeat: true }); await settled(f);
    assert.equal(f.app.mutations.length, 1);
    shortcut(f, 'd'); await settled(f);
    assert.equal(f.nodes.has('Courses/COS330/psets/a.md'), false);
    assert.ok(f.nodes.has('Courses/overview.md'));
    assert.equal(f.plugin.operations.copied, null);
    assert.deepEqual(f.app.mutations.at(-1), ['trash', 'Courses/COS330']);
  } finally { await f.close(); }
});

test('shortcuts do not delete or copy while typing in the project filter', async () => {
  const f = await fixture();
  try {
    const input = f.view.contentEl.querySelector('input');
    for (const key of ['c', 'v', 'd']) {
      const event = new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true });
      input.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
    }
    assert.deepEqual(f.app.mutations, []); assert.equal(f.plugin.operations.copied, null);
  } finally { await f.close(); }
});

test('drag/drop moves into a nested project with the link-aware file manager and clears highlighting', async () => {
  const f = await fixture();
  try {
    const data = transferData();
    dragEvent(treeRow(f, 'Courses/overview.md'), 'dragstart', data);
    const target = treeRow(f, 'Courses/COS330');
    assert.equal(dragEvent(target, 'dragover', data).defaultPrevented, true);
    assert.equal(target.classList.contains('ps-drop-target'), true);
    dragEvent(target, 'drop', data); await settled(f);
    assert.equal(f.nodes.has('Courses/overview.md'), false);
    assert.ok(f.nodes.has('Courses/COS330/overview.md'));
    assert.deepEqual(f.app.mutations, [['move', 'Courses/overview.md', 'Courses/COS330/overview.md']]);
    assert.equal(f.view.contentEl.querySelector('.ps-drop-target'), null);
  } finally { await f.close(); }
});

test('dragging a project folder onto another project updates nested project paths and expansion', async () => {
  const f = await fixture();
  try {
    f.plugin.settings.expanded.cos = ['Courses/COS330/psets'];
    const source = f.nodes.get('Courses/COS330'); f.plugin.operations.copy(source);
    const data = transferData(); dragEvent(treeRow(f, source.path), 'dragstart', data);
    const target = f.view.contentEl.querySelector('[data-project-path="Empty"]');
    dragEvent(target, 'drop', data); await settled(f);
    assert.equal(f.plugin.settings.projects.find((p: any) => p.id === 'cos').path, 'Empty/COS330');
    assert.deepEqual(f.plugin.settings.expanded.cos, ['Empty/COS330/psets']);
    assert.equal(f.plugin.operations.copied.path, 'Empty/COS330');
    assert.ok(f.nodes.has('Empty/COS330/psets/a.md'));
  } finally { await f.close(); }
});

test('file operations reject self/descendant moves, collisions, missing sources, and the vault root', async () => {
  const f = await fixture();
  try {
    const ops = f.plugin.operations;
    const folder = f.nodes.get('Courses/COS330');
    for (const copy of [false, true]) {
      await assert.rejects(ops.transfer(folder, folder, copy), /inside itself/);
      await assert.rejects(ops.transfer(folder, f.nodes.get('Courses/COS330/psets'), copy), /inside itself/);
    }
    await ops.transfer(f.nodes.get('Courses/overview.md'), folder, true);
    await assert.rejects(ops.transfer(f.nodes.get('Courses/overview.md'), folder, false), /already exists/);
    assert.ok(f.nodes.has('Courses/overview.md'));
    assert.throws(() => ops.copy(f.nodes.get('')), /vault root/);
    const missing = f.nodes.get('Courses/overview.md'); f.nodes.delete(missing.path);
    await assert.rejects(ops.transfer(missing, folder, true), /no longer exists/);
  } finally { await f.close(); }
});

test('foreign drags and file-row drops cannot accidentally move a file to the project root', async () => {
  const f = await fixture();
  try {
    const data = transferData(); data.setData('text/plain', 'Courses/overview.md');
    dragEvent(treeRow(f, 'Courses/COS330'), 'drop', data);
    assert.deepEqual(f.app.mutations, []);
    dragEvent(treeRow(f, 'Courses/COS330'), 'dragstart', data);
    dragEvent(treeRow(f, 'Courses/overview.md'), 'drop', data);
    await settled(f); assert.deepEqual(f.app.mutations, []);
    data.setData('application/x-obsidian-projects-sidebar', 'foreign-vault');
    dragEvent(f.view.contentEl.querySelector('.ps-tree'), 'drop', data);
    await settled(f); assert.deepEqual(f.app.mutations, []);
  } finally { await f.close(); }
});

test('busy operations prevent duplicate pastes and failures leave the original intact', async () => {
  const f = await fixture();
  try {
    f.view.focusPath('Courses/overview.md'); shortcut(f, 'c');
    let rejectCopy!: (error: Error) => void;
    f.app.vault.copy = () => new Promise((_resolve, reject) => { rejectCopy = reject; });
    shortcut(f, 'v'); shortcut(f, 'v');
    assert.equal(f.plugin.operations.busy, true);
    assert.match(Notice.messages.at(-1), /Wait for/);
    await new Promise(resolve => setImmediate(resolve));
    const originalError = console.error; console.error = () => {};
    try { rejectCopy(new Error('Disk is full')); await settled(f); } finally { console.error = originalError; }
    assert.equal(f.plugin.operations.busy, false);
    assert.ok(f.nodes.has('Courses/overview.md'));
    assert.match(Notice.messages.at(-1), /Disk is full/);
  } finally { await f.close(); }
});

function clipboardEvent(f: any, type: string, target = f.view.contentEl.querySelector('[role=tree]')) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: f.clipboard });
  target.dispatchEvent(event); return event;
}

test('copying unrelated text replaces the clipboard without pasting a stale file', async () => {
  const f = await fixture();
  try {
    f.view.focusPath('Courses/overview.md'); shortcut(f, 'c');
    f.clipboard = transferData(); f.clipboard.setData('text/plain', 'Unrelated text');
    assert.equal(clipboardEvent(f, 'paste').defaultPrevented, false);
    await settled(f); assert.deepEqual(f.app.mutations, []);
    f.clipboard.setData('application/x-obsidian-projects-sidebar-copy', 'another-vault');
    clipboardEvent(f, 'paste'); await settled(f); assert.deepEqual(f.app.mutations, []);
  } finally { await f.close(); }
});


test('copies and moves respect disk collisions not present in the vault index', async () => {
  const f = await fixture();
  try {
    const folder = f.nodes.get('Empty'), file = f.nodes.get('Courses/overview.md');
    f.app.vault.adapter.exists = async (path: string) => ['empty/overview.md', 'empty/overview 1.md'].includes(path.toLowerCase());
    await assert.rejects(f.plugin.operations.transfer(file, folder, false), /already exists/);
    assert.deepEqual(f.app.mutations, []);
    await f.plugin.operations.transfer(file, folder, true);
    assert.ok(f.nodes.has('Empty/overview 2.md'));
    assert.ok(f.nodes.has('Courses/overview.md'));
  } finally { await f.close(); }
});

test('moving to the vault root uses a normalized path even when its path is slash', async () => {
  const f = await fixture();
  try {
    const root = f.nodes.get(''); root.path = '/'; f.nodes.set('/', root);
    await f.plugin.operations.transfer(f.nodes.get('Courses/overview.md'), root, false);
    assert.ok(f.nodes.has('overview.md'));
    assert.deepEqual(f.app.mutations, [['move', 'Courses/overview.md', 'overview.md']]);
  } finally { await f.close(); }
});
