import {
  Plugin, ItemView, WorkspaceLeaf, TFolder, TFile,
  FuzzySuggestModal, Modal, Setting, Menu, Notice, PluginSettingTab, setIcon,
} from 'obsidian';
import { ALL, Settings, Project, TreeRow, readSettings, filterProjects, treeRows, ownerOf, applyRename } from './model';

export const VIEW = 'projects-sidebar-view';
const ROW_HEIGHT = 30;
const OVERSCAN = 8;

function iconButton(parent: HTMLElement, icon: string, label: string, action: (event: MouseEvent) => void): HTMLButtonElement {
  const button = parent.createEl('button', { cls: 'ps-icon-button', attr: { 'aria-label': label, title: label, type: 'button' } });
  setIcon(button, icon);
  button.addEventListener('click', action);
  return button;
}

export default class ProjectsPlugin extends Plugin {
  settings: Settings = readSettings(null);
  private saveTimer?: number;
  private saves: Promise<void> = Promise.resolve();
  private refreshTimer?: number;

  async onload() {
    this.settings = readSettings(await this.loadData());
    this.registerView(VIEW, leaf => new ProjectsView(leaf, this));
    this.addRibbonIcon('panels-top-left', 'Projects', () => { void this.openView(); });
    this.addCommand({ id: 'open-projects', name: 'Open Projects', callback: () => { void this.openView(); } });
    this.addCommand({ id: 'switch-project', name: 'Switch project', callback: () => new ProjectPicker(this).open() });
    this.addCommand({ id: 'add-project', name: 'Add folder as project', callback: () => this.pickFolder() });
    this.addCommand({ id: 'show-all-files', name: 'Show all vault files', callback: () => { this.select(null); void this.openView(); } });
    this.addCommand({ id: 'reveal-active-file', name: 'Reveal active file in its project', callback: () => { void this.revealActive(); } });
    this.addSettingTab(new ProjectsSettings(this));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFolder && file.path) menu.addItem(item => item.setTitle('Open as project').setIcon('folder-kanban').onClick(() => this.addProject(file)));
    }));
    // Only structural changes matter; typing/metadata updates never rebuild this view.
    this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      applyRename(this.settings, oldPath, file.path);
      this.persist(); this.scheduleRefresh();
    }));
    this.registerEvent(this.app.workspace.on('file-open', () => this.views().forEach(view => view.renderTreeWindow())));
    this.app.workspace.onLayoutReady(() => { if (this.settings.autoOpen && !this.views().length) void this.openView(false); });
  }

  views(): ProjectsView[] {
    return this.app.workspace.getLeavesOfType(VIEW).map(leaf => leaf.view as ProjectsView);
  }
  async openView(reveal = true): Promise<ProjectsView | undefined> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      const left = this.app.workspace.getLeftLeaf(false);
      if (!left) return;
      leaf = left;
      await leaf.setViewState({ type: VIEW, active: reveal });
    }
    if (reveal) await this.app.workspace.revealLeaf(leaf);
    return leaf.view as ProjectsView;
  }
  select(id: string | null) {
    this.settings.selectedId = id;
    this.persist();
    this.views().forEach(view => view.projectChanged());
  }
  addProject(folder: TFolder) {
    if (!folder.path) return;
    let p = this.settings.projects.find(p => p.path === folder.path);
    if (!p) {
      p = { id: crypto.randomUUID(), path: folder.path, name: folder.name, pinned: false };
      this.settings.projects.push(p);
    }
    this.select(p.id);
    void this.openView();
  }
  pickFolder() { new FolderPicker(this).open(); }
  refresh() { this.views().forEach(view => { view.renderProjects(); view.rebuildTree(); }); }
  private scheduleRefresh() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.refresh(), 120);
  }
  persist() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => { void this.flush(); }, 200);
  }
  flush(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    this.saves = this.saves.then(() => this.saveData(snapshot)).catch(error => {
      console.error('Projects Sidebar: settings could not be saved', error);
      new Notice('Projects Sidebar could not save settings. Check available storage.');
    });
    return this.saves;
  }
  async revealActive() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('Open a file first.'); return; }
    const project = ownerOf(this.settings.projects, file.path);
    this.settings.selectedId = project?.id ?? null;
    const key = project?.id ?? ALL;
    const expanded = new Set(this.settings.expanded[key] ?? []);
    let parent = file.parent;
    while (parent && parent.path !== (project?.path ?? '')) { expanded.add(parent.path); parent = parent.parent; }
    this.settings.expanded[key] = [...expanded];
    this.persist();
    const view = await this.openView();
    this.views().forEach(v => v.projectChanged());
    view?.focusPath(file.path);
  }
  onunload() {
    window.clearTimeout(this.refreshTimer);
    void this.flush();
  }
}

