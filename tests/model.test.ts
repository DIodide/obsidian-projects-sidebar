import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRename, cleanPath, contains, filterProjects, ownerOf, readSettings, treeRows, type Project, type TreeNode } from '../src/model';
const projects: Project[] = [
  { id: 'courses', name: 'Courses', path: 'Courses', pinned: false },
  { id: 'cos', name: 'COS330', path: 'Courses/COS330', pinned: true },
  { id: 'pset', name: 'Assignment', path: 'Courses/COS330/psets', pinned: false },
];
const root: TreeNode = { path: 'Courses', name: 'Courses', children: [
  { path: 'Courses/overview.md', name: 'overview.md' },
  { path: 'Courses/COS330', name: 'COS330', children: [
    { path: 'Courses/COS330/note.md', name: 'note.md' },
    { path: 'Courses/COS330/psets', name: 'psets', children: [{ path: 'Courses/COS330/psets/a.md', name: 'a.md' }] },
  ] },
] };
test('ownership follows the most specific project, with path-segment boundaries', () => {
  assert.equal(ownerOf(projects, 'Courses/COS330/psets/a.md')?.id, 'pset');
  assert.equal(ownerOf(projects, 'Courses/COS330/note.md')?.id, 'cos');
  assert.equal(ownerOf(projects, 'Courses/COS330-extra/a.md')?.id, 'courses');
  assert.equal(ownerOf(projects, 'CoursesOther/note.md'), undefined);
  assert.equal(contains('Courses/COS330', 'Courses/COS3300'), false);
});
test('parent tree stops at nested projects even when their folder was expanded', () => {
  const rows = treeRows(root, new Set(['Courses/COS330', 'Courses/COS330/psets']), projects, projects[0]);
  assert.deepEqual(rows.map(r => r.node.path), ['Courses/COS330', 'Courses/overview.md']);
  assert.equal(rows[0].project?.id, 'cos');
  const sub = treeRows(root.children![1], new Set(['Courses/COS330/psets']), projects, projects[1]);
  assert.equal(sub[0].project?.id, 'pset');
  assert.equal(sub.length, 2);
});
test('removing a nested project restores the subtree to its parent; All files is unscoped', () => {
  const expanded = new Set(['Courses/COS330', 'Courses/COS330/psets']);
  assert.equal(treeRows(root, expanded, [projects[0]], projects[0]).length, 5);
  assert.equal(treeRows(root, expanded, projects, undefined).length, 5);
});
test('collapsed folders are not traversed', () => {
  // Accessing children identifies folder-ness; ensure no iteration occurs until expanded.
  const children = new Proxy([] as TreeNode[], { get(t, key, receiver) { if (key === Symbol.iterator) throw new Error('Traversed closed folder'); return Reflect.get(t, key, receiver); } });
  const rows = treeRows({ path: '', name: '', children: [{ path: 'Courses/large', name: 'large', children }] }, new Set(), [], undefined);
  assert.equal(rows.length, 1);
});
test('project filtering matches all words in name and path, pinned first', () => {
  assert.deepEqual(filterProjects(projects, '').map(p => p.id), ['cos', 'pset', 'courses']);
  assert.deepEqual(filterProjects(projects, 'courses 330').map(p => p.id), ['cos', 'pset']);
  assert.equal(filterProjects(projects, 'missing').length, 0);
});
test('folder renames preserve project identities and expansion with safe segment matching', () => {
  const settings = readSettings({ projects, selectedId: 'cos', expanded: { cos: ['Courses/COS330/psets', 'Courses/COS3300'] } });
  applyRename(settings, 'Courses/COS330', 'Courses/COS331');
  assert.equal(settings.projects[1].path, 'Courses/COS331');
  assert.equal(settings.projects[1].name, 'COS331');
  assert.equal(settings.projects[2].path, 'Courses/COS331/psets');
  assert.equal(settings.projects[2].name, 'Assignment');
  assert.deepEqual(settings.expanded.cos, ['Courses/COS331/psets', 'Courses/COS3300']);
  assert.equal(settings.selectedId, 'cos');
});
test('persisted state rejects duplicate/invalid projects and stale selections', () => {
  const settings = readSettings({ projects: [...projects, projects[0], { id: 'bad', name: 'bad', path: '../outside' }], selectedId: 'missing', expanded: { missing: ['x'], cos: [4, 'Courses/COS330/psets'] } });
  assert.equal(settings.projects.length, 3);
  assert.equal(settings.selectedId, null);
  assert.deepEqual(settings.expanded, { cos: ['Courses/COS330/psets'] });
  assert.throws(() => cleanPath('x/../y'));
});
