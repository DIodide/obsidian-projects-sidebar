import mock from '../tests/obsidian-mock.cjs';
import { icons, createElement } from 'lucide';
export const { Plugin, ItemView, Modal, FuzzySuggestModal, Menu, Notice, PluginSettingTab, TAbstractFile, TFolder, TFile, Setting } = mock;
export function setIcon(el, name) {
  const key = name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('');
  if (!icons[key]) throw new Error(`Missing demo icon: ${name}`);
  el.replaceChildren(createElement(icons[key], { width: 18, height: 18, 'stroke-width': 1.6 }));
}
