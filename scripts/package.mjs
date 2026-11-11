import { mkdir, mkdtemp, copyFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
if (pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) throw new Error('Version metadata does not match.');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== manifest.version) throw new Error('Tag must match manifest version (no v prefix).');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Expected a semantic release version.');
await mkdir('releases', { recursive: true });
const stage = await mkdtemp(join(tmpdir(), 'projects-sidebar-release-'));
try {
  await mkdir(join(stage, 'projects-sidebar'));
  const files = ['main.js', 'manifest.json', 'styles.css', 'LICENSE'];
  for (const file of files) await copyFile(file, join(stage, 'projects-sidebar', file));
  // A fresh archive and explicit allowlist keep local data out of every release.
  execFileSync('zip', ['-q', 'plugin.zip', ...files.map(file => `projects-sidebar/${file}`)], { cwd: stage });
  const output = resolve(`releases/projects-sidebar-${manifest.version}.zip`);
  await copyFile(join(stage, 'plugin.zip'), output);
  console.log(output);
} finally { await rm(stage, { recursive: true, force: true }); }
