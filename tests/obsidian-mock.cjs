class TAbstractFile {
  constructor(path) { this.path = path; this.name = path.split('/').at(-1); this.parent = null; }
}
class TFolder extends TAbstractFile { constructor(path) { super(path); this.children = []; } }
class TFile extends TAbstractFile {}
class Plugin {
  constructor(app) { this.app = app; this.events = []; this.commands = []; }
  async loadData() { return this.app.saved; }
  async saveData(data) { this.app.saved = data; }
  registerView(type, factory) { this.app.factories[type] = factory; }
  registerEvent(event) { this.events.push(event); }
  addRibbonIcon() {}
  addCommand(command) { this.commands.push(command); }
  addSettingTab() {}
}
class ItemView {
  constructor(leaf) { this.leaf = leaf; this.app = leaf.app; this.contentEl = document.createElement('div'); document.body.append(this.contentEl); this.listeners = []; }
  registerDomEvent(el, type, callback) { el.addEventListener(type, callback); this.listeners.push(() => el.removeEventListener(type, callback)); }
}
class Modal { constructor(app) { this.app = app; this.contentEl = document.createElement('div'); this.titleEl = document.createElement('h2'); } open() {} close() {} }
class FuzzySuggestModal extends Modal { setPlaceholder() {} }
class Menu { addItem(cb) { const item = new Proxy({}, { get: () => () => item }); cb(item); return this; } addSeparator() {} showAtMouseEvent() {} }
class Notice { constructor(message) { Notice.messages.push(message); } static messages = []; }
class PluginSettingTab { constructor(app) { this.app = app; } }
function setIcon(el, name) { el.setAttribute('data-icon', name); }
module.exports = { Plugin, ItemView, Modal, FuzzySuggestModal, Menu, Notice, PluginSettingTab, setIcon, TAbstractFile, TFolder, TFile, Setting: class {} };