export class ProjectsView extends ItemView {
  private readonly treeId = crypto.randomUUID();
  private query = '';
  private projectList!: HTMLElement;
  private treeHeader!: HTMLElement;
  private viewport!: HTMLElement;
  private canvas!: HTMLElement;
  private rows: TreeRow[] = [];
  private cursor = 0;
  private expanded = new Set<string>();
  private resize?: ResizeObserver;
  private frame?: number;

  constructor(leaf: WorkspaceLeaf, public plugin: ProjectsPlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Projects'; }
  getIcon() { return 'panels-top-left'; }
  private get selected() { return this.plugin.settings.projects.find(p => p.id === this.plugin.settings.selectedId); }
  private get stateKey() { return this.selected?.id ?? ALL; }

  async onOpen() {
    const root = this.contentEl;
    root.empty(); root.addClass('ps-view');
    const header = root.createDiv({ cls: 'ps-heading' });
    header.createEl('h2', { text: 'Projects' });
    iconButton(header, 'plus', 'Add project', () => this.plugin.pickFolder());
    const filter = root.createDiv({ cls: 'ps-filter' });
    setIcon(filter.createSpan({ cls: 'ps-search-icon' }), 'search');
    const input = filter.createEl('input', { type: 'search', placeholder: 'Filter projects…', attr: { 'aria-label': 'Filter projects', spellcheck: 'false' } });
    input.addEventListener('input', () => { this.query = input.value; this.renderProjects(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { input.value = ''; this.query = ''; this.renderProjects(); }
      if (event.key === 'ArrowDown') { event.preventDefault(); this.projectList.querySelector<HTMLButtonElement>('.ps-project-select')?.focus(); }
      if (event.key === 'Enter') {
        const first = filterProjects(this.plugin.settings.projects, this.query)[0];
        if (first) this.plugin.select(first.id);
      }
    });
    this.projectList = root.createDiv({ cls: 'ps-projects', attr: { 'aria-label': 'Projects' } });
    this.projectList.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(this.projectList.querySelectorAll<HTMLButtonElement>('.ps-project-select'));
      const current = buttons.indexOf(event.target as HTMLButtonElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
      buttons[next]?.focus();
    });
    this.treeHeader = root.createDiv({ cls: 'ps-tree-heading' });
    this.viewport = root.createDiv({ cls: 'ps-tree', attr: { role: 'tree', tabindex: '0', 'aria-label': 'Project files' } });
    this.canvas = this.viewport.createDiv({ cls: 'ps-tree-canvas', attr: { role: 'presentation' } });
    this.registerDomEvent(this.viewport, 'scroll', () => {
      if (this.frame !== undefined) return;
      this.frame = this.viewport.win.requestAnimationFrame(() => { this.frame = undefined; this.renderTreeWindow(); });
    });
    this.registerDomEvent(this.viewport, 'keydown', event => this.treeKeydown(event));
    this.resize = new ResizeObserver(() => this.renderTreeWindow());
    this.resize.observe(this.viewport);
    this.projectChanged();
  }

  projectChanged() {
    this.expanded = new Set(this.plugin.settings.expanded[this.stateKey] ?? []);
    this.cursor = 0;
    this.rows = [];
    if (!this.viewport) return;
    this.viewport.scrollTop = 0;
    this.renderProjects(); this.rebuildTree();
  }
  renderProjects() {
    if (!this.projectList) return;
    this.projectList.empty();
    this.projectRow(null);
    const projects = filterProjects(this.plugin.settings.projects, this.query);
    let previous: boolean | undefined;
    for (const project of projects) {
      if (previous !== project.pinned) this.projectList.createDiv({ cls: 'ps-section-label', text: project.pinned ? 'Pinned' : 'Projects' });
      previous = project.pinned;
      this.projectRow(project);
    }
    if (!projects.length) {
      this.projectList.createDiv({ cls: 'ps-empty', text: this.query ? 'No matching projects.' : 'Add a folder to focus on its files. Nested projects get their own tree.' });
      if (!this.query) this.projectList.createEl('button', { text: 'Add project', cls: 'ps-add' }).addEventListener('click', () => this.plugin.pickFolder());
    }
  }
  private projectRow(project: Project | null) {
    const selected = (project?.id ?? null) === this.plugin.settings.selectedId;
    const row = this.projectList.createDiv({ cls: `ps-project${selected ? ' is-selected' : ''}` });
    const button = row.createEl('button', { cls: 'ps-project-select', attr: { type: 'button', 'aria-pressed': String(selected), title: project?.path ?? 'Every file in the vault' } });
    setIcon(button.createSpan({ cls: 'ps-project-icon' }), project ? 'folder-kanban' : 'vault');
    const label = button.createSpan({ cls: 'ps-project-label' });
    label.createSpan({ cls: 'ps-project-name', text: project?.name ?? 'All files' });
    if (project) label.createSpan({ cls: 'ps-project-path', text: project.path });
    if (selected) setIcon(button.createSpan({ cls: 'ps-selected-icon' }), 'check');
    button.addEventListener('click', () => this.plugin.select(project?.id ?? null));
    if (project) {
      const showMenu = (event: MouseEvent) => { event.preventDefault(); this.projectMenu(project, event); };
      button.addEventListener('contextmenu', showMenu);
      iconButton(row, 'ellipsis', `Options for ${project.name}`, showMenu);
    }
  }
  private projectMenu(project: Project, event: MouseEvent) {
    const menu = new Menu();
    menu.addItem(item => item.setTitle(project.pinned ? 'Unpin project' : 'Pin project').setIcon('pin').onClick(() => { project.pinned = !project.pinned; this.plugin.persist(); this.plugin.refresh(); }));
    menu.addItem(item => item.setTitle('Rename project label').setIcon('pencil').onClick(() => new TextPrompt(this.plugin, 'Project name', project.name, async value => { project.name = value; this.plugin.persist(); this.plugin.refresh(); }).open()));
    menu.addSeparator();
    menu.addItem(item => item.setTitle('Remove from Projects (keep files)').setIcon('list-minus').onClick(() => {
      this.plugin.settings.projects = this.plugin.settings.projects.filter(p => p.id !== project.id);
      delete this.plugin.settings.expanded[project.id];
      if (this.plugin.settings.selectedId === project.id) this.plugin.select(null);
      this.plugin.persist(); this.plugin.refresh();
    }));
    menu.showAtMouseEvent(event);
  }

  rebuildTree() {
    if (!this.viewport) return;
    this.expanded = new Set(this.plugin.settings.expanded[this.stateKey] ?? []);
    const focusedPath = this.rows[this.cursor]?.node.path;
    const project = this.selected;
    const root = project ? this.app.vault.getAbstractFileByPath(project.path) : this.app.vault.getRoot();
    this.treeHeader.empty();
    const title = this.treeHeader.createDiv({ cls: 'ps-tree-title' });
    title.createSpan({ text: project?.name ?? 'All files' });
    title.title = project?.path ?? this.app.vault.getName();
    if (root instanceof TFolder) {
      iconButton(this.treeHeader, 'file-plus', 'New note', () => this.createEntry(root, false));
      iconButton(this.treeHeader, 'folder-plus', 'New folder', () => this.createEntry(root, true));
    }
    iconButton(this.treeHeader, 'locate-fixed', 'Reveal active file in its project', () => { void this.plugin.revealActive(); });
    iconButton(this.treeHeader, 'fold-vertical', 'Collapse folders', () => { this.expanded.clear(); this.saveExpansion(); this.rebuildTree(); });
    this.rows = root instanceof TFolder ? treeRows(root, this.expanded, this.plugin.settings.projects, project) : [];
    this.cursor = Math.max(0, this.rows.findIndex(row => row.node.path === focusedPath));
    this.canvas.empty();
    this.canvas.style.height = `${this.rows.length * ROW_HEIGHT}px`;
    this.viewport.setAttribute('aria-label', `${project?.name ?? 'All vault'} files`);
    // Clamp scroll before windowing after collapsing or deleting many rows.
    this.viewport.scrollTop = Math.min(this.viewport.scrollTop, Math.max(0, this.rows.length * ROW_HEIGHT - this.viewport.clientHeight));
    this.renderTreeWindow();
    if (!this.rows.length) {
      this.canvas.style.height = 'auto';
      this.canvas.createDiv({ cls: 'ps-empty', text: root instanceof TFolder ? 'This folder is empty.' : 'Project folder is missing. Restore it or remove this project from its menu.' });
    }
  }
  renderTreeWindow() {
    if (!this.canvas) return;
    // Preserve missing/empty-folder messages across active-file and resize events.
    if (!this.rows.length) { this.viewport.removeAttribute('aria-activedescendant'); return; }
    this.canvas.empty();
    const first = Math.max(0, Math.floor(this.viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(this.rows.length, Math.ceil((this.viewport.scrollTop + (this.viewport.clientHeight || 400)) / ROW_HEIGHT) + OVERSCAN);
    const active = this.app.workspace.getActiveFile()?.path;
    for (let index = first; index < last; index++) {
      const row = this.rows[index];
      const folder = !!row.node.children;
      const el = this.canvas.createDiv({ cls: `ps-tree-row${active === row.node.path ? ' is-active' : ''}${index === this.cursor ? ' is-cursor' : ''}${row.project ? ' is-boundary' : ''}`, attr: {
        role: 'treeitem', id: `ps-${this.treeId}-${index}`, 'aria-level': String(row.depth + 1), 'aria-selected': String(active === row.node.path),
        title: row.project ? `Open project: ${row.project.name}` : row.node.path,
      } });
      el.style.top = `${index * ROW_HEIGHT}px`;
      el.style.paddingInlineStart = `${8 + row.depth * 16}px`;
      if (folder && !row.project) el.setAttribute('aria-expanded', String(this.expanded.has(row.node.path)));
      const chevron = el.createSpan({ cls: 'ps-chevron' });
      if (folder && !row.project) setIcon(chevron, this.expanded.has(row.node.path) ? 'chevron-down' : 'chevron-right');
      setIcon(el.createSpan({ cls: 'ps-file-icon' }), row.project ? 'folder-kanban' : folder ? 'folder' : row.node.name.endsWith('.pdf') ? 'file-text' : 'file');
      el.createSpan({ cls: 'ps-file-name', text: row.project?.name ?? row.node.name });
      if (row.project) { el.createSpan({ cls: 'ps-project-badge', text: 'Project' }); setIcon(el.createSpan({ cls: 'ps-boundary-arrow' }), 'arrow-up-right'); }
      el.addEventListener('click', event => { this.cursor = index; this.viewport.focus(); this.activateRow(row, event.metaKey || event.ctrlKey); });
      el.addEventListener('contextmenu', event => { event.preventDefault(); this.fileMenu(row, event); });
    }
    if (this.cursor >= first && this.cursor < last) this.viewport.setAttribute('aria-activedescendant', `ps-${this.treeId}-${this.cursor}`);
    else this.viewport.removeAttribute('aria-activedescendant');
  }
  private activateRow(row: TreeRow, newTab = false) {
    if (row.project) { this.plugin.select(row.project.id); return; }
    const file = this.app.vault.getAbstractFileByPath(row.node.path);
    if (file instanceof TFolder) {
      if (this.expanded.has(file.path)) this.expanded.delete(file.path); else this.expanded.add(file.path);
      this.saveExpansion(); this.rebuildTree();
    } else if (file instanceof TFile) {
      void this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(file).catch(error => { console.error(error); new Notice(`Could not open ${file.name}.`); });
    }
  }
  private saveExpansion() { this.plugin.settings.expanded[this.stateKey] = [...this.expanded]; this.plugin.persist(); }
  private treeKeydown(event: KeyboardEvent) {
    const row = this.rows[this.cursor];
    if (!row) return;
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    switch (event.key) {
      case 'ArrowDown': this.cursor = Math.min(this.rows.length - 1, this.cursor + 1); break;
      case 'ArrowUp': this.cursor = Math.max(0, this.cursor - 1); break;
      case 'Home': this.cursor = 0; break;
      case 'End': this.cursor = this.rows.length - 1; break;
      case 'Enter': case ' ': this.activateRow(row, event.metaKey || event.ctrlKey); return;
      case 'ArrowRight':
        if (row.project || (row.node.children && !this.expanded.has(row.node.path))) this.activateRow(row);
        else if (row.node.children?.length) this.cursor = Math.min(this.rows.length - 1, this.cursor + 1);
        break;
      case 'ArrowLeft':
        if (!row.project && this.expanded.has(row.node.path)) this.activateRow(row);
        else if (row.parent) this.cursor = Math.max(0, this.rows.findIndex(r => r.node.path === row.parent));
        break;
    }
    this.ensureCursorVisible(); this.renderTreeWindow();
  }
  private ensureCursorVisible() {
    const top = this.cursor * ROW_HEIGHT;
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (top + ROW_HEIGHT > this.viewport.scrollTop + this.viewport.clientHeight) this.viewport.scrollTop = Math.max(0, top + ROW_HEIGHT - (this.viewport.clientHeight || 400));
  }
  focusPath(path: string) {
    const index = this.rows.findIndex(row => row.node.path === path);
    if (index < 0) return;
    this.cursor = index; this.ensureCursorVisible(); this.renderTreeWindow(); this.viewport.focus();
  }
  private fileMenu(row: TreeRow, event: MouseEvent) {
    const file = this.app.vault.getAbstractFileByPath(row.node.path);
    if (!file) return;
    const menu = new Menu();
    if (row.project) menu.addItem(item => item.setTitle('Open project').setIcon('folder-kanban').onClick(() => this.plugin.select(row.project!.id)));
    else if (file instanceof TFolder) {
      menu.addItem(item => item.setTitle('New note').setIcon('file-plus').onClick(() => this.createEntry(file, false)));
      menu.addItem(item => item.setTitle('New folder').setIcon('folder-plus').onClick(() => this.createEntry(file, true)));
    } else menu.addItem(item => item.setTitle('Open in new tab').setIcon('file').onClick(() => this.activateRow(row, true)));
    this.app.workspace.trigger('file-menu', menu, file, VIEW, this.leaf);
    menu.showAtMouseEvent(event);
  }
  private createEntry(folder: TFolder, directory: boolean) {
    new TextPrompt(this.plugin, directory ? 'New folder' : 'New note', '', async name => {
      if (/[\\/:]/.test(name) || name.startsWith('.') || name === '..') throw new Error('Enter a name without slashes, colons, or a leading dot.');
      const filename = directory || name.endsWith('.md') ? name : name + '.md';
      const path = folder.path ? `${folder.path}/${filename}` : filename;
      if (this.app.vault.getAbstractFileByPath(path)) throw new Error('An item with that name already exists.');
      if (directory) await this.app.vault.createFolder(path);
      else { const file = await this.app.vault.create(path, ''); await this.app.workspace.getLeaf(false).openFile(file); }
      this.expanded.add(folder.path); this.saveExpansion(); this.rebuildTree();
    }).open();
  }
  async onClose() {
    this.resize?.disconnect();
    if (this.frame !== undefined) this.viewport.win.cancelAnimationFrame(this.frame);
    this.contentEl.empty();
  }
}

class FolderPicker extends FuzzySuggestModal<TFolder> {
  constructor(private plugin: ProjectsPlugin) { super(plugin.app); this.setPlaceholder('Choose a vault folder as a project…'); }
  getItems() { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && !!file.path); }
  getItemText(folder: TFolder) { return folder.path; }
  onChooseItem(folder: TFolder) { this.plugin.addProject(folder); }
}
class ProjectPicker extends FuzzySuggestModal<Project> {
  constructor(private plugin: ProjectsPlugin) { super(plugin.app); this.setPlaceholder('Switch project…'); }
  getItems() { return filterProjects(this.plugin.settings.projects, ''); }
  getItemText(p: Project) { return `${p.name} — ${p.path}`; }
  onChooseItem(p: Project) { this.plugin.select(p.id); void this.plugin.openView(); }
}
class TextPrompt extends Modal {
  constructor(private plugin: ProjectsPlugin, private label: string, private initial: string, private submit: (value: string) => Promise<void>) { super(plugin.app); }
  onOpen() {
    this.titleEl.setText(this.label);
    const form = this.contentEl.createEl('form');
    const input = form.createEl('input', { type: 'text', value: this.initial, attr: { 'aria-label': this.label, required: 'true' } });
    input.style.width = '100%';
    const error = form.createDiv({ cls: 'ps-form-error', attr: { role: 'alert' } });
    const footer = form.createDiv({ cls: 'ps-form-footer' });
    const cancel = footer.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const save = footer.createEl('button', { text: 'Save', cls: 'mod-cta', attr: { type: 'submit' } });
    form.addEventListener('submit', event => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value || save.disabled) return;
      save.disabled = true;
      void this.submit(value).then(() => this.close()).catch(e => { error.setText(e instanceof Error ? e.message : String(e)); save.disabled = false; });
    });
    input.focus(); input.select();
  }
  onClose() { this.contentEl.empty(); }
}
class ProjectsSettings extends PluginSettingTab {
  constructor(private plugin: ProjectsPlugin) { super(plugin.app, plugin); }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Projects Sidebar').setHeading();
    new Setting(this.containerEl).setName('Open Projects on startup').setDesc('Restore a Projects tab in the left sidebar.').addToggle(toggle => toggle.setValue(this.plugin.settings.autoOpen).onChange(value => { this.plugin.settings.autoOpen = value; this.plugin.persist(); }));
    new Setting(this.containerEl).setName('Add project').setDesc('Choose any vault folder. A nested project owns its subtree; its parent shows a shortcut.').addButton(button => button.setButtonText('Choose folder').onClick(() => this.plugin.pickFolder()));
    this.containerEl.createEl('p', { text: 'Filter, pin, rename labels, and remove projects from the Projects tab. Removing a project never deletes or moves files. This view scopes navigation; it does not limit Obsidian’s global search or indexing.' });
  }
}
