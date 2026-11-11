import ProjectsPlugin from '../src/main.ts';
import { TFolder, TFile } from './demo-obsidian.mjs';
const proto = HTMLElement.prototype;
proto.empty = function () { this.replaceChildren(); };
proto.addClass = function (name) { this.classList.add(name); };
proto.setText = function (text) { this.textContent = text; };
Object.defineProperty(proto, 'win', { get() { return window; } });
proto.createEl = function (tag, options = {}) {
  const el = document.createElement(tag);
  if (options.cls) el.className = options.cls;
  if (options.text) el.textContent = options.text;
  for (const key of ['type', 'value', 'placeholder']) if (options[key]) el.setAttribute(key, options[key]);
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, String(value));
  this.append(el); return el;
};
proto.createDiv = function (options) { return this.createEl('div', options); };
proto.createSpan = function (options) { return this.createEl('span', options); };
const folders = ['', 'Studio', 'Studio/Brand refresh', 'Studio/Brand refresh/Research', 'Studio/Brand refresh/Design', 'Studio/Website', 'Garden', 'Reading'];
const files = ['Studio/Studio index.md', 'Studio/Weekly planning.md', 'Studio/Brand refresh/Project brief.md', 'Studio/Brand refresh/Decision log.md', 'Studio/Brand refresh/Research/Interviews.md', 'Studio/Brand refresh/Research/Visual references.md', 'Studio/Brand refresh/Design/Color studies.md', 'Studio/Brand refresh/Design/Typography.md', 'Studio/Website/Launch checklist.md', 'Garden/Planting notes.md', 'Reading/Book notes.md'];
const nodes = new Map([...folders.map(p => new TFolder(p)), ...files.map(p => new TFile(p))].map(f => [f.path, f]));
for (const f of nodes.values()) if (f.path) { f.parent = nodes.get(f.path.split('/').slice(0, -1).join('/')); f.parent.children.push(f); }
const projects = [
  { id: 'brand', path: 'Studio/Brand refresh', name: 'Brand refresh', pinned: true },
  { id: 'studio', path: 'Studio', name: 'Studio', pinned: true },
  { id: 'garden', path: 'Garden', name: 'Garden', pinned: false },
  { id: 'reading', path: 'Reading', name: 'Reading', pinned: false },
];
const leaves = [];
const app = {
  saved: { projects, selectedId: 'brand', expanded: { brand: ['Studio/Brand refresh/Research', 'Studio/Brand refresh/Design'] } },
  factories: {}, active: nodes.get('Studio/Brand refresh/Project brief.md'),
  vault: { on() {}, getRoot: () => nodes.get(''), getName: () => 'Fieldnotes', getAbstractFileByPath: p => nodes.get(p), getAllLoadedFiles: () => [...nodes.values()] },
  workspace: { on() {}, onLayoutReady() {}, getLeavesOfType: () => leaves, getActiveFile: () => app.active, async revealLeaf() {}, getLeftLeaf() {
    const leaf = { app, async setViewState(state) { leaf.view = app.factories[state.type](leaf); leaves.push(leaf); document.querySelector('#sidebar').append(leaf.view.contentEl); await leaf.view.onOpen(); } }; return leaf;
  }, getLeaf: () => ({ async openFile(file) { app.active = file; plugin.refresh(); } }) },
};
const plugin = new ProjectsPlugin(app);
await plugin.onload();
await plugin.openView();
window.demo = { plugin, ready: true };
