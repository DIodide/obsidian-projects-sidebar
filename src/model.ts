export interface Project { id: string; name: string; path: string; pinned: boolean }
export interface Settings {
  projects: Project[];
  selectedId: string | null;
  expanded: Record<string, string[]>;
  autoOpen: boolean;
}
export const DEFAULTS: Settings = { projects: [], selectedId: null, expanded: {}, autoOpen: true };
export const ALL = '__all__';

export function cleanPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
  if (parts.includes('..')) throw new Error('Use a folder inside this vault.');
  return parts.join('/');
}
export function contains(root: string, path: string): boolean {
  return root === '' || path === root || path.startsWith(root + '/');
}
export function ownerOf(projects: readonly Project[], path: string): Project | undefined {
  return projects.filter(p => contains(p.path, path)).sort((a, b) => b.path.length - a.path.length)[0];
}
export function filterProjects(projects: readonly Project[], query: string): Project[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return projects.filter(p => words.every(w => `${p.name} ${p.path}`.toLocaleLowerCase().includes(w)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.path.localeCompare(b.path));
}
export function readSettings(raw: unknown): Settings {
  const result: Settings = { ...DEFAULTS, projects: [], expanded: {} };
  if (!raw || typeof raw !== 'object') return result;
  const s = raw as Partial<Settings>;
  const ids = new Set<string>(), paths = new Set<string>();
  if (Array.isArray(s.projects)) for (const p of s.projects) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.path !== 'string' || typeof p.name !== 'string') continue;
    try {
      const path = cleanPath(p.path);
      if (!path || ids.has(p.id) || paths.has(path) || p.id === ALL) continue;
      result.projects.push({ id: p.id, path, name: p.name.trim() || path.split('/').at(-1)!, pinned: p.pinned === true });
      ids.add(p.id); paths.add(path);
    } catch { /* Ignore malformed persisted paths. */ }
  }
  result.selectedId = typeof s.selectedId === 'string' && ids.has(s.selectedId) ? s.selectedId : null;
  result.autoOpen = s.autoOpen !== false;
  if (s.expanded && typeof s.expanded === 'object') for (const [key, value] of Object.entries(s.expanded)) {
    if ((ids.has(key) || key === ALL) && Array.isArray(value)) result.expanded[key] = value.filter((p): p is string => typeof p === 'string');
  }
  return result;
}
export interface TreeNode { path: string; name: string; children?: TreeNode[] }
export interface TreeRow { node: TreeNode; depth: number; parent: string | null; project?: Project }
export function treeRows(root: TreeNode, expanded: ReadonlySet<string>, projects: readonly Project[], selected: Project | undefined): TreeRow[] {
  const boundaries = new Map(projects.filter(p => selected && p.id !== selected.id && contains(selected.path, p.path)).map(p => [p.path, p]));
  const rows: TreeRow[] = [];
  function visit(folder: TreeNode, depth: number) {
    const children = [...(folder.children ?? [])].sort((a, b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const node of children) {
      const project = boundaries.get(node.path);
      rows.push({ node, depth, parent: depth ? folder.path : null, project });
      if (node.children && !project && expanded.has(node.path)) visit(node, depth + 1);
    }
  }
  visit(root, 0);
  return rows;
}
export function remapPath(path: string, from: string, to: string): string {
  return contains(from, path) ? to + path.slice(from.length) : path;
}
export function applyRename(settings: Settings, from: string, to: string): void {
  for (const p of settings.projects) {
    if (p.path === from && p.name === from.split('/').at(-1)) p.name = to.split('/').at(-1)!;
    p.path = remapPath(p.path, from, to);
  }
  for (const key of Object.keys(settings.expanded)) settings.expanded[key] = settings.expanded[key].map(p => remapPath(p, from, to));
}
