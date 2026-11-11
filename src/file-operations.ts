import { App, TAbstractFile, TFolder } from 'obsidian';
import { contains } from './model';

/** Shared by every sidebar view; references follow Obsidian's rename events. */
export class FileOperations {
  copied: TAbstractFile | null = null;
  clipboardText = '';
  dragging: TAbstractFile | null = null;
  readonly dragToken = crypto.randomUUID();
  readonly clipboardToken = crypto.randomUUID();
  busy = false;

  constructor(private app: App) {}

  exists(file: TAbstractFile): boolean {
    return this.app.vault.getAbstractFileByPath(file.path) === file;
  }

  copy(file: TAbstractFile) {
    this.requireFile(file);
    this.copied = file;
    this.clipboardText = file.path;
  }

  private requireFile(file: TAbstractFile) {
    if (!file.path || file === this.app.vault.getRoot()) throw new Error('The vault root cannot be changed.');
    if (!this.exists(file)) throw new Error('This item no longer exists. Select it again.');
  }

  async transfer(source: TAbstractFile, destination: TFolder, copy: boolean): Promise<TAbstractFile> {
    this.requireFile(source);
    if (!this.exists(destination)) throw new Error('The destination folder no longer exists.');
    if (source instanceof TFolder && contains(source.path, destination.path)) {
      throw new Error('A folder cannot be placed inside itself or one of its descendants.');
    }
    if (!copy && source.parent === destination) return source;
    const join = (name: string) => destination !== this.app.vault.getRoot() && destination.path ? `${destination.path}/${name}` : name;
    const occupied = async (path: string) => !!this.app.vault.getAbstractFileByPath(path) || await this.app.vault.adapter.exists(path);
    let path = join(source.name);
    if (copy) {
      // Keep the extension on files, including binary attachments; folders keep their full name.
      const dot = source instanceof TFolder ? -1 : source.name.lastIndexOf('.');
      const stem = dot > 0 ? source.name.slice(0, dot) : source.name;
      const extension = dot > 0 ? source.name.slice(dot) : '';
      for (let n = 1; await occupied(path); n++) path = join(`${stem} ${n}${extension}`);
      return this.app.vault.copy(source, path);
    }
    if (await occupied(path)) throw new Error(`“${source.name}” already exists in that folder. Nothing was moved.`);
    await this.app.fileManager.renameFile(source, path);
    return source;
  }

  async delete(file: TAbstractFile): Promise<boolean> {
    this.requireFile(file);
    // Obsidian performs the deletion itself after its configured confirmation.
    // Calling trashFile again would try to delete an item that is already gone.
    if (!await this.app.fileManager.promptForDeletion(file)) return false;
    if (this.copied && !this.exists(this.copied)) this.copied = null;
    return true;
  }
}
